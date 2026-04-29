"""
FastAPI Application Entry Point — Opsway API
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.database import create_tables
from app.routers import auth, projects, branches, builds, webhooks, monitoring, stats, terminal, backups, domains, members, uptime, ci_config

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown events."""
    logger.info("🚀 Opsway API starting up...")
    # Auto-create tables in dev (use Alembic in prod)
    if settings.app_env == "development":
        await create_tables()
        logger.info("✅ Database tables ensured")
    yield
    logger.info("🛑 Opsway API shutting down...")


app = FastAPI(
    title="Opsway API",
    description="CI/CD Platform for Odoo — self-hosted, git-native",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# ── CORS ────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://opsway.localhost",
        settings.frontend_url,
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ─────────────────────────────────────────────────────
API_PREFIX = "/api"

app.include_router(auth.router, prefix=API_PREFIX)
app.include_router(projects.router, prefix=API_PREFIX)
app.include_router(branches.router, prefix=API_PREFIX)
app.include_router(builds.router, prefix=API_PREFIX)
app.include_router(monitoring.router, prefix=API_PREFIX)
app.include_router(stats.router, prefix=API_PREFIX)
app.include_router(terminal.router, prefix=API_PREFIX)
app.include_router(backups.router, prefix=API_PREFIX)
app.include_router(domains.router, prefix=API_PREFIX)
app.include_router(members.router, prefix=API_PREFIX)
app.include_router(uptime.router, prefix=API_PREFIX)
app.include_router(ci_config.router, prefix=API_PREFIX)
app.include_router(webhooks.router)  # No /api prefix — raw webhook URL


# ── Health check ────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "service": "opsway-api", "version": "0.1.0"}


@app.get("/")
async def root():
    return {
        "name": "Opsway API",
        "version": "0.1.0",
        "docs": "/docs",
    }
