"""
SNMP Collector - Coleta métricas de dispositivos via SNMP v1/v2c
Suporte a: Huawei, MikroTik, Datacom, Cisco e genéricos
Compatível com pysnmp >= 6.x (nova API)
"""
import asyncio
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone

# pysnmp v6/v7 usa pysnmp.hlapi.v3arch.asyncio
try:
    from pysnmp.hlapi.v3arch.asyncio import (
        SnmpEngine, CommunityData, UdpTransportTarget, ContextData,
        ObjectType, ObjectIdentity, get_cmd, next_cmd,
    )
    PYSNMP_NEW_API = True
except ImportError:
    # fallback para versões mais antigas
    from pysnmp.hlapi.asyncio import (
        SnmpEngine, CommunityData, UdpTransportTarget, ContextData,
        ObjectType, ObjectIdentity,
    )
    from pysnmp.hlapi.asyncio import getCmd as get_cmd, nextCmd as next_cmd
    PYSNMP_NEW_API = False

from app.core.config import settings

logger = logging.getLogger(__name__)

# OIDs padrão (RFC 1213 / IF-MIB)
OIDS = {
    # System
    "sysDescr":       "1.3.6.1.2.1.1.1.0",
    "sysObjectID":    "1.3.6.1.2.1.1.2.0",
    "sysUpTime":      "1.3.6.1.2.1.1.3.0",
    "sysContact":     "1.3.6.1.2.1.1.4.0",
    "sysName":        "1.3.6.1.2.1.1.5.0",
    "sysLocation":    "1.3.6.1.2.1.1.6.0",
    # Interfaces table
    "ifIndex":        "1.3.6.1.2.1.2.2.1.1",
    "ifDescr":        "1.3.6.1.2.1.2.2.1.2",
    "ifType":         "1.3.6.1.2.1.2.2.1.3",
    "ifMtu":          "1.3.6.1.2.1.2.2.1.4",
    "ifSpeed":        "1.3.6.1.2.1.2.2.1.5",
    "ifPhysAddress":  "1.3.6.1.2.1.2.2.1.6",
    "ifAdminStatus":  "1.3.6.1.2.1.2.2.1.7",
    "ifOperStatus":   "1.3.6.1.2.1.2.2.1.8",
    "ifInOctets":     "1.3.6.1.2.1.2.2.1.10",
    "ifInErrors":     "1.3.6.1.2.1.2.2.1.14",
    "ifOutOctets":    "1.3.6.1.2.1.2.2.1.16",
    "ifOutErrors":    "1.3.6.1.2.1.2.2.1.20",
    # IF-MIB (64-bit counters)
    "ifHCInOctets":   "1.3.6.1.2.1.31.1.1.1.6",
    "ifHCOutOctets":  "1.3.6.1.2.1.31.1.1.1.10",
    "ifHighSpeed":    "1.3.6.1.2.1.31.1.1.1.15",
    "ifAlias":        "1.3.6.1.2.1.31.1.1.1.18",
    # IP-MIB
    "ipAdEntAddr":    "1.3.6.1.2.1.4.20.1.1",
    "ipAdEntIfIndex": "1.3.6.1.2.1.4.20.1.2",
    "ipAdEntNetMask": "1.3.6.1.2.1.4.20.1.3",
    # LLDP-MIB
    "lldpRemSysName":  "1.0.8802.1.1.2.1.4.1.1.9",
    "lldpRemPortId":   "1.0.8802.1.1.2.1.4.1.1.7",
    "lldpRemPortDesc": "1.0.8802.1.1.2.1.4.1.1.8",
    # Huawei specific
    "hwEntityCpuUsage": "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.5",
    "hwEntityMemUsage": "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.7",
    # MikroTik specific
    "mtxrCPUFrequency": "1.3.6.1.4.1.14988.1.1.3.14",
}


def _format_mac(raw) -> Optional[str]:
    try:
        octets = [f"{b:02x}" for b in bytes(raw)]
        if len(octets) == 6:
            return ":".join(octets)
    except Exception:
        pass
    return None


def _to_int(val) -> Optional[int]:
    try:
        return int(val)
    except Exception:
        return None


def _to_str(val) -> Optional[str]:
    try:
        s = str(val).strip()
        return s if s else None
    except Exception:
        return None


async def snmp_get(
    host: str,
    oids: List[str],
    community: str = None,
    port: int = None,
    timeout: int = None,
    retries: int = None,
) -> Dict[str, Any]:
    """Executa SNMP GET para uma lista de OIDs."""
    community = community or settings.SNMP_COMMUNITY
    port = port or settings.SNMP_PORT
    timeout = timeout or settings.SNMP_TIMEOUT
    retries = retries or settings.SNMP_RETRIES

    result = {}
    try:
        engine = SnmpEngine()
        transport = await UdpTransportTarget.create(
            (host, port), timeout=timeout, retries=retries
        )
        error_indication, error_status, error_index, var_binds = await get_cmd(
            engine,
            CommunityData(community, mpModel=1),
            transport,
            ContextData(),
            *[ObjectType(ObjectIdentity(oid)) for oid in oids],
        )
        if error_indication:
            logger.warning(f"SNMP GET error on {host}: {error_indication}")
            return result
        if error_status:
            logger.warning(f"SNMP GET status error on {host}: {error_status}")
            return result
        for var_bind in var_binds:
            oid_str = str(var_bind[0])
            result[oid_str] = var_bind[1]
    except Exception as e:
        logger.error(f"SNMP GET exception on {host}: {e}")
    return result


async def snmp_walk(
    host: str,
    base_oid: str,
    community: str = None,
    port: int = None,
    timeout: int = None,
    retries: int = None,
) -> Dict[str, Any]:
    """Executa SNMP WALK (GETNEXT) para um OID base."""
    community = community or settings.SNMP_COMMUNITY
    port = port or settings.SNMP_PORT
    timeout = timeout or settings.SNMP_TIMEOUT
    retries = retries or settings.SNMP_RETRIES

    result = {}
    try:
        engine = SnmpEngine()
        transport = await UdpTransportTarget.create(
            (host, port), timeout=timeout, retries=retries
        )
        async for error_indication, error_status, error_index, var_binds in next_cmd(
            engine,
            CommunityData(community, mpModel=1),
            transport,
            ContextData(),
            ObjectType(ObjectIdentity(base_oid)),
            lexicographicMode=False,
        ):
            if error_indication:
                logger.warning(f"SNMP WALK error on {host}: {error_indication}")
                break
            if error_status:
                logger.warning(f"SNMP WALK status error on {host}: {error_status}")
                break
            for var_bind in var_binds:
                oid_str = str(var_bind[0])
                result[oid_str] = var_bind[1]
    except Exception as e:
        logger.error(f"SNMP WALK exception on {host}: {e}")
    return result


async def collect_system_info(
    host: str,
    community: str = None,
    port: int = None,
) -> Optional[Dict[str, Any]]:
    """Coleta informações básicas do sistema via SNMP."""
    system_oids = [
        OIDS["sysDescr"], OIDS["sysObjectID"], OIDS["sysUpTime"],
        OIDS["sysContact"], OIDS["sysName"], OIDS["sysLocation"],
    ]
    data = await snmp_get(host, system_oids, community=community, port=port)
    if not data:
        return None

    result: Dict[str, Any] = {}
    for oid_key, oid_val in OIDS.items():
        if oid_key.startswith("sys"):
            for k, v in data.items():
                if k.startswith(oid_val.rstrip(".0")):
                    result[oid_key] = _to_str(v)
                    break

    descr = result.get("sysDescr", "") or ""
    vendor = "generic"
    device_type = "unknown"
    if "Huawei" in descr or "huawei" in descr:
        vendor = "huawei"
        device_type = "switch" if "S" in descr else "router"
    elif "MikroTik" in descr or "RouterOS" in descr:
        vendor = "mikrotik"
        device_type = "router"
    elif "Datacom" in descr or "datacom" in descr:
        vendor = "datacom"
        device_type = "switch"
    elif "Cisco" in descr or "cisco" in descr:
        vendor = "cisco"
        device_type = "router"

    result["vendor"] = vendor
    result["device_type"] = device_type
    result["host"] = host
    result["collected_at"] = datetime.now(timezone.utc).isoformat()
    return result


async def collect_interfaces(
    host: str,
    community: str = None,
    port: int = None,
) -> List[Dict[str, Any]]:
    """Coleta tabela de interfaces do dispositivo."""
    interfaces_raw: Dict[int, Dict] = {}

    for oid_name in ["ifIndex", "ifDescr", "ifType", "ifMtu", "ifSpeed",
                     "ifPhysAddress", "ifAdminStatus", "ifOperStatus"]:
        walked = await snmp_walk(host, OIDS[oid_name], community=community, port=port)
        for oid_str, val in walked.items():
            idx = int(oid_str.split(".")[-1])
            if idx not in interfaces_raw:
                interfaces_raw[idx] = {"if_index": idx}
            interfaces_raw[idx][oid_name] = val

    for oid_name in ["ifHCInOctets", "ifHCOutOctets", "ifHighSpeed", "ifAlias"]:
        walked = await snmp_walk(host, OIDS[oid_name], community=community, port=port)
        for oid_str, val in walked.items():
            idx = int(oid_str.split(".")[-1])
            if idx in interfaces_raw:
                interfaces_raw[idx][oid_name] = val

    interfaces = []
    for idx, raw in interfaces_raw.items():
        iface = {
            "if_index": idx,
            "if_name": _to_str(raw.get("ifDescr")) or f"if{idx}",
            "if_alias": _to_str(raw.get("ifAlias")),
            "if_type": _to_int(raw.get("ifType")),
            "if_mtu": _to_int(raw.get("ifMtu")),
            "if_speed": _to_int(raw.get("ifHighSpeed", raw.get("ifSpeed"))),
            "if_mac": _format_mac(raw.get("ifPhysAddress")),
            "if_admin_status": _to_int(raw.get("ifAdminStatus")),
            "if_oper_status": _to_int(raw.get("ifOperStatus")),
        }
        interfaces.append(iface)

    return interfaces


async def collect_interface_counters(
    host: str,
    community: str = None,
    port: int = None,
) -> List[Dict[str, Any]]:
    """Coleta contadores de tráfego das interfaces."""
    counters: Dict[int, Dict] = {}
    for oid_name in ["ifHCInOctets", "ifHCOutOctets", "ifInErrors", "ifOutErrors"]:
        walked = await snmp_walk(host, OIDS[oid_name], community=community, port=port)
        for oid_str, val in walked.items():
            idx = int(oid_str.split(".")[-1])
            if idx not in counters:
                counters[idx] = {"if_index": idx}
            counters[idx][oid_name] = _to_int(val)

    if not counters:
        for oid_name in ["ifInOctets", "ifOutOctets", "ifInErrors", "ifOutErrors"]:
            walked = await snmp_walk(host, OIDS[oid_name], community=community, port=port)
            for oid_str, val in walked.items():
                idx = int(oid_str.split(".")[-1])
                if idx not in counters:
                    counters[idx] = {"if_index": idx}
                counters[idx][oid_name] = _to_int(val)

    ts = datetime.now(timezone.utc).isoformat()
    return [
        {
            "if_index": idx,
            "in_octets": c.get("ifHCInOctets") or c.get("ifInOctets"),
            "out_octets": c.get("ifHCOutOctets") or c.get("ifOutOctets"),
            "in_errors": c.get("ifInErrors"),
            "out_errors": c.get("ifOutErrors"),
            "collected_at": ts,
        }
        for idx, c in counters.items()
    ]


async def collect_lldp_neighbors(
    host: str,
    community: str = None,
    port: int = None,
) -> List[Dict[str, Any]]:
    """Coleta vizinhos LLDP para descoberta de topologia."""
    neighbors: Dict[str, Dict] = {}

    for oid_name in ["lldpRemSysName", "lldpRemPortId", "lldpRemPortDesc"]:
        walked = await snmp_walk(host, OIDS[oid_name], community=community, port=port)
        for oid_str, val in walked.items():
            parts = oid_str.split(".")
            if len(parts) >= 3:
                local_port = parts[-2]
                remote_idx = parts[-1]
                key = f"{local_port}.{remote_idx}"
                if key not in neighbors:
                    neighbors[key] = {
                        "local_port_index": int(local_port),
                        "remote_index": int(remote_idx),
                    }
                neighbors[key][oid_name] = _to_str(val)

    return list(neighbors.values())


async def ping_device(host: str, timeout: int = 3) -> bool:
    """Verifica se o dispositivo está acessível via ICMP."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ping", "-c", "1", "-W", str(timeout), host,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.wait()
        return proc.returncode == 0
    except Exception:
        return False
