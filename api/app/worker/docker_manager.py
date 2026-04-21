"""
Docker SDK wrapper — manage Odoo containers and networks
"""
import uuid
import logging
from dataclasses import dataclass
from typing import Optional, Generator

import docker
from docker.models.containers import Container
from docker.models.networks import Network
from docker.errors import NotFound, APIError

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


ODOO_VERSION_IMAGES = {
    "16": settings.odoo_image_v16,
    "17": settings.odoo_image_v17,
    "18": settings.odoo_image_v18,
}


@dataclass
class OdooContainerConfig:
    project_slug: str
    branch_name: str
    odoo_version: str          # "16", "17", "18"
    db_name: str
    environment: str           # development / staging / production
    extra_env: dict = None
    addons_path: str = "/mnt/extra-addons"
    repo_path: str = ""        # host path to cloned repo
    mailhog_host: str = ""
    mailhog_smtp_port: int = 1025
    workers: int = 2


class DockerManager:
    """Central manager for Odoo Docker containers."""

    def __init__(self):
        self.client = docker.from_env()

    # ── Helpers ────────────────────────────────────────────────

    def _network_name(self, project_slug: str) -> str:
        return f"{settings.opsway_network_prefix}_{project_slug}"

    def _container_name(self, project_slug: str, branch_name: str) -> str:
        safe_branch = branch_name.replace("/", "-").replace("_", "-").lower()
        return f"opsway_{project_slug}_{safe_branch}"

    def _db_container_name(self, project_slug: str, branch_name: str) -> str:
        return f"{self._container_name(project_slug, branch_name)}_pg"

    def _traefik_host_rule(self, project_slug: str, branch_name: str) -> str:
        safe_branch = branch_name.replace("/", "-").replace("_", "-").lower()
        subdomain = f"{safe_branch}--{project_slug}"
        return f"Host(`{subdomain}.{settings.traefik_domain}`)"

    def _public_url(self, project_slug: str, branch_name: str) -> str:
        safe_branch = branch_name.replace("/", "-").replace("_", "-").lower()
        subdomain = f"{safe_branch}--{project_slug}"
        return f"http://{subdomain}.{settings.traefik_domain}"

    # ── Network ────────────────────────────────────────────────

    def ensure_project_network(self, project_slug: str) -> str:
        """Create isolated network for project if not exists."""
        name = self._network_name(project_slug)
        try:
            net = self.client.networks.get(name)
            logger.info(f"Network exists: {name}")
        except NotFound:
            net = self.client.networks.create(name, driver="bridge")
            logger.info(f"Created network: {name}")
        return name

    def remove_project_network(self, project_slug: str):
        name = self._network_name(project_slug)
        try:
            net = self.client.networks.get(name)
            net.remove()
            logger.info(f"Removed network: {name}")
        except NotFound:
            pass

    # ── PostgreSQL container for Odoo ──────────────────────────

    def start_postgres_container(
        self, project_slug: str, branch_name: str, db_name: str
    ) -> tuple[Container, str]:
        """Start a dedicated PostgreSQL container for an Odoo instance."""
        name = self._db_container_name(project_slug, branch_name)
        network = self._network_name(project_slug)

        try:
            container = self.client.containers.get(name)
            if container.status != "running":
                container.start()
            logger.info(f"Reusing postgres container: {name}")
            return container, name
        except NotFound:
            pass

        container = self.client.containers.run(
            "postgres:15-alpine",
            name=name,
            environment={
                "POSTGRES_DB": db_name,
                "POSTGRES_USER": "odoo",
                "POSTGRES_PASSWORD": "odoo",
            },
            network=network,
            detach=True,
            restart_policy={"Name": "unless-stopped"},
        )
        logger.info(f"Started postgres container: {name}")
        return container, name

    # ── Odoo Container ─────────────────────────────────────────

    def start_odoo_container(self, config: OdooContainerConfig) -> Container:
        """Build and start an Odoo container for a branch."""
        name = self._container_name(config.project_slug, config.branch_name)
        network = self._network_name(config.project_slug)
        db_host = self._db_container_name(config.project_slug, config.branch_name)
        image = ODOO_VERSION_IMAGES.get(config.odoo_version, settings.odoo_image_v17)
        url = self._public_url(config.project_slug, config.branch_name)

        # Stop existing if any
        self.stop_container(name, remove=True)

        # Build environment variables
        env = {
            "HOST": db_host,
            "USER": "odoo",
            "PASSWORD": "odoo",
        }

        # Neutralize for non-production environments
        if config.environment != "production":
            env["SMTP_SERVER"] = config.mailhog_host or settings.mailhog_host
            env["SMTP_PORT"] = str(config.mailhog_smtp_port or settings.mailhog_smtp_port)

        if config.extra_env:
            env.update(config.extra_env)

        # Traefik labels for auto-routing
        labels = {
            "traefik.enable": "true",
            f"traefik.http.routers.{name}.rule": self._traefik_host_rule(
                config.project_slug, config.branch_name
            ),
            f"traefik.http.routers.{name}.service": name,
            f"traefik.http.services.{name}.loadbalancer.server.port": "8069",
            "opsway.project": config.project_slug,
            "opsway.branch": config.branch_name,
            "opsway.environment": config.environment,
            "opsway.managed": "true",
        }

        # Volume mounts
        volumes = {}
        if config.repo_path:
            volumes[config.repo_path] = {
                "bind": "/mnt/extra-addons",
                "mode": "ro" if config.environment == "production" else "rw",
            }

        container = self.client.containers.run(
            image,
            name=name,
            environment=env,
            labels=labels,
            volumes=volumes,
            network=network,
            networks=["traefik_public"] if True else [],
            detach=True,
            restart_policy={"Name": "unless-stopped"},
        )

        # Also attach to traefik network
        try:
            traefik_net = self.client.networks.get("traefik_public")
            traefik_net.connect(container)
        except Exception as e:
            logger.warning(f"Could not attach to traefik_public: {e}")

        logger.info(f"Started Odoo container: {name} → {url}")
        return container

    # ── Container control ──────────────────────────────────────

    def stop_container(self, name_or_id: str, remove: bool = False):
        try:
            c = self.client.containers.get(name_or_id)
            c.stop(timeout=10)
            if remove:
                c.remove(force=True)
            logger.info(f"Stopped container: {name_or_id}")
        except NotFound:
            pass

    def get_container(self, name_or_id: str) -> Container | None:
        try:
            return self.client.containers.get(name_or_id)
        except NotFound:
            return None

    def get_container_status(self, name_or_id: str) -> str:
        c = self.get_container(name_or_id)
        return c.status if c else "not_found"

    def stream_logs(
        self, name_or_id: str, tail: int = 100
    ) -> Generator[str, None, None]:
        """Stream container logs as text lines."""
        c = self.get_container(name_or_id)
        if not c:
            yield f"Container {name_or_id} not found\n"
            return
        for line in c.logs(stream=True, follow=True, tail=tail):
            yield line.decode("utf-8", errors="replace")

    def exec_command(self, name_or_id: str, command: str) -> tuple[int, str]:
        """Run a command inside a container."""
        c = self.get_container(name_or_id)
        if not c:
            return 1, f"Container {name_or_id} not found"
        result = c.exec_run(command, demux=False)
        return result.exit_code, result.output.decode("utf-8", errors="replace")

    # ── Image management ───────────────────────────────────────

    def pull_image(self, image: str) -> None:
        """Pre-pull an Odoo image if not present."""
        try:
            self.client.images.get(image)
            logger.info(f"Image already local: {image}")
        except Exception:
            logger.info(f"Pulling image: {image}")
            self.client.images.pull(image)
            logger.info(f"Pulled: {image}")

    def list_opsway_containers(self) -> list[dict]:
        """List all containers managed by Opsway."""
        containers = self.client.containers.list(
            all=True,
            filters={"label": "opsway.managed=true"},
        )
        return [
            {
                "id": c.short_id,
                "name": c.name,
                "status": c.status,
                "project": c.labels.get("opsway.project"),
                "branch": c.labels.get("opsway.branch"),
                "environment": c.labels.get("opsway.environment"),
            }
            for c in containers
        ]
