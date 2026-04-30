"""
Modelo de Log de eventos do sistema NetMap
"""
from datetime import datetime, timezone
from enum import Enum as PyEnum
from sqlalchemy import Column, Integer, String, DateTime, Text, Enum
from app.core.database import Base


class LogLevel(str, PyEnum):
    DEBUG = "debug"
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    SUCCESS = "success"


class LogCategory(str, PyEnum):
    SNMP = "snmp"
    PING = "ping"
    TOPOLOGY = "topology"
    SYSTEM = "system"
    API = "api"
    POLLER = "poller"


class EventLog(Base):
    __tablename__ = "event_logs"

    id = Column(Integer, primary_key=True, index=True)
    level = Column(Enum(LogLevel), nullable=False, default=LogLevel.INFO, index=True)
    category = Column(Enum(LogCategory), nullable=False, default=LogCategory.SYSTEM, index=True)
    device_id = Column(Integer, nullable=True, index=True)
    device_name = Column(String(255), nullable=True)
    message = Column(Text, nullable=False)
    detail = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
