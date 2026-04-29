from sqlalchemy import (
    Column, String, Integer, Float, Boolean, DateTime, Text,
    ForeignKey, UniqueConstraint, Enum as SAEnum
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base
import enum


class DeviceType(str, enum.Enum):
    ROUTER = "router"
    SWITCH = "switch"
    FIREWALL = "firewall"
    SERVER = "server"
    UNKNOWN = "unknown"


class DeviceVendor(str, enum.Enum):
    HUAWEI = "huawei"
    MIKROTIK = "mikrotik"
    DATACOM = "datacom"
    CISCO = "cisco"
    GENERIC = "generic"


class DeviceStatus(str, enum.Enum):
    UP = "up"
    DOWN = "down"
    DEGRADED = "degraded"
    UNKNOWN = "unknown"


class Device(Base):
    __tablename__ = "devices"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    hostname = Column(String(255), unique=True, nullable=False, index=True)
    ip_address = Column(String(45), unique=True, nullable=False, index=True)
    device_type = Column(SAEnum(DeviceType), default=DeviceType.UNKNOWN)
    vendor = Column(SAEnum(DeviceVendor), default=DeviceVendor.GENERIC)
    model = Column(String(255), nullable=True)
    os_version = Column(String(255), nullable=True)
    serial_number = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    location = Column(String(255), nullable=True)
    contact = Column(String(255), nullable=True)

    # SNMP config
    snmp_community = Column(String(255), default="public")
    snmp_version = Column(String(10), default="2c")
    snmp_port = Column(Integer, default=161)
    snmp_enabled = Column(Boolean, default=True)

    # Status
    status = Column(SAEnum(DeviceStatus), default=DeviceStatus.UNKNOWN)
    last_seen = Column(DateTime(timezone=True), nullable=True)
    uptime = Column(Integer, nullable=True)  # seconds

    # Map position
    pos_x = Column(Float, nullable=True)
    pos_y = Column(Float, nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    interfaces = relationship("Interface", back_populates="device", cascade="all, delete-orphan")
    links_as_source = relationship("Link", foreign_keys="Link.source_device_id", back_populates="source_device")
    links_as_target = relationship("Link", foreign_keys="Link.target_device_id", back_populates="target_device")


class Interface(Base):
    __tablename__ = "interfaces"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    if_index = Column(Integer, nullable=False)
    if_name = Column(String(255), nullable=False)
    if_alias = Column(String(255), nullable=True)
    if_description = Column(Text, nullable=True)
    if_type = Column(Integer, nullable=True)
    if_speed = Column(Float, nullable=True)  # bps
    if_mtu = Column(Integer, nullable=True)
    if_mac = Column(String(17), nullable=True)
    if_admin_status = Column(Integer, nullable=True)  # 1=up, 2=down
    if_oper_status = Column(Integer, nullable=True)   # 1=up, 2=down
    ip_address = Column(String(45), nullable=True)
    ip_mask = Column(String(45), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("device_id", "if_index", name="uq_device_interface"),
    )

    device = relationship("Device", back_populates="interfaces")
    links_as_source = relationship("Link", foreign_keys="Link.source_interface_id", back_populates="source_interface")
    links_as_target = relationship("Link", foreign_keys="Link.target_interface_id", back_populates="target_interface")


class Link(Base):
    __tablename__ = "links"

    id = Column(Integer, primary_key=True, index=True)
    source_device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    target_device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    source_interface_id = Column(Integer, ForeignKey("interfaces.id", ondelete="SET NULL"), nullable=True)
    target_interface_id = Column(Integer, ForeignKey("interfaces.id", ondelete="SET NULL"), nullable=True)
    link_type = Column(String(50), default="ethernet")
    bandwidth = Column(Float, nullable=True)  # bps
    is_active = Column(Boolean, default=True)
    discovered_via = Column(String(50), nullable=True)  # lldp, cdp, manual

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    source_device = relationship("Device", foreign_keys=[source_device_id], back_populates="links_as_source")
    target_device = relationship("Device", foreign_keys=[target_device_id], back_populates="links_as_target")
    source_interface = relationship("Interface", foreign_keys=[source_interface_id], back_populates="links_as_source")
    target_interface = relationship("Interface", foreign_keys=[target_interface_id], back_populates="links_as_target")
