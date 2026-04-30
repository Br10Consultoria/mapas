from pydantic_settings import BaseSettings
from typing import Optional
import secrets


class Settings(BaseSettings):
    # App
    APP_NAME: str = "NetMap API"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False

    # JWT
    JWT_SECRET_KEY: str = "CHANGE_ME_IN_PRODUCTION_USE_A_LONG_RANDOM_STRING"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # Admin padrão (criado automaticamente na primeira execução)
    DEFAULT_ADMIN_USERNAME: str = "admin"
    DEFAULT_ADMIN_PASSWORD: str = "netmap@2024"
    DEFAULT_ADMIN_EMAIL: str = "admin@netmap.local"

    # PostgreSQL
    POSTGRES_HOST: str = "postgres"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "netmap"
    POSTGRES_PASSWORD: str = "netmap123"
    POSTGRES_DB: str = "netmap"

    @property
    def DATABASE_URL(self) -> str:
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @property
    def SYNC_DATABASE_URL(self) -> str:
        return (
            f"postgresql://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    # InfluxDB
    INFLUXDB_URL: str = "http://influxdb:8086"
    INFLUXDB_TOKEN: str = "netmap-super-secret-token"
    INFLUXDB_ORG: str = "netmap"
    INFLUXDB_BUCKET: str = "network_metrics"
    # Retenção de dados de métricas (dias)
    INFLUXDB_RETENTION_DAYS: int = 7

    # Redis
    REDIS_HOST: str = "127.0.0.1"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0
    REDIS_PASSWORD: Optional[str] = None
    # TTL do cache de métricas em segundos (2x o intervalo de polling)
    REDIS_METRICS_TTL: int = 120
    # TTL do cache de status dos dispositivos
    REDIS_STATUS_TTL: int = 60

    # SNMP defaults
    SNMP_COMMUNITY: str = "public"
    SNMP_VERSION: str = "2c"
    SNMP_TIMEOUT: int = 5
    SNMP_RETRIES: int = 2
    SNMP_PORT: int = 161

    # Polling intervals (seconds)
    POLL_INTERVAL_INTERFACES: int = 60
    POLL_INTERVAL_STATUS: int = 30
    POLL_INTERVAL_DISCOVERY: int = 300

    # Retenção de logs no PostgreSQL (dias)
    LOG_RETENTION_DAYS: int = 7
    # Intervalo de limpeza de logs antigos (horas)
    LOG_CLEANUP_INTERVAL_HOURS: int = 6

    # CORS
    CORS_ORIGINS: list = ["http://localhost:3000", "http://localhost:80", "http://frontend:3000"]

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
