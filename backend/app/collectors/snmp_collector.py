"""
SNMP Collector - Coleta métricas de dispositivos via SNMP v1/v2c
Usa puresnmp (API estável, sem dependências de versão problemáticas).
Suporte a: Huawei, MikroTik, Datacom, Cisco e genéricos.
"""
import asyncio
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone

from puresnmp import Client, V2C, V1
from puresnmp.exc import SnmpError as SNMPError
from x690.types import ObjectIdentifier


from app.core.config import settings


def _oid(s: str) -> ObjectIdentifier:
    """Converte string OID para ObjectIdentifier (puresnmp exige este tipo)."""
    return ObjectIdentifier(f".{s}" if not s.startswith(".") else s)

logger = logging.getLogger(__name__)

# ── OIDs padrão (RFC 1213 / IF-MIB) ─────────────────────────────────────────

OIDS = {
    # System
    "sysDescr":       "1.3.6.1.2.1.1.1.0",
    "sysObjectID":    "1.3.6.1.2.1.1.2.0",
    "sysUpTime":      "1.3.6.1.2.1.1.3.0",
    "sysContact":     "1.3.6.1.2.1.1.4.0",
    "sysName":        "1.3.6.1.2.1.1.5.0",
    "sysLocation":    "1.3.6.1.2.1.1.6.0",
    # Interfaces table
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
    # LLDP-MIB
    "lldpRemSysName":  "1.0.8802.1.1.2.1.4.1.1.9",
    "lldpRemPortId":   "1.0.8802.1.1.2.1.4.1.1.7",
    "lldpRemPortDesc": "1.0.8802.1.1.2.1.4.1.1.8",
}

TIMEOUT = 5  # segundos


def _make_client(host: str, community: str, port: int, version: str) -> Client:
    creds = V1(community) if version == "1" else V2C(community)
    return Client(host, creds, port=port)


def _safe_str(val: Any) -> Optional[str]:
    if val is None:
        return None
    if isinstance(val, bytes):
        try:
            return val.decode("utf-8", errors="replace").strip()
        except Exception:
            return val.hex()
    s = str(val).strip()
    return s if s else None


def _safe_int(val: Any) -> Optional[int]:
    try:
        return int(val)
    except Exception:
        return None


def _format_mac(raw: Any) -> Optional[str]:
    if isinstance(raw, bytes) and len(raw) == 6:
        return ":".join(f"{b:02x}" for b in raw)
    return None


def _idx_from_oid(oid_str: str, base_oid: str) -> Optional[int]:
    """Extrai o último componente numérico do OID após o base_oid."""
    try:
        suffix = str(oid_str)[len(base_oid):].lstrip(".")
        return int(suffix.split(".")[-1])
    except Exception:
        return None


# ── Ping ─────────────────────────────────────────────────────────────────────

async def ping_device(host: str, timeout: int = 3) -> bool:
    """Verifica se o dispositivo está acessível via ICMP."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ping", "-c", "2", "-W", str(timeout), host,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(proc.wait(), timeout=timeout * 3 + 2)
        return proc.returncode == 0
    except Exception as e:
        logger.debug(f"Ping {host} failed: {e}")
        return False


# ── SNMP walk helper ─────────────────────────────────────────────────────────

async def _walk(host: str, base_oid: str, community: str, port: int, version: str) -> Dict[str, Any]:
    """Executa SNMP WALK e retorna {oid_str: value}."""
    result = {}
    try:
        client = _make_client(host, community, port, version)
        async for varbind in client.walk(_oid(base_oid)):
            result[str(varbind.oid)] = varbind.value
    except SNMPError as e:
        logger.debug(f"SNMP walk {base_oid} on {host}: {e}")
    except Exception as e:
        logger.debug(f"SNMP walk {base_oid} on {host} exception: {e}")
    return result


async def _multiget(host: str, oids: List[str], community: str, port: int, version: str) -> List[Any]:
    """Executa SNMP MULTIGET e retorna lista de valores na mesma ordem."""
    try:
        client = _make_client(host, community, port, version)
        values = await asyncio.wait_for(client.multiget([_oid(o) for o in oids]), timeout=TIMEOUT)
        return list(values)
    except asyncio.TimeoutError:
        logger.warning(f"SNMP multiget timeout on {host}")
        return []
    except SNMPError as e:
        logger.warning(f"SNMP multiget error on {host}: {e}")
        return []
    except Exception as e:
        logger.error(f"SNMP multiget exception on {host}: {e}")
        return []


# ── System Info ──────────────────────────────────────────────────────────────

async def collect_system_info(
    host: str,
    community: str = None,
    port: int = None,
    version: str = None,
) -> Optional[Dict[str, Any]]:
    """Coleta informações básicas do sistema via SNMP GET."""
    community = community or settings.SNMP_COMMUNITY
    port = port or settings.SNMP_PORT
    version = version or "2c"

    sys_oids = [
        OIDS["sysDescr"], OIDS["sysObjectID"], OIDS["sysUpTime"],
        OIDS["sysContact"], OIDS["sysName"], OIDS["sysLocation"],
    ]
    values = await _multiget(host, sys_oids, community, port, version)
    if not values:
        return None

    def v(i): return values[i] if i < len(values) else None

    descr   = _safe_str(v(0)) or ""
    sys_oid = _safe_str(v(1)) or ""
    uptime  = _safe_int(v(2))
    contact = _safe_str(v(3))
    name    = _safe_str(v(4))
    loc     = _safe_str(v(5))

    # Detecção automática de fabricante
    vendor = "generic"
    device_type = "unknown"
    descr_lower = descr.lower()
    if "huawei" in descr_lower or "2011" in sys_oid:
        vendor = "huawei"
        device_type = "switch" if any(x in descr_lower for x in ["s57", "s58", "s68", "s93"]) else "router"
    elif "mikrotik" in descr_lower or "routeros" in descr_lower or "14988" in sys_oid:
        vendor = "mikrotik"
        device_type = "router"
    elif "datacom" in descr_lower or "3709" in sys_oid or "dm" in descr_lower:
        vendor = "datacom"
        device_type = "switch"
    elif "cisco" in descr_lower or "9" in sys_oid[:5]:
        vendor = "cisco"
        device_type = "router"

    return {
        "sysDescr":    descr,
        "sysObjectID": sys_oid,
        "sysUpTime":   uptime,
        "sysContact":  contact,
        "sysName":     name,
        "sysLocation": loc,
        "vendor":      vendor,
        "device_type": device_type,
        "host":        host,
        "collected_at": datetime.now(timezone.utc).isoformat(),
    }


# ── Interfaces ───────────────────────────────────────────────────────────────

async def collect_interfaces(
    host: str,
    community: str = None,
    port: int = None,
    version: str = None,
) -> List[Dict[str, Any]]:
    """Coleta tabela de interfaces do dispositivo."""
    community = community or settings.SNMP_COMMUNITY
    port = port or settings.SNMP_PORT
    version = version or "2c"

    ifaces: Dict[int, Dict] = {}

    walk_oids = [
        ("ifDescr",       "if_name"),
        ("ifType",        "if_type"),
        ("ifMtu",         "if_mtu"),
        ("ifSpeed",       "if_speed"),
        ("ifPhysAddress", "if_mac_raw"),
        ("ifAdminStatus", "if_admin_status"),
        ("ifOperStatus",  "if_oper_status"),
        ("ifAlias",       "if_alias"),
        ("ifHighSpeed",   "if_highspeed"),
    ]

    for oid_key, field in walk_oids:
        base = OIDS[oid_key]
        walked = await _walk(host, base, community, port, version)
        for oid_str, val in walked.items():
            idx = _idx_from_oid(oid_str, base)
            if idx is not None:
                ifaces.setdefault(idx, {"if_index": idx})
                ifaces[idx][field] = val

    result = []
    for idx, raw in ifaces.items():
        name = _safe_str(raw.get("if_name"))
        if not name:
            continue
        speed = _safe_int(raw.get("if_highspeed"))
        if not speed:
            speed_raw = _safe_int(raw.get("if_speed"))
            speed = (speed_raw // 1_000_000) if speed_raw else None

        result.append({
            "if_index":       idx,
            "if_name":        name,
            "if_alias":       _safe_str(raw.get("if_alias")),
            "if_type":        _safe_int(raw.get("if_type")),
            "if_mtu":         _safe_int(raw.get("if_mtu")),
            "if_speed":       speed,
            "if_mac":         _format_mac(raw.get("if_mac_raw")),
            "if_admin_status":_safe_int(raw.get("if_admin_status")),
            "if_oper_status": _safe_int(raw.get("if_oper_status")),
        })

    logger.info(f"Collected {len(result)} interfaces from {host}")
    return result


# ── Interface Counters ────────────────────────────────────────────────────────

async def collect_interface_counters(
    host: str,
    community: str = None,
    port: int = None,
    version: str = None,
) -> List[Dict[str, Any]]:
    """Coleta contadores de tráfego das interfaces."""
    community = community or settings.SNMP_COMMUNITY
    port = port or settings.SNMP_PORT
    version = version or "2c"

    counters: Dict[int, Dict] = {}
    ts = datetime.now(timezone.utc).isoformat()

    # Tenta 64-bit primeiro, depois 32-bit
    for oid_key in ["ifHCInOctets", "ifHCOutOctets", "ifInErrors", "ifOutErrors",
                    "ifInOctets", "ifOutOctets"]:
        base = OIDS[oid_key]
        walked = await _walk(host, base, community, port, version)
        for oid_str, val in walked.items():
            idx = _idx_from_oid(oid_str, base)
            if idx is not None:
                counters.setdefault(idx, {"if_index": idx})
                counters[idx][oid_key] = _safe_int(val)

    return [
        {
            "if_index":   idx,
            "in_octets":  c.get("ifHCInOctets") or c.get("ifInOctets"),
            "out_octets": c.get("ifHCOutOctets") or c.get("ifOutOctets"),
            "in_errors":  c.get("ifInErrors"),
            "out_errors": c.get("ifOutErrors"),
            "collected_at": ts,
        }
        for idx, c in counters.items()
    ]


# ── LLDP Neighbors ───────────────────────────────────────────────────────────

async def collect_lldp_neighbors(
    host: str,
    community: str = None,
    port: int = None,
    version: str = None,
) -> List[Dict[str, Any]]:
    """Coleta vizinhos LLDP para descoberta de topologia."""
    community = community or settings.SNMP_COMMUNITY
    port = port or settings.SNMP_PORT
    version = version or "2c"

    neighbors: Dict[str, Dict] = {}

    for oid_key in ["lldpRemSysName", "lldpRemPortId", "lldpRemPortDesc"]:
        base = OIDS[oid_key]
        walked = await _walk(host, base, community, port, version)
        for oid_str, val in walked.items():
            suffix = str(oid_str)[len(base):].lstrip(".")
            parts = suffix.split(".")
            if len(parts) >= 3:
                local_port = parts[1]
                remote_idx = parts[2]
                key = f"{local_port}.{remote_idx}"
                neighbors.setdefault(key, {
                    "local_port_index": int(local_port),
                    "remote_index":     int(remote_idx),
                })
                neighbors[key][oid_key] = _safe_str(val)

    result = list(neighbors.values())
    logger.info(f"LLDP: found {len(result)} neighbors on {host}")
    return result
