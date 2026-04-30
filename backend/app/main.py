import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.core.config import settings
from app.core.database import engine, Base
from app.api.v1 import devices, topology, metrics, logs
from app.models import log as _log_model  # noqa: ensure table is created

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create tables
    logger.info("Starting NetMap API...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables created/verified.")

    # Schedule polling jobs
    from app.services.poller import (
        poll_all_devices,
        poll_interface_metrics,
        discover_topology,
    )

    scheduler.add_job(
        poll_all_devices,
        IntervalTrigger(seconds=settings.POLL_INTERVAL_STATUS),
        id="poll_status",
        replace_existing=True,
    )
    scheduler.add_job(
        poll_interface_metrics,
        IntervalTrigger(seconds=settings.POLL_INTERVAL_INTERFACES),
        id="poll_metrics",
        replace_existing=True,
    )
    scheduler.add_job(
        discover_topology,
        IntervalTrigger(seconds=settings.POLL_INTERVAL_DISCOVERY),
        id="discover_topology",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("Scheduler started.")

    yield

    # Shutdown
    scheduler.shutdown()
    await engine.dispose()
    logger.info("NetMap API stopped.")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="API para sistema de mapa de redes com monitoramento SNMP em tempo real.",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(devices.router, prefix="/api/v1")
app.include_router(topology.router, prefix="/api/v1")
app.include_router(metrics.router, prefix="/api/v1")
app.include_router(logs.router, prefix="/api/v1")

# Servir uploads de imagens
os.makedirs("/app/uploads/devices", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="/app/uploads"), name="uploads")


@app.get("/health")
async def health_check():
    return {"status": "ok", "version": settings.APP_VERSION}


@app.get("/")
async def root():
    return {
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs": "/docs",
    }
