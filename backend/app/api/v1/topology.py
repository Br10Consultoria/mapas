from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.topology import Device, Interface, Link

router = APIRouter(
    prefix="/topology",
    tags=["Topology"],
    dependencies=[Depends(get_current_user)],
)


# ── Schemas ──────────────────────────────────────────────────────────────────

class NodeOut(BaseModel):
    id: str
    label: str
    ip_address: str
    device_type: str
    vendor: str
    status: str
    pos_x: Optional[float]
    pos_y: Optional[float]
    model: Optional[str]
    location: Optional[str]

    class Config:
        from_attributes = True


class EdgeOut(BaseModel):
    id: str
    source: str
    target: str
    source_interface: Optional[str]
    target_interface: Optional[str]
    bandwidth: Optional[float]
    discovered_via: Optional[str]

    class Config:
        from_attributes = True


class TopologyOut(BaseModel):
    nodes: List[NodeOut]
    edges: List[EdgeOut]


class LinkCreate(BaseModel):
    source_device_id: int
    target_device_id: int
    source_interface_id: Optional[int] = None
    target_interface_id: Optional[int] = None
    link_type: str = "ethernet"
    bandwidth: Optional[float] = None


class LinkOut(BaseModel):
    id: int
    source_device_id: int
    target_device_id: int
    source_interface_id: Optional[int]
    target_interface_id: Optional[int]
    link_type: str
    bandwidth: Optional[float]
    is_active: bool
    discovered_via: Optional[str]
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/", response_model=TopologyOut)
async def get_topology(db: AsyncSession = Depends(get_db)):
    """Retorna o grafo completo de topologia (nós + arestas) para o Cytoscape."""
    devices_result = await db.execute(
        select(Device).options(selectinload(Device.interfaces))
    )
    devices = devices_result.scalars().all()

    links_result = await db.execute(
        select(Link)
        .options(
            selectinload(Link.source_interface),
            selectinload(Link.target_interface),
        )
        .where(Link.is_active == True)
    )
    links = links_result.scalars().all()

    nodes = [
        NodeOut(
            id=str(d.id),
            label=d.name,
            ip_address=d.ip_address,
            device_type=d.device_type.value,
            vendor=d.vendor.value,
            status=d.status.value,
            pos_x=d.pos_x,
            pos_y=d.pos_y,
            model=d.model,
            location=d.location,
        )
        for d in devices
    ]

    edges = [
        EdgeOut(
            id=str(l.id),
            source=str(l.source_device_id),
            target=str(l.target_device_id),
            source_interface=l.source_interface.if_name if l.source_interface else None,
            target_interface=l.target_interface.if_name if l.target_interface else None,
            bandwidth=l.bandwidth,
            discovered_via=l.discovered_via,
        )
        for l in links
    ]

    return TopologyOut(nodes=nodes, edges=edges)


@router.post("/links", response_model=LinkOut, status_code=status.HTTP_201_CREATED)
async def create_link(payload: LinkCreate, db: AsyncSession = Depends(get_db)):
    """Cria um link manual entre dois dispositivos."""
    link = Link(**payload.model_dump(), discovered_via="manual")
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return link


@router.delete("/links/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_link(link_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Link).where(Link.id == link_id))
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")
    await db.delete(link)
    await db.commit()


@router.post("/discover", status_code=status.HTTP_202_ACCEPTED)
async def trigger_discovery():
    """Dispara descoberta de topologia via LLDP/CDP em background."""
    from app.services.poller import discover_topology
    import asyncio
    asyncio.create_task(discover_topology())
    return {"message": "Discovery started in background"}
