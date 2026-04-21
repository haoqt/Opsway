from pydantic_settings import BaseSettings
from pydantic import Field
from functools import lru_cache


class Settings(BaseSettings):
    # App
    app_env: str = "development"
    secret_key: str = "change-me-super-secret-key-32chars"
    frontend_url: str = "http://localhost:3000"
    debug: bool = False
    
    # Init Data (comma separated: email:pass:username,...)
    initial_accounts: str = ""

    # Database
    database_url: str = "postgresql+asyncpg://opsway:opsway_secret@postgres:5432/opsway"
    database_sync_url: str = "postgresql+psycopg2://opsway:opsway_secret@postgres:5432/opsway"

    # Redis
    redis_url: str = "redis://redis:6379/0"
    celery_broker_url: str = "redis://redis:6379/0"
    celery_result_backend: str = "redis://redis:6379/1"

    # GitHub OAuth
    github_client_id: str = ""
    github_client_secret: str = ""
    github_webhook_secret: str = "webhook-secret"

    # MinIO
    minio_endpoint: str = "minio:9000"
    minio_access_key: str = "opsway_minio"
    minio_secret_key: str = "opsway_minio_secret"
    minio_bucket_backups: str = "opsway-backups"
    minio_secure: bool = False

    # MailHog
    mailhog_host: str = "mailhog"
    mailhog_smtp_port: int = 1025

    # Docker
    docker_socket: str = "unix:///var/run/docker.sock"
    opsway_network_prefix: str = "opsway_proj"

    # Build
    build_workspace: str = "/opt/opsway/builds"
    build_timeout: int = 600
    max_concurrent_builds: int = 5

    # Odoo images
    odoo_image_v16: str = "odoo:16.0"
    odoo_image_v17: str = "odoo:17.0"
    odoo_image_v18: str = "odoo:18.0"

    # JWT
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 10080   # 7 days

    # Traefik
    traefik_domain: str = "localhost"

    model_config = {"env_file": ".env", "extra": "ignore"}

    @property
    def odoo_images(self) -> dict[str, str]:
        return {
            "16": self.odoo_image_v16,
            "17": self.odoo_image_v17,
            "18": self.odoo_image_v18,
        }

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
