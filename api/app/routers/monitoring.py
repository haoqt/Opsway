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
async def get_stats(current_user: User = Depends(get_current_user)):
    """Return actual infrastructure stats for Opsway resources."""
    docker = DockerManager()
    resources = docker.list_all_opsway_resources()
    
    total_cpu = 0.0
    total_mem = 0.0
    
    # Process Instances
    instances_data = []
    for c in resources["instances"]:
        metrics = docker.get_container_metrics(c)
        total_cpu += metrics["cpu"]
        total_mem += metrics["memory"]
        instances_data.append({
            "name": c.name,
            "status": metrics["status"],
            "cpu": metrics["cpu"],
            "memory": metrics["memory"],
            "project": c.labels.get("opsway.project"),
            "type": c.labels.get("opsway.type", "odoo")
        })

    # Process Services
    services_data = []
    for c in resources["services"]:
        metrics = docker.get_container_metrics(c)
        total_cpu += metrics["cpu"]
        total_mem += metrics["memory"]
        services_data.append({
            "name": c.name,
            "status": metrics["status"],
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
