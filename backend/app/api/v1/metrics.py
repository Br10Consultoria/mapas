from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, Query
from typing import List, Optional
from datetime import datetime, timezone, timedelta
import asyncio
import json
import logging

from app.core.config import settings
from app.core.database import AsyncSessionLocal, get_db
from app.core.security import get_current_user
from app.models.topology import Device, DeviceStatus
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/metrics", tags=["Metrics"])
logger = logging.getLogger(__name__)


class ConnectionManager:
    """Gerencia conexões WebSocket ativas."""
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WebSocket connected. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info(f"WebSocket disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        dead = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                dead.append(connection)
        for conn in dead:
            self.disconnect(conn)


manager = ConnectionManager()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket para atualizações em tempo real.
    Envia status dos dispositivos e métricas de tráfego por link a cada 30s.
    """
    await manager.connect(websocket)
    try:
        while True:
            # 1. Status dos dispositivos
            async with AsyncSessionLocal() as session:
                result = await session.execute(select(Device))
                devices = result.scalars().all()

            status_data = [
                {
                    "id": str(d.id),
                    "status": d.status.value,
                    "last_seen": d.last_seen.isoformat() if d.last_seen else None,
                    "uptime": d.uptime,
                }
                for d in devices
            ]

            await websocket.send_json({
                "type": "device_status",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "data": status_data,
            })

            # 2. Tráfego em tempo real por link (via InfluxDB)
            try:
                link_traffic = await _get_link_traffic()
                if link_traffic:
                    await websocket.send_json({
                        "type": "link_traffic",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "data": link_traffic,
                    })
            except Exception as e:
                logger.debug(f"Link traffic query error: {e}")

            await asyncio.sleep(settings.POLL_INTERVAL_STATUS)

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)


async def _get_link_traffic() -> list:
    """Busca tráfego atual (bps) de cada link no InfluxDB."""
    from influxdb_client.client.influxdb_client_async import InfluxDBClientAsync
    from app.models.topology import Link, Interface
    from sqlalchemy.orm import selectinload

    async with AsyncSessionLocal() as session:
        links_result = await session.execute(
            select(Link)
            .options(
                selectinload(Link.source_interface),
                selectinload(Link.target_interface),
                selectinload(Link.source_device),
                selectinload(Link.target_device),
            )
            .where(Link.is_active == True)
        )
        links = links_result.scalars().all()

    if not links:
        return []

    client = InfluxDBClientAsync(
        url=settings.INFLUXDB_URL,
        token=settings.INFLUXDB_TOKEN,
        org=settings.INFLUXDB_ORG,
    )
    result = []
    try:
        query_api = client.query_api()
        for link in links:
            traffic = {"link_id": str(link.id), "in_bps": 0.0, "out_bps": 0.0}
            src_if = link.source_interface
            if src_if and link.source_device:
                flux = f'''
from(bucket: "{settings.INFLUXDB_BUCKET}")
  |> range(start: -2m)
  |> filter(fn: (r) => r["_measurement"] == "interface_traffic")
  |> filter(fn: (r) => r["device"] == "{link.source_device.hostname}")
  |> filter(fn: (r) => r["if_index"] == "{src_if.if_index}")
  |> filter(fn: (r) => r["_field"] == "in_octets" or r["_field"] == "out_octets")
  |> last()
  |> derivative(unit: 1s, nonNegative: true)
  |> map(fn: (r) => ({{ r with _value: r._value * 8.0 }}))
'''
                try:
                    tables = await query_api.query(flux)
                    for table in tables:
                        for record in table.records:
                            v = record.get_value() or 0
                            if record.get_field() == "in_octets":
                                traffic["in_bps"] = round(v, 1)
                            elif record.get_field() == "out_octets":
                                traffic["out_bps"] = round(v, 1)
                except Exception:
                    pass
            result.append(traffic)
    finally:
        await client.close()
    return result


@router.get("/interface/{device_id}/{if_index}")
async def get_interface_metrics(
    device_id: int,
    if_index: int,
    hours: int = Query(default=1, ge=1, le=168),
):
    """Retorna métricas históricas de uma interface do InfluxDB."""
    from influxdb_client.client.influxdb_client_async import InfluxDBClientAsync

    client = InfluxDBClientAsync(
        url=settings.INFLUXDB_URL,
        token=settings.INFLUXDB_TOKEN,
        org=settings.INFLUXDB_ORG,
    )

    try:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(Device).where(Device.id == device_id)
            )
            device = result.scalar_one_or_none()
            if not device:
                return {"error": "Device not found"}

        query_api = client.query_api()
        flux_query = f'''
from(bucket: "{settings.INFLUXDB_BUCKET}")
  |> range(start: -{hours}h)
  |> filter(fn: (r) => r["_measurement"] == "interface_traffic")
  |> filter(fn: (r) => r["device"] == "{device.hostname}")
  |> filter(fn: (r) => r["if_index"] == "{if_index}")
  |> filter(fn: (r) => r["_field"] == "in_octets" or r["_field"] == "out_octets")
  |> aggregateWindow(every: 1m, fn: last, createEmpty: false)
  |> derivative(unit: 1s, nonNegative: true)
  |> map(fn: (r) => ({{ r with _value: r._value * 8.0 }}))
  |> yield(name: "bps")
'''
        tables = await query_api.query(flux_query)
        data = {"in_bps": [], "out_bps": []}
        for table in tables:
            for record in table.records:
                field = record.get_field()
                entry = {
                    "time": record.get_time().isoformat(),
                    "value": record.get_value(),
                }
                if field == "in_octets":
                    data["in_bps"].append(entry)
                elif field == "out_octets":
                    data["out_bps"].append(entry)

        return data
    finally:
        await client.close()


@router.get("/summary")
async def get_metrics_summary():
    """Retorna resumo de status da rede."""
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Device))
        devices = result.scalars().all()

    total = len(devices)
    up = sum(1 for d in devices if d.status == DeviceStatus.UP)
    down = sum(1 for d in devices if d.status == DeviceStatus.DOWN)
    degraded = sum(1 for d in devices if d.status == DeviceStatus.DEGRADED)
    unknown = sum(1 for d in devices if d.status == DeviceStatus.UNKNOWN)

    return {
        "total_devices": total,
        "up": up,
        "down": down,
        "degraded": degraded,
        "unknown": unknown,
        "health_pct": round((up / total * 100) if total > 0 else 0, 1),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
