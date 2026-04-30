"""
Serviço de polling: orquestra a coleta SNMP e persiste dados no PostgreSQL e InfluxDB.
"""
import asyncio
import logging
from datetime import datetime, timezone
from typing import List

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from influxdb_client.client.influxdb_client_async import InfluxDBClientAsync
from influxdb_client import Point

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.topology import Device, Interface, Link, DeviceStatus
from app.models.log import LogLevel, LogCategory
from app.collectors.snmp_collector import (
    collect_system_info,
    collect_interfaces,
    collect_interface_counters,
    collect_lldp_neighbors,
    ping_device,
)

logger = logging.getLogger(__name__)


async def _log(session: AsyncSession, message: str, level=LogLevel.INFO,
               category=LogCategory.POLLER, device_id=None, device_name=None, detail=None):
    """Persiste log no banco sem importação circular."""
    from app.services.log_service import add_log
    try:
        await add_log(session, message, level=level, category=category,
                      device_id=device_id, device_name=device_name, detail=detail)
    except Exception as e:
        logger.warning(f"Could not persist log: {e}")


async def poll_device_status(device: Device) -> DeviceStatus:
    """Verifica status do dispositivo via ICMP + SNMP."""
    is_alive = await ping_device(device.ip_address)
    if not is_alive:
        return DeviceStatus.DOWN

    sys_info = await collect_system_info(
        device.ip_address,
        community=device.snmp_community,
        port=device.snmp_port,
    )
    if sys_info:
        return DeviceStatus.UP
    return DeviceStatus.DEGRADED


async def poll_all_devices():
    """Polling de status de todos os dispositivos ativos."""
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Device).where(Device.snmp_enabled == True)
        )
        devices = result.scalars().all()

    for device in devices:
        try:
            status = await poll_device_status(device)
            async with AsyncSessionLocal() as session:
                await session.execute(
                    update(Device)
                    .where(Device.id == device.id)
                    .values(
                        status=status,
                        last_seen=datetime.now(timezone.utc) if status != DeviceStatus.DOWN else device.last_seen,
                    )
                )
                await session.commit()

                # Log status change
                if status == DeviceStatus.UP:
                    level, msg = LogLevel.SUCCESS, f"Dispositivo ONLINE - SNMP respondendo"
                elif status == DeviceStatus.DEGRADED:
                    level, msg = LogLevel.WARNING, f"Dispositivo DEGRADADO - ping OK mas SNMP falhou"
                else:
                    level, msg = LogLevel.ERROR, f"Dispositivo OFFLINE - sem resposta ao ping"

                await _log(session, msg, level=level, category=LogCategory.PING,
                           device_id=device.id, device_name=device.name)

            logger.info(f"Device {device.name} ({device.ip_address}): {status}")
        except Exception as e:
            logger.error(f"Error polling device {device.name}: {e}")
            async with AsyncSessionLocal() as session:
                await _log(session, f"Erro no polling: {e}", level=LogLevel.ERROR,
                           category=LogCategory.POLLER, device_id=device.id, device_name=device.name)


async def poll_interfaces(device: Device, session: AsyncSession):
    """Coleta e atualiza interfaces de um dispositivo."""
    try:
        interfaces = await collect_interfaces(
            device.ip_address,
            community=device.snmp_community,
            port=device.snmp_port,
        )
        for iface_data in interfaces:
            result = await session.execute(
                select(Interface).where(
                    Interface.device_id == device.id,
                    Interface.if_index == iface_data["if_index"],
                )
            )
            existing = result.scalar_one_or_none()
            if existing:
                for key, val in iface_data.items():
                    if val is not None:
                        setattr(existing, key, val)
            else:
                new_iface = Interface(device_id=device.id, **iface_data)
                session.add(new_iface)
        await session.commit()

        await _log(session,
                   f"SNMP: {len(interfaces)} interfaces coletadas com sucesso",
                   level=LogLevel.SUCCESS, category=LogCategory.SNMP,
                   device_id=device.id, device_name=device.name)
        logger.info(f"Updated {len(interfaces)} interfaces for {device.name}")
    except Exception as e:
        logger.error(f"Error polling interfaces for {device.name}: {e}")
        await _log(session, f"SNMP erro ao coletar interfaces: {e}",
                   level=LogLevel.ERROR, category=LogCategory.SNMP,
                   device_id=device.id, device_name=device.name, detail=str(e))


async def poll_interface_metrics():
    """Coleta contadores de interfaces e salva no InfluxDB."""
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Device).where(
                Device.snmp_enabled == True,
                Device.status == DeviceStatus.UP,
            )
        )
        devices = result.scalars().all()

    influx_client = InfluxDBClientAsync(
        url=settings.INFLUXDB_URL,
        token=settings.INFLUXDB_TOKEN,
        org=settings.INFLUXDB_ORG,
    )
    write_api = influx_client.write_api()

    for device in devices:
        try:
            counters = await collect_interface_counters(
                device.ip_address,
                community=device.snmp_community,
                port=device.snmp_port,
            )
            points = []
            for c in counters:
                point = (
                    Point("interface_traffic")
                    .tag("device", device.hostname)
                    .tag("device_ip", device.ip_address)
                    .tag("if_index", str(c["if_index"]))
                    .field("in_octets", c.get("in_octets") or 0)
                    .field("out_octets", c.get("out_octets") or 0)
                    .field("in_errors", c.get("in_errors") or 0)
                    .field("out_errors", c.get("out_errors") or 0)
                )
                points.append(point)

            if points:
                await write_api.write(
                    bucket=settings.INFLUXDB_BUCKET,
                    record=points,
                )

            async with AsyncSessionLocal() as session:
                await _log(session,
                           f"InfluxDB: {len(points)} métricas de interface gravadas",
                           level=LogLevel.INFO, category=LogCategory.SNMP,
                           device_id=device.id, device_name=device.name)
            logger.info(f"Wrote {len(points)} interface metrics for {device.name}")
        except Exception as e:
            logger.error(f"Error collecting metrics for {device.name}: {e}")
            async with AsyncSessionLocal() as session:
                await _log(session, f"Erro ao gravar métricas: {e}",
                           level=LogLevel.ERROR, category=LogCategory.SNMP,
                           device_id=device.id, device_name=device.name)

    await influx_client.close()


async def discover_topology():
    """Descobre topologia via LLDP e atualiza links no banco."""
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Device).where(
                Device.snmp_enabled == True,
                Device.status == DeviceStatus.UP,
            )
        )
        devices = result.scalars().all()

        hostname_map = {d.hostname.lower(): d for d in devices}

        for device in devices:
            try:
                neighbors = await collect_lldp_neighbors(
                    device.ip_address,
                    community=device.snmp_community,
                    port=device.snmp_port,
                )
                new_links = 0
                for neighbor in neighbors:
                    remote_name = (neighbor.get("lldpRemSysName") or "").lower()
                    remote_device = hostname_map.get(remote_name)
                    if not remote_device:
                        continue

                    local_if_result = await session.execute(
                        select(Interface).where(
                            Interface.device_id == device.id,
                            Interface.if_index == neighbor["local_port_index"],
                        )
                    )
                    local_if = local_if_result.scalar_one_or_none()

                    existing_link = await session.execute(
                        select(Link).where(
                            Link.source_device_id == device.id,
                            Link.target_device_id == remote_device.id,
                        )
                    )
                    if not existing_link.scalar_one_or_none():
                        link = Link(
                            source_device_id=device.id,
                            target_device_id=remote_device.id,
                            source_interface_id=local_if.id if local_if else None,
                            discovered_via="lldp",
                        )
                        session.add(link)
                        new_links += 1

                await session.commit()

                msg = f"LLDP: {len(neighbors)} vizinhos encontrados, {new_links} novos links"
                level = LogLevel.SUCCESS if neighbors else LogLevel.INFO
                await _log(session, msg, level=level, category=LogCategory.TOPOLOGY,
                           device_id=device.id, device_name=device.name)
                logger.info(f"LLDP discovery for {device.name}: {len(neighbors)} neighbors")
            except Exception as e:
                logger.error(f"Error in LLDP discovery for {device.name}: {e}")
                await _log(session, f"Erro na descoberta LLDP: {e}",
                           level=LogLevel.ERROR, category=LogCategory.TOPOLOGY,
                           device_id=device.id, device_name=device.name)
