"""
Monitoring router — basic infrastructure stats
"""
import os
import psutil
from fastapi import APIRouter, Depends
from app.routers.auth import get_current_user
from app.models import User
from app.worker.docker_manager import DockerManager

router = APIRouter(prefix="/monitoring", tags=["monitoring"])

@router.get("/stats")
def get_stats(current_user: User = Depends(get_current_user)):
    """Return actual infrastructure stats for Opsway resources."""
    docker = DockerManager()
    resources = docker.list_all_opsway_resources()
    
    total_cpu = 0.0
    total_mem = 0.0
    
    # Process Instances
    instances_data = []
    bulk_metrics = docker.get_all_metrics_bulk()

    for c in resources["instances"]:
        metrics = bulk_metrics.get(c.name, {"cpu": 0.0, "memory": 0.0, "status": c.status})
        total_cpu += metrics["cpu"]
        total_mem += metrics["memory"]
        instances_data.append({
            "name": c.name,
            "status": c.status,
            "cpu": metrics["cpu"],
            "memory": metrics["memory"],
            "project": c.labels.get("opsway.project"),
            "type": c.labels.get("opsway.type", "odoo")
        })

    # Process Services
    services_data = []
    for c in resources["services"]:
        metrics = bulk_metrics.get(c.name, {"cpu": 0.0, "memory": 0.0, "status": c.status})
        total_cpu += metrics["cpu"]
        total_mem += metrics["memory"]
        services_data.append({
            "name": c.name,
            "status": c.status,
            "cpu": metrics["cpu"],
            "memory": metrics["memory"]
        })

    active_count = len([i for i in instances_data if i["status"] == "running"])
    
    # System wide metrics for context
    sys_cpu = psutil.cpu_percent()
    sys_mem = psutil.virtual_memory().percent

    # Helper to check if a service is running
    def check_service(name):
        return "online" if any(s["name"] == name and s["status"] == "running" for s in services_data) else "offline"

    return {
        "cpu": round(total_cpu, 1),
        "memory": round(total_mem / max(1, (len(instances_data) + len(services_data))), 1),
        "system_cpu": sys_cpu,
        "system_memory": sys_mem,
        "active_containers": active_count,
        "instances_count": len(instances_data),
        "services_count": len(services_data),
        "disk_usage": psutil.disk_usage('/').percent,
        "uptime": "Active",
        "services_health": {
            "postgres": check_service("opsway_postgres"),
            "redis": check_service("opsway_redis"),
            "minio": check_service("opsway_minio"),
            "traefik": check_service("opsway_traefik"),
            "api": check_service("opsway_api"),
            "worker": check_service("opsway_worker"),
            "beat": check_service("opsway_beat"),
            "mailhog": check_service("opsway_mailhog"),
        },
        "instances": instances_data,
        "services": services_data
    }


@router.get("/projects/{project_id}/branches/{branch_id}/metrics")
async def get_branch_metrics(
    project_id: str,
    branch_id: str,
    current_user: User = Depends(get_current_user),
):
    """Return resource metrics for a specific branch container."""
    from app.core.database import AsyncSessionLocal
    from app.models import Branch, Project
    import uuid
    from sqlalchemy import select

    async with AsyncSessionLocal() as session:
        stmt = select(Branch).where(Branch.id == uuid.UUID(branch_id))
        result = await session.execute(stmt)
        branch = result.scalar_one_or_none()

    if not branch or not branch.container_id:
        return {"cpu": 0.0, "memory": 0.0, "status": "offline", "uptime": None}

    import asyncio
    docker = DockerManager()
    try:
        container = await asyncio.to_thread(docker.get_container, branch.container_id)
        if not container:
            return {"cpu": 0.0, "memory": 0.0, "status": "offline", "uptime": None}
        metrics = await asyncio.to_thread(docker.get_container_metrics, container)
        return {
            "cpu": round(metrics.get("cpu", 0.0), 1),
            "memory": round(metrics.get("memory", 0.0), 1),
            "status": metrics.get("status", "unknown"),
            "uptime": None,
        }
    except Exception as e:
        return {"cpu": 0.0, "memory": 0.0, "status": "error", "error": str(e)}
