"""
Cliente Redis para cache de métricas, status de dispositivos e pub/sub WebSocket.
"""
import json
import logging
from typing import Optional, Any

import redis.asyncio as aioredis
from app.core.config import settings

logger = logging.getLogger(__name__)

_redis: Optional[aioredis.Redis] = None


async def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            db=settings.REDIS_DB,
            password=settings.REDIS_PASSWORD,
            decode_responses=True,
            socket_connect_timeout=3,
            socket_timeout=3,
        )
    return _redis


async def redis_set(key: str, value: Any, ttl: int = 60) -> bool:
    """Salva valor no Redis com TTL em segundos. Retorna False se Redis não disponível."""
    try:
        r = await get_redis()
        await r.set(key, json.dumps(value), ex=ttl)
        return True
    except Exception as e:
        logger.debug(f"Redis set failed for key {key}: {e}")
        return False


async def redis_get(key: str) -> Optional[Any]:
    """Lê valor do Redis. Retorna None se não encontrado ou Redis indisponível."""
    try:
        r = await get_redis()
        val = await r.get(key)
        if val is None:
            return None
        return json.loads(val)
    except Exception as e:
        logger.debug(f"Redis get failed for key {key}: {e}")
        return None


async def redis_delete(key: str) -> bool:
    try:
        r = await get_redis()
        await r.delete(key)
        return True
    except Exception:
        return False


async def redis_publish(channel: str, message: Any) -> bool:
    """Publica mensagem em um canal pub/sub."""
    try:
        r = await get_redis()
        await r.publish(channel, json.dumps(message))
        return True
    except Exception as e:
        logger.debug(f"Redis publish failed: {e}")
        return False


# ── Chaves padronizadas ───────────────────────────────────────────────────────

def key_device_status(device_id: int) -> str:
    return f"netmap:device:{device_id}:status"


def key_device_metrics(device_id: int) -> str:
    return f"netmap:device:{device_id}:metrics"


def key_link_traffic(link_id: int) -> str:
    return f"netmap:link:{link_id}:traffic"


def key_topology_snapshot() -> str:
    return "netmap:topology:snapshot"
