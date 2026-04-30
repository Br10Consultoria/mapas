import os
import shutil
import uuid
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.topology import Device, Interface, DeviceType, DeviceVendor, DeviceStatus
from app.models.user import User

router = APIRouter(
    prefix="/devices",
    tags=["Devices"],
    dependencies=[Depends(get_current_user)],
)

UPLOAD_DIR = "/app/uploads/devices"
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"}


# ── Schemas ──────────────────────────────────────────────────────────────────

class DeviceCreate(BaseModel):
    name: str
    hostname: str
    ip_address: str
    device_type: DeviceType = DeviceType.UNKNOWN
    vendor: DeviceVendor = DeviceVendor.GENERIC
    model: Optional[str] = None
    description: Optional[str] = None
    location: Optional[str] = None
    contact: Optional[str] = None
    snmp_community: str = "public"
    snmp_version: str = "2c"
    snmp_port: int = 161
    snmp_enabled: bool = True
    pos_x: Optional[float] = None
    pos_y: Optional[float] = None


class DeviceUpdate(BaseModel):
    name: Optional[str] = None
    device_type: Optional[DeviceType] = None
    vendor: Optional[DeviceVendor] = None
    model: Optional[str] = None
    description: Optional[str] = None
    location: Optional[str] = None
    contact: Optional[str] = None
    snmp_community: Optional[str] = None
    snmp_version: Optional[str] = None
    snmp_port: Optional[int] = None
    snmp_enabled: Optional[bool] = None
    pos_x: Optional[float] = None
    pos_y: Optional[float] = None


class InterfaceOut(BaseModel):
    id: int
    if_index: int
    if_name: str
    if_alias: Optional[str]
    if_speed: Optional[float]
    if_mac: Optional[str]
    if_admin_status: Optional[int]
    if_oper_status: Optional[int]
    ip_address: Optional[str]
    ip_mask: Optional[str]

    class Config:
        from_attributes = True


class DeviceOut(BaseModel):
    id: int
    name: str
    hostname: str
    ip_address: str
    device_type: DeviceType
    vendor: DeviceVendor
    model: Optional[str]
    description: Optional[str]
    location: Optional[str]
    contact: Optional[str]
    status: DeviceStatus
    last_seen: Optional[datetime]
    uptime: Optional[int]
    snmp_enabled: bool
    pos_x: Optional[float]
    pos_y: Optional[float]
    image_url: Optional[str]
    created_at: Optional[datetime]
    interfaces: List[InterfaceOut] = []

    class Config:
        from_attributes = True


class DevicePositionUpdate(BaseModel):
    pos_x: float
    pos_y: float


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/", response_model=List[DeviceOut])
async def list_devices(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Device).options(selectinload(Device.interfaces)).order_by(Device.name)
    )
    return result.scalars().all()


@router.post("/", response_model=DeviceOut, status_code=status.HTTP_201_CREATED)
async def create_device(payload: DeviceCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(
        select(Device).where(
            (Device.ip_address == payload.ip_address) |
            (Device.hostname == payload.hostname)
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Device with this IP or hostname already exists.",
        )
    device = Device(**payload.model_dump())
    db.add(device)
    await db.commit()
    result2 = await db.execute(
        select(Device).options(selectinload(Device.interfaces)).where(Device.id == device.id)
    )
    return result2.scalar_one()


@router.get("/{device_id}", response_model=DeviceOut)
async def get_device(device_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Device)
        .options(selectinload(Device.interfaces))
        .where(Device.id == device_id)
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


@router.put("/{device_id}", response_model=DeviceOut)
async def update_device(device_id: int, payload: DeviceUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    for key, val in payload.model_dump(exclude_none=True).items():
        setattr(device, key, val)
    await db.commit()
    result2 = await db.execute(
        select(Device).options(selectinload(Device.interfaces)).where(Device.id == device_id)
    )
    return result2.scalar_one()


@router.post("/{device_id}/image", response_model=DeviceOut)
async def upload_device_image(
    device_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Faz upload de imagem/ícone personalizado para o dispositivo."""
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Tipo de arquivo não suportado: {file.content_type}. Use JPG, PNG, GIF, WebP ou SVG.",
        )

    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    # Remove imagem anterior se existir
    if device.image_url:
        old_path = f"/app{device.image_url}"
        if os.path.exists(old_path):
            os.remove(old_path)

    # Salva nova imagem com nome único
    ext = os.path.splitext(file.filename or "img.png")[1] or ".png"
    filename = f"{device_id}_{uuid.uuid4().hex[:8]}{ext}"
    save_path = os.path.join(UPLOAD_DIR, filename)

    with open(save_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    device.image_url = f"/uploads/devices/{filename}"
    await db.commit()

    result2 = await db.execute(
        select(Device).options(selectinload(Device.interfaces)).where(Device.id == device_id)
    )
    return result2.scalar_one()


@router.delete("/{device_id}/image", response_model=DeviceOut)
async def delete_device_image(device_id: int, db: AsyncSession = Depends(get_db)):
    """Remove a imagem personalizada do dispositivo."""
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    if device.image_url:
        old_path = f"/app{device.image_url}"
        if os.path.exists(old_path):
            os.remove(old_path)
        device.image_url = None
        await db.commit()

    result2 = await db.execute(
        select(Device).options(selectinload(Device.interfaces)).where(Device.id == device_id)
    )
    return result2.scalar_one()


@router.patch("/{device_id}/position", response_model=DeviceOut)
async def update_device_position(device_id: int, payload: DevicePositionUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    device.pos_x = payload.pos_x
    device.pos_y = payload.pos_y
    await db.commit()
    result2 = await db.execute(
        select(Device).options(selectinload(Device.interfaces)).where(Device.id == device_id)
    )
    return result2.scalar_one()


@router.delete("/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_device(device_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    await db.delete(device)
    await db.commit()


@router.post("/{device_id}/poll", response_model=DeviceOut)
async def poll_device_now(device_id: int, db: AsyncSession = Depends(get_db)):
    """Força polling imediato de um dispositivo."""
    from app.services.poller import poll_device_status, poll_interfaces
    from datetime import timezone

    result = await db.execute(
        select(Device).options(selectinload(Device.interfaces)).where(Device.id == device_id)
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    new_status = await poll_device_status(device)
    device.status = new_status
    if new_status != DeviceStatus.DOWN:
        device.last_seen = datetime.now(timezone.utc)
        await poll_interfaces(device, db)
    else:
        await db.commit()

    await db.refresh(device)
    return device
