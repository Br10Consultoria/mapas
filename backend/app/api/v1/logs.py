"""
API de Logs e Diagnóstico (Ping)
"""
import asyncio
import logging
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from datetime import datetime, timezone

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.log import LogLevel, LogCategory
from app.models.user import User
from app.services.log_service import get_logs, clear_logs, add_log

logger = logging.getLogger(__name__)
router = APIRouter(
    tags=["Logs & Diagnostics"],
    dependencies=[Depends(get_current_user)],
)


# ── Schemas ───────────────────────────────────────────────────────────────────

class PingResult(BaseModel):
    host: str
    reachable: bool
    avg_ms: Optional[float] = None
    min_ms: Optional[float] = None
    max_ms: Optional[float] = None
    packet_loss: float = 0.0
    output: str = ""


# ── Logs ──────────────────────────────────────────────────────────────────────

@router.get("/logs")
async def list_logs(
    level: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    device_id: Optional[int] = Query(None),
    limit: int = Query(200, le=1000),
    db: AsyncSession = Depends(get_db),
):
    return await get_logs(db, level=level, category=category, device_id=device_id, limit=limit)


@router.delete("/logs", status_code=204)
async def delete_logs(db: AsyncSession = Depends(get_db)):
    await clear_logs(db)


# ── Ping ──────────────────────────────────────────────────────────────────────

@router.post("/diagnostics/ping", response_model=PingResult)
async def ping_host(
    host: str = Query(..., description="IP ou hostname para pingar"),
    count: int = Query(4, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
):
    """Executa ping para um host e retorna estatísticas."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ping", "-c", str(count), "-W", "3", host,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
        output = stdout.decode("utf-8", errors="replace")

        reachable = proc.returncode == 0
        avg_ms = min_ms = max_ms = None
        packet_loss = 100.0

        # Parse packet loss
        for line in output.splitlines():
            if "packet loss" in line:
                parts = line.split(",")
                for p in parts:
                    if "packet loss" in p:
                        try:
                            packet_loss = float(p.strip().split("%")[0].split()[-1])
                        except Exception:
                            pass

            # Parse rtt min/avg/max
            if "rtt min/avg/max" in line or "round-trip min/avg/max" in line:
                try:
                    stats = line.split("=")[1].strip().split("/")
                    min_ms = float(stats[0])
                    avg_ms = float(stats[1])
                    max_ms = float(stats[2].split()[0])
                except Exception:
                    pass

        # Registrar no log
        level = LogLevel.SUCCESS if reachable else LogLevel.WARNING
        msg = f"Ping {host}: {'OK' if reachable else 'FALHOU'}"
        if avg_ms:
            msg += f" | avg={avg_ms:.1f}ms loss={packet_loss:.0f}%"
        await add_log(db, msg, level=level, category=LogCategory.PING, detail=output[:500])

        return PingResult(
            host=host,
            reachable=reachable,
            avg_ms=avg_ms,
            min_ms=min_ms,
            max_ms=max_ms,
            packet_loss=packet_loss,
            output=output,
        )

    except asyncio.TimeoutError:
        await add_log(db, f"Ping {host}: TIMEOUT", level=LogLevel.ERROR, category=LogCategory.PING)
        return PingResult(host=host, reachable=False, packet_loss=100.0, output="Timeout")
    except Exception as e:
        await add_log(db, f"Ping {host}: ERRO - {e}", level=LogLevel.ERROR, category=LogCategory.PING)
        return PingResult(host=host, reachable=False, packet_loss=100.0, output=str(e))
