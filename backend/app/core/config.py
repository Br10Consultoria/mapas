from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # App
    APP_NAME: str = "NetMap API"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False

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

    # CORS
    CORS_ORIGINS: list = ["http://localhost:3000", "http://localhost:80", "http://frontend:3000"]

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
