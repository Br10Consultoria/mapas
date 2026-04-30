import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import select, delete

from app.core.config import settings
from app.core.database import engine, Base, AsyncSessionLocal
from app.api.v1 import devices, topology, metrics, logs, auth
from app.models import log as _log_model   # noqa
from app.models import user as _user_model  # noqa

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


async def _create_default_admin():
    """Cria o usuário admin padrão se não existir nenhum usuário."""
    from app.models.user import User
    from app.services.auth_service import hash_password

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User))
        existing = result.scalars().first()
        if existing:
            return

        admin = User(
            username=settings.DEFAULT_ADMIN_USERNAME,
            email=settings.DEFAULT_ADMIN_EMAIL,
            full_name="Administrador",
            hashed_password=hash_password(settings.DEFAULT_ADMIN_PASSWORD),
            is_active=True,
            is_superuser=True,
            totp_enabled=False,
        )
        db.add(admin)
        await db.commit()
        logger.info(
            f"Admin padrão criado: username='{settings.DEFAULT_ADMIN_USERNAME}' "
            f"password='{settings.DEFAULT_ADMIN_PASSWORD}' — ALTERE A SENHA APÓS O PRIMEIRO LOGIN!"
        )


async def _setup_influxdb_retention():
    """Configura a retention policy de 7 dias no InfluxDB."""
    try:
        from influxdb_client.client.influxdb_client_async import InfluxDBClientAsync
        async with InfluxDBClientAsync(
            url=settings.INFLUXDB_URL,
            token=settings.INFLUXDB_TOKEN,
            org=settings.INFLUXDB_ORG,
        ) as client:
            buckets_api = client.buckets_api()
            buckets = await buckets_api.find_buckets_async(name=settings.INFLUXDB_BUCKET)
            if buckets and buckets.buckets:
                bucket = buckets.buckets[0]
                retention_seconds = settings.INFLUXDB_RETENTION_DAYS * 86400
                # Só atualiza se a retenção atual for diferente
                current = bucket.retention_rules[0].every_seconds if bucket.retention_rules else 0
                if current != retention_seconds:
                    from influxdb_client import BucketRetentionRules
                    bucket.retention_rules = [BucketRetentionRules(
                        type="expire",
                        every_seconds=retention_seconds,
                    )]
                    await buckets_api.update_bucket_async(bucket=bucket)
                    logger.info(f"InfluxDB: retenção configurada para {settings.INFLUXDB_RETENTION_DAYS} dias.")
    except Exception as e:
        logger.warning(f"Não foi possível configurar retenção no InfluxDB: {e}")


async def _cleanup_old_logs():
    """Remove logs com mais de LOG_RETENTION_DAYS dias do PostgreSQL."""
    from app.models.log import SystemLog
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.LOG_RETENTION_DAYS)
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                delete(SystemLog).where(SystemLog.created_at < cutoff)
            )
            deleted = result.rowcount
            await db.commit()
            if deleted > 0:
                logger.info(f"Limpeza de logs: {deleted} registros removidos (>{settings.LOG_RETENTION_DAYS} dias).")
    except Exception as e:
        logger.error(f"Erro ao limpar logs antigos: {e}")


async def _run_migrations():
    """Aplica migrações automáticas para adicionar colunas novas ao banco existente."""
    migrations = [
        # devices: colunas adicionadas após criação inicial
        "ALTER TABLE devices ADD COLUMN IF NOT EXISTS image_url VARCHAR;",
        "ALTER TABLE devices ADD COLUMN IF NOT EXISTS pos_x FLOAT DEFAULT 0;",
        "ALTER TABLE devices ADD COLUMN IF NOT EXISTS pos_y FLOAT DEFAULT 0;",
        # users: tabela de autenticação
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR;",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT FALSE;",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS backup_codes TEXT;",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP WITH TIME ZONE;",
    ]
    try:
        async with engine.begin() as conn:
            for sql in migrations:
                await conn.execute(__import__('sqlalchemy').text(sql))
        logger.info("Migrations automáticas aplicadas com sucesso.")
    except Exception as e:
        logger.warning(f"Aviso nas migrations automáticas: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting NetMap API...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables created/verified.")

    # Migration automática: adicionar colunas novas que possam não existir ainda
    await _run_migrations()

    # Criar admin padrão se necessário
    await _create_default_admin()

    # Configurar retenção no InfluxDB
    await _setup_influxdb_retention()

    # Importar jobs de polling
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
    # Limpeza de logs antigos a cada 6 horas
    scheduler.add_job(
        _cleanup_old_logs,
        IntervalTrigger(hours=settings.LOG_CLEANUP_INTERVAL_HOURS),
        id="cleanup_logs",
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

# CORS — permite qualquer origem para facilitar acesso local/remoto
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth.router, prefix="/api/v1")
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
