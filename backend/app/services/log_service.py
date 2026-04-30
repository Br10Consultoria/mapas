"""
Serviço de log centralizado - persiste eventos no banco e emite via WebSocket
"""
import logging
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.models.log import EventLog, LogLevel, LogCategory

logger = logging.getLogger(__name__)

# Buffer em memória para logs recentes (últimos 500)
_log_buffer: list[dict] = []
MAX_BUFFER = 500


def _to_dict(log: EventLog) -> dict:
    return {
        "id": log.id,
        "level": log.level,
        "category": log.category,
        "device_id": log.device_id,
        "device_name": log.device_name,
        "message": log.message,
        "detail": log.detail,
        "created_at": log.created_at.isoformat() if log.created_at else None,
    }


async def add_log(
    db: AsyncSession,
    message: str,
    level: LogLevel = LogLevel.INFO,
    category: LogCategory = LogCategory.SYSTEM,
    device_id: Optional[int] = None,
    device_name: Optional[str] = None,
    detail: Optional[str] = None,
) -> EventLog:
    """Persiste um log no banco e adiciona ao buffer em memória."""
    entry = EventLog(
        level=level,
        category=category,
        device_id=device_id,
        device_name=device_name,
        message=message,
        detail=detail,
        created_at=datetime.now(timezone.utc),
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)

    d = _to_dict(entry)
    _log_buffer.append(d)
    if len(_log_buffer) > MAX_BUFFER:
        _log_buffer.pop(0)

    return entry


async def get_logs(
    db: AsyncSession,
    level: Optional[str] = None,
    category: Optional[str] = None,
    device_id: Optional[int] = None,
    limit: int = 200,
) -> list[dict]:
    """Retorna logs filtrados do banco."""
    q = select(EventLog).order_by(EventLog.created_at.desc()).limit(limit)
    if level:
        q = q.where(EventLog.level == level)
    if category:
        q = q.where(EventLog.category == category)
    if device_id:
        q = q.where(EventLog.device_id == device_id)
    result = await db.execute(q)
    return [_to_dict(r) for r in result.scalars().all()]


async def clear_logs(db: AsyncSession) -> int:
    """Remove todos os logs do banco."""
    result = await db.execute(delete(EventLog))
    await db.commit()
    _log_buffer.clear()
    return result.rowcount
