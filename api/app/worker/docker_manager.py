"""
Docker SDK wrapper — manage Odoo containers and networks
"""
import uuid
import logging
import socket
import random
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
    "15": settings.odoo_image_v15,
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
    init_db: bool = False      # if True, runs with -i base --stop-after-init
    upgrade_modules: list[str] = None  # if set, runs with -u module1,module2 --stop-after-init
    custom_domain: str | None = None  # e.g. "erp.mycompany.com"
    preferred_port: int | None = None
    odoo_image: str | None = None          # explicit image override
    extra_volumes: list[str] = None        # extra mounts: ["./path:/container/path:ro", ...]
    command_override: str | list | None = None  # replaces default odoo command for persistent run


class DockerManager:
    """Central manager for Odoo Docker containers."""

    def __init__(self):
        self.client = docker.from_env()

    # ── Helpers ────────────────────────────────────────────────

    def _network_name(self, project_slug: str) -> str:
        return f"{settings.opsway_network_prefix}_{project_slug}"

    def get_container_name(self, project_slug: str, branch_name: str) -> str:
        safe_project = project_slug.replace("_", "-").lower()
        safe_branch = branch_name.replace("/", "-").replace("_", "-").lower()
        return f"{settings.opsway_network_prefix}-{safe_project}-{safe_branch}"

    def get_db_container_name(self, project_slug: str, branch_name: str) -> str:
        return f"{self.get_container_name(project_slug, branch_name)}-pg"

    def get_container(self, name_or_id: str) -> Optional[Container]:
        try:
            return self.client.containers.get(name_or_id)
        except NotFound:
            return None

    def get_container_host_port(self, name: str, project_slug: str, branch_name: str) -> Optional[int]:
        """Try to find the port previously used by this container/branch."""
        # 1. Try by name directly
        container = self.get_container(name)
        if container:
            port = self._extract_port(container)
            if port:
                return port

        # 2. Try by labels (search through stopped/older containers)
        try:
            filters = {
                "label": [
                    f"opsway.project={project_slug}",
                    f"opsway.branch={branch_name}",
                ]
            }
            # Sort by created time descending to get the most recent one
            containers = self.client.containers.list(all=True, filters=filters)
            if containers:
                # Filter for those that have a port mapping
                for c in sorted(containers, key=lambda x: x.attrs.get("Created", ""), reverse=True):
                    port = self._extract_port(c)
                    if port:
                        return port
        except Exception:
            pass
        return None

    def _extract_port(self, container) -> Optional[int]:
        """Extract host port from container attributes."""
        try:
            ports = container.attrs.get("NetworkSettings", {}).get("Ports", {}) or {}
            # Also check HostConfig for stopped containers
            if not ports:
                ports = container.attrs.get("HostConfig", {}).get("PortBindings", {}) or {}

            mappings = ports.get("8069/tcp")
            if mappings:
                return int(mappings[0].get("HostPort"))
        except Exception:
            pass
        return None


    def _find_free_port(self, start=10000, end=20000) -> Optional[int]:
        """Find an available port on the host in the specified range."""
        used_ports = set()
        
        # 1. Check all Docker containers for mapped ports
        try:
            for container in self.client.containers.list(all=True):
                ports = container.attrs.get("HostConfig", {}).get("PortBindings")
                if ports:
                    for binding_list in ports.values():
                        if binding_list:
                            for binding in binding_list:
                                p = binding.get("HostPort")
                                if p:
                                    used_ports.add(int(p))
        except Exception as e:
            logger.warning(f"Error scanning for used Docker ports: {e}")

        # 2. Try to find a port not in used_ports AND available for binding via socket
        # Use a randomized starting point to avoid collisions with parallel workers
        search_range = list(range(start, end + 1))
        random.shuffle(search_range)
        
        for port in search_range:
            if port in used_ports:
                continue
            
            # Check if OS says the port is free to bind
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                try:
                    s.settimeout(0.5)
                    s.bind(("0.0.0.0", port))
                    # If we can bind, it's really free
                    return port
                except (OSError, socket.error):
                    # Port is probably used by the system or another process
                    logger.debug(f"Port {port} is busy at host level, skipping...")
                    continue
        
        return None

    def _public_url(self, project_slug: str, branch_name: str, custom_domain: str | None = None, environment: str = "development") -> str:
        """Construct the public URL for a branch."""
        if custom_domain:
            return f"https://{custom_domain}"
        
        safe_project = project_slug.replace("_", "-").lower()
        safe_branch = branch_name.replace("/", "-").replace("_", "-").lower()
        
        # If we have a configured traefik domain (like opsway.dev)
        if settings.traefik_domain and settings.traefik_domain != "localhost":
            return f"https://{safe_branch}.{safe_project}.{settings.traefik_domain}"
        
        return f"http://{safe_branch}.{safe_project}.localhost"

    # ── Network ────────────────────────────────────────────────

    def ensure_project_network(self, project_slug: str, driver_opts: dict | None = None) -> str:
        """Create isolated network for project if not exists."""
        name = self._network_name(project_slug)
        try:
            net = self.client.networks.get(name)
            logger.info(f"Network exists: {name}")
        except NotFound:
            create_kwargs: dict = {"driver": "bridge"}
            if driver_opts:
                create_kwargs["options"] = driver_opts
            net = self.client.networks.create(name, **create_kwargs)
            logger.info(f"Created network: {name} opts={driver_opts or {}}")
        return name

    def add_network_aliases(self, container: Container, project_slug: str, aliases: list[str]) -> None:
        """Add hostname aliases for a container on the project network (e.g. 'database')."""
        network_name = self._network_name(project_slug)
        try:
            net = self.client.networks.get(network_name)
            net.disconnect(container)
            net.connect(container, aliases=aliases)
            logger.info(f"Network aliases {aliases} → {container.name}")
        except Exception as e:
            logger.warning(f"Could not set network aliases {aliases} for {container.name}: {e}")

    def remove_project_network(self, project_slug: str):
        name = self._network_name(project_slug)
        try:
            net = self.client.networks.get(name)
            net.remove()
            logger.info(f"Removed network: {name}")
        except NotFound:
            pass

    # ── Depends services ──────────────────────────────────────

    def start_depends_container(
        self, project_slug: str, branch_name: str, svc: dict
    ) -> Container:
        """Start an extra service declared under 'depends' in .opsway.yml."""
        svc_name = svc.get("name") or svc.get("image", "svc").split(":")[0].split("/")[-1]
        safe_project = project_slug.replace("_", "-").lower()
        safe_branch = branch_name.replace("/", "-").replace("_", "-").lower()
        name = f"{settings.opsway_network_prefix}-{safe_project}-{safe_branch}-{svc_name}"
        network = self._network_name(project_slug)

        try:
            c = self.client.containers.get(name)
            if c.status != "running":
                c.start()
            return c
        except NotFound:
            pass

        env = {}
        raw_env = svc.get("env") or {}
        if isinstance(raw_env, dict):
            env = {k: str(v) for k, v in raw_env.items() if v is not None}

        volumes = {}
        for vol_str in (svc.get("volumes") or []):
            parts = vol_str.split(":")
            if len(parts) >= 2:
                volumes[parts[0]] = {"bind": parts[1], "mode": parts[2] if len(parts) >= 3 else "rw"}

        container = self.client.containers.run(
            svc["image"],
            name=name,
            environment=env,
            volumes=volumes or None,
            network=network,
            labels={"opsway.managed": "true", "opsway.project": project_slug,
                    "opsway.branch": branch_name, "opsway.type": "depends"},
            detach=True,
            restart_policy={"Name": "unless-stopped"},
        )
        logger.info(f"Started depends container: {name}")
        return container

    # ── PostgreSQL container for Odoo ──────────────────────────

    def start_postgres_container(
        self, project_slug: str, branch_name: str, db_name: str,
        *,
        pg_image: str = "postgres:15-alpine",
        shm_size: str | None = None,
        extra_env: dict | None = None,
        extra_volumes: list[str] | None = None,
    ) -> tuple[Container, str]:
        """Start a dedicated PostgreSQL container for an Odoo instance."""
        name = self.get_db_container_name(project_slug, branch_name)
        network = self._network_name(project_slug)

        try:
            container = self.client.containers.get(name)
            if container.status != "running":
                container.start()
            logger.info(f"Reusing postgres container: {name}")
            return container, name
        except NotFound:
            pass

        env = {
            "POSTGRES_DB": db_name,
            "POSTGRES_USER": "odoo",
            "POSTGRES_PASSWORD": "odoo",
        }
        if extra_env:
            env.update(extra_env)
        # Opsway always controls these to keep Odoo connectivity consistent
        env["POSTGRES_DB"] = db_name

        import os as _os
        volumes = {}
        for vol_str in (extra_volumes or []):
            parts = vol_str.split(":")
            if len(parts) >= 2:
                src = parts[0]
                if src.startswith("/") and not _os.path.exists(src):
                    logger.warning(f"Skipping postgres volume: {src} not found")
                    continue
                volumes[src] = {"bind": parts[1], "mode": parts[2] if len(parts) >= 3 else "rw"}

        run_kwargs: dict = dict(
            name=name,
            environment=env,
            labels={
                "opsway.managed": "true",
                "opsway.project": project_slug,
                "opsway.branch": branch_name,
                "opsway.type": "database",
            },
            network=network,
            volumes=volumes or None,
            detach=True,
            restart_policy={"Name": "unless-stopped"},
        )
        if shm_size:
            run_kwargs["shm_size"] = shm_size

        container = self.client.containers.run(pg_image, **run_kwargs)
        logger.info(f"Started postgres container: {name} image={pg_image}")
        return container, name

    # ── Odoo Container ─────────────────────────────────────────

    def start_odoo_container(self, config: OdooContainerConfig) -> tuple[Container, int | None, str]:
        """Build and start an Odoo container for a branch."""
        name = self.get_container_name(config.project_slug, config.branch_name)
        network = self._network_name(config.project_slug)
        db_host = self.get_db_container_name(config.project_slug, config.branch_name)
        default_image = ODOO_VERSION_IMAGES.get(config.odoo_version, settings.odoo_image_v17)
        image = config.odoo_image or default_image

        # Verify compose image is pullable; fall back to default on error
        if config.odoo_image:
            try:
                self.client.images.get(config.odoo_image)
            except docker.errors.ImageNotFound:
                try:
                    parts = config.odoo_image.rsplit(":", 1)
                    repo, tag = (parts[0], parts[1]) if len(parts) == 2 else (parts[0], "latest")
                    self.client.images.pull(repo, tag=tag)
                    logger.info(f"Pulled compose image: {config.odoo_image}")
                except Exception as e:
                    logger.warning(f"Cannot pull compose image {config.odoo_image}: {e}. Using default {default_image}")
                    image = default_image

        # Find a host port for NAT
        # 1. Try to reuse existing port if container already exists
        host_port = self.get_container_host_port(name, config.project_slug, config.branch_name)
        
        # 2. Try preferred port if no container found
        if not host_port and config.preferred_port:
            host_port = config.preferred_port
            
        # 3. If no existing port or it's a temp run, find a new one
        is_temp_run = config.init_db or (config.upgrade_modules and len(config.upgrade_modules) > 0)
        if not host_port or is_temp_run:
            host_port = self._find_free_port()
            
        if host_port:
            url = f"http://localhost:{host_port}"
        else:
            url = self._public_url(config.project_slug, config.branch_name, config.custom_domain, config.environment)

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
        # Opsway always controls the DB host — overwrite any user-supplied value
        env["HOST"] = db_host

        # Traefik labels for auto-routing
        labels = {
            "opsway.managed": "true",
            "opsway.project": config.project_slug,
            "opsway.branch": config.branch_name,
            "opsway.environment": config.environment,
            "opsway.type": "odoo",
            "traefik.enable": "true",
            f"traefik.http.routers.{name}.rule": f"Host(`{config.branch_name.replace('/', '-').replace('_', '-').lower()}.{config.project_slug.replace('_', '-').lower()}.localhost`)",
            f"traefik.http.services.{name}.loadbalancer.server.port": "8069",
        }
        
        # Add TLS router for custom domain
        if config.custom_domain:
            hosts = [config.custom_domain]
            if not config.custom_domain.startswith("www."):
                hosts.append(f"www.{config.custom_domain}")
            
            host_rule = " || ".join([f"Host(`{h}`)" for h in hosts])
            labels[f"traefik.http.routers.{name}-tls.rule"] = host_rule
            labels[f"traefik.http.routers.{name}-tls.entrypoints"] = "websecure"
            labels[f"traefik.http.routers.{name}-tls.tls.certresolver"] = "letsencrypt"
            labels[f"traefik.http.routers.{name}-tls.service"] = name
            labels["opsway.custom_domain"] = config.custom_domain

        # Volume mounts
        volumes = {}
        safe_branch = config.branch_name.replace("/", "-").replace("_", "-").lower()
        filestore_vol = f"opsway_filestore_{config.project_slug}_{safe_branch}"
        volumes[filestore_vol] = {"bind": "/var/lib/odoo", "mode": "rw"}

        # Extra volumes declared in .opsway.yml (processed first to detect overrides)
        extra_bind_dsts: set[str] = set()
        if config.extra_volumes:
            import os
            from pathlib import Path
            for vol_str in config.extra_volumes:
                parts = vol_str.split(":")
                if len(parts) >= 2:
                    host_src = parts[0]
                    bind_dst = parts[1]
                    mode = parts[2] if len(parts) >= 3 else "rw"
                    if host_src.startswith("./") or host_src.startswith("../"):
                        abs_src = str((Path(config.repo_path) / host_src).resolve())
                        if settings.host_build_workspace:
                            abs_src = abs_src.replace(settings.build_workspace, settings.host_build_workspace)
                        host_src = abs_src
                    # Skip bind mounts whose source path doesn't exist on the host
                    # (named volumes like "db_data" don't start with "/" — always pass through)
                    if host_src.startswith("/") and not os.path.exists(host_src):
                        logger.warning(f"Skipping volume mount: {host_src} not found (declare in repo first)")
                        continue
                    volumes[host_src] = {"bind": bind_dst, "mode": mode}
                    extra_bind_dsts.add(bind_dst)

        # Source Code Volume — skip if user already mounted something at /mnt/extra-addons
        if config.repo_path and "/mnt/extra-addons" not in extra_bind_dsts:
            if settings.host_build_workspace:
                host_path = config.repo_path.replace(settings.build_workspace, settings.host_build_workspace)
            else:
                host_path = config.repo_path
            volumes[host_path] = {
                "bind": "/mnt/extra-addons",
                "mode": "ro" if config.environment == "production" else "rw",
            }

        # Construction of the start command
        if is_temp_run:
            # Always use canonical odoo command for init/upgrade runs
            command = ["odoo", "-d", config.db_name]
            if config.init_db:
                command += ["-i", "base", "--stop-after-init"]
            elif config.upgrade_modules:
                command += ["-u", ",".join(config.upgrade_modules), "--stop-after-init"]
        elif config.command_override:
            # User-supplied command bypasses the Odoo entrypoint which normally injects
            # --db_host / --db_user / --db_password. Auto-inject all missing DB flags.
            import re as _re
            cmd = (config.command_override if isinstance(config.command_override, str)
                   else " ".join(config.command_override))
            if _re.search(r'\bodoo\b', cmd):
                inject = ""
                if " -d " not in cmd and "--database " not in cmd:
                    inject += f" -d {config.db_name}"
                if "--db_host" not in cmd:
                    inject += f" --db_host {db_host}"
                if "--db_user" not in cmd:
                    inject += f" --db_user {env.get('USER', 'odoo')}"
                if "--db_password" not in cmd:
                    inject += f" --db_password {env.get('PASSWORD', 'odoo')}"
                if inject:
                    cmd = _re.sub(r'(\bodoo\b)', rf'\1{inject}', cmd, count=1)
            command = ["sh", "-c", cmd]
        else:
            command = ["odoo", "-d", config.db_name]
            
        container = self.client.containers.run(
            image,
            name=name,
            command=command,
            environment=env,
            labels=labels,
            volumes=volumes,
            network=network,
            ports={"8069/tcp": host_port} if host_port and not is_temp_run else None,
            detach=True,
            remove=False,
            restart_policy={"Name": "unless-stopped"} if not is_temp_run else None,
        )

        if is_temp_run:
            # Wait for init/upgrade to finish
            result = container.wait()
            logs = container.logs().decode("utf-8", errors="replace")
            
            # Clean up the temporary container
            container.remove(v=True, force=True)
            
            if result.get("StatusCode", 0) != 0:
                raise Exception(f"Container failed. Logs: {logs[-2000:]}")
            return None, None, logs

        # Also attach to traefik network
        try:
            traefik_net = self.client.networks.get("traefik_public")
            traefik_net.connect(container)
        except Exception as e:
            logger.warning(f"Could not attach to traefik_public: {e}")

        logger.info(f"Started Odoo container: {name} → {url}")
        return container, host_port, url

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
        try:
            result = c.exec_run(command, demux=False)
            return result.exit_code, result.output.decode("utf-8", errors="replace")
        except APIError as e:
            return 1, str(e)

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
                "type": c.labels.get("opsway.type", "odoo"),
            }
            for c in containers
        ]

    def list_all_opsway_resources(self) -> dict:
        """Categorize all Opsway-related containers."""
        all_containers = self.client.containers.list(all=True)
        
        instances = []
        services = []
        
        for c in all_containers:
            # Instances have 'opsway.managed=true' label
            if c.labels.get("opsway.managed") == "true":
                instances.append(c)
            # Services have 'opsway_' prefix or compose label
            elif c.name.startswith("opsway_") or c.labels.get("com.docker.compose.project") == "opsway":
                services.append(c)
                
        return {
            "instances": instances,
            "services": services
        }

    def get_container_metrics(self, container: Container) -> dict:
        """Calculate CPU and Memory usage percentages."""
        try:
            stats = container.stats(stream=False)
            
            # MEMORY
            mem_usage = stats["memory_stats"].get("usage", 0)
            mem_limit = stats["memory_stats"].get("limit", 1)
            mem_percent = (mem_usage / mem_limit) * 100.0 if mem_limit > 0 else 0
            
            # CPU
            cpu_percent = 0.0
            cpu_delta = stats["cpu_stats"]["cpu_usage"]["total_usage"] - stats["precpu_stats"]["cpu_usage"]["total_usage"]
            system_delta = stats["cpu_stats"].get("system_cpu_usage", 0) - stats["precpu_stats"].get("system_cpu_usage", 0)
            
            if system_delta > 0 and cpu_delta > 0:
                # Use online_cpus if available, else count percpu_usage, else default to 1
                cpu_count = stats["cpu_stats"].get("online_cpus", 
                                len(stats["cpu_stats"]["cpu_usage"].get("percpu_usage", [1])))
                cpu_percent = (cpu_delta / system_delta) * cpu_count * 100.0
                
            return {
                "cpu": round(cpu_percent, 2),
                "memory": round(mem_percent, 2),
                "status": container.status
            }
        except Exception as e:
            logger.warning(f"Error getting stats for {container.name}: {e}")
            return {"cpu": 0, "memory": 0, "status": container.status}

    def get_all_metrics_bulk(self) -> dict:
        """Get metrics for all containers at once using docker stats CLI (takes ~2s total instead of 2s per container)."""
        import subprocess
        import json
        metrics_by_name = {}
        try:
            result = subprocess.run(
                ["docker", "stats", "--no-stream", "--format", "{{json .}}"],
                capture_output=True, text=True, check=True
            )
            for line in result.stdout.strip().split("\n"):
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    name = data.get("Name")
                    if name:
                        # CPUPerc looks like "0.02%", MemPerc looks like "1.23%"
                        cpu_str = data.get("CPUPerc", "0%").replace("%", "")
                        mem_str = data.get("MemPerc", "0%").replace("%", "")
                        
                        metrics_by_name[name] = {
                            "cpu": round(float(cpu_str), 2) if cpu_str else 0.0,
                            "memory": round(float(mem_str), 2) if mem_str else 0.0,
                            "status": "running"
                        }
                except json.JSONDecodeError:
                    continue
        except Exception as e:
            logger.warning(f"Error getting bulk stats: {e}")
        return metrics_by_name

