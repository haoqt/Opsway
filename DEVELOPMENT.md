# Development Guide

## Architecture

Opsway is a distributed system running across multiple Docker containers. The architecture is split into Application services and Infrastructure services.

### Application Services
- **Web Dashboard (`opsway_web`)**: Next.js App Router. Handles all user interactions and the Pipeline Editor.
- **API Server (`opsway_api`)**: FastAPI backend. Manages metadata, triggers builds, and handles webhooks.
- **Build Worker (`opsway_worker`)**: Dedicated Celery worker for heavy CI/CD build tasks (Clone, Docker builds). Queue: `builds`.
- **Default Worker (`opsway_worker_default`)**: Celery worker for I/O tasks like Backups, Database Cloning, and Restore. Queue: `default`.
- **Celery Beat (`opsway_beat`)**: Scheduler for periodic tasks (Daily backups, cleanup jobs).

### Infrastructure Services
- **Traefik (`opsway_traefik`)**: The edge router. Handles reverse proxying, auto-SSL (Let's Encrypt), and dynamic routing for Odoo branch containers.
- **PostgreSQL (`opsway_postgres`)**: The system database storing projects, users, and pipeline configurations.
- **Redis (`opsway_redis`)**: Message broker for Celery and Pub/Sub for real-time build logs.
- **MinIO (`opsway_minio`)**: S3-compatible object storage used for storing Odoo database backups.

## Key Workflows

### UI-Driven Pipeline
The pipeline configuration is stored as JSON in the database (`project_ci_configs`). The `build.py` task reads this config and orchestrates the lifecycle of the branch.

### Odoo Deployment & Routing
When a branch is deployed:
1. `opsway_worker` starts a dedicated PostgreSQL container for the branch.
2. It starts an Odoo container, mounting source code and filestores.
3. Both containers are attached to the `traefik_public` network.
4. Traefik detects the `traefik.http.routers` labels and automatically maps the domain (e.g., `branch.project.localhost`).

## Local Development (Docker-based)

Since all services run inside Docker, use the following commands for management:

### View Logs
```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f api
docker compose logs -f worker
docker compose logs -f traefik
```

### Restart Services
```bash
# Full restart
docker compose restart

# Available services:
# api, web, worker, worker_default, beat, traefik, postgres, redis, minio
docker compose restart api web worker worker_default beat traefik postgres redis minio
```

### Database Management
```bash
# Enter DB shell
docker compose exec postgres psql -U opsway

# Manual migration / Initial data
docker compose exec api python -m app.initial_data
```

### Infrastructure Dashboards
- **Dashboard**: `http://localhost:3000`
- **API Docs**: `http://localhost:8000/docs`
- **Traefik**: `http://localhost:8080`
- **MinIO Console**: `http://minio.localhost` (User: `opsway_minio`, Pass: `opsway_minio_secret`)
