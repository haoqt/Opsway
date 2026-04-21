# ==============================================================
# OPSWAY — Makefile shortcuts
# ==============================================================

.PHONY: help up down logs api web db migrate seed

SHELL := /bin/bash
export PATH := /opt/homebrew/bin:$(PATH)

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ── Infrastructure ─────────────────────────────────────────────

up: ## Start all services (detached)
	cp -n .env.example .env 2>/dev/null || true
	docker compose up -d --build
	@echo ""
	@echo "  🚀 Opsway is starting up!"
	@echo "  Dashboard:  http://opsway.localhost"
	@echo "  API docs:   http://api.localhost/docs"
	@echo "  Traefik:    http://localhost:8080"
	@echo "  MailHog:    http://mail.localhost"
	@echo "  MinIO:      http://minio.localhost"
	@echo ""

down: ## Stop all services
	docker compose down

restart: ## Restart all services
	docker compose restart

logs: ## Follow all logs
	docker compose logs -f

logs-api: ## Follow API logs
	docker compose logs -f api

logs-worker: ## Follow worker logs
	docker compose logs -f worker

ps: ## Show running services
	docker compose ps

# ── Development ────────────────────────────────────────────────

web-dev: ## Start frontend in dev mode (local)
	cd web && npm run dev

api-dev: ## Start API locally (requires local venv)
	cd api && uvicorn app.main:app --reload --port 8000

migrate: ## Run Alembic migrations
	docker compose exec api alembic upgrade head

makemigrations: ## Create new migration (pass MSG="description")
	docker compose exec api alembic revision --autogenerate -m "$(MSG)"

shell-api: ## Shell into API container
	docker compose exec api bash

shell-worker: ## Shell into worker container
	docker compose exec worker bash

shell-db: ## psql into metadata database
	docker compose exec postgres psql -U opsway -d opsway

# ── Build tools ────────────────────────────────────────────────

build-api: ## Build API Docker image
	docker compose build api worker beat

build-web: ## Build web Docker image
	docker compose build web

build-all: ## Build all images
	docker compose build

# ── Cleanup ────────────────────────────────────────────────────

clean: ## Remove all containers and volumes (DESTRUCTIVE)
	docker compose down -v --remove-orphans

clean-builds: ## Remove all Opsway-managed Odoo containers
	docker ps -a --filter "label=opsway.managed=true" -q | xargs -r docker rm -f

prune: ## Docker system prune (free disk)
	docker system prune -f

# ── Setup ──────────────────────────────────────────────────────

setup: ## First-time setup
	@echo "Setting up Opsway..."
	cp -n .env.example .env
	@echo "✅ .env created — edit it with your settings"
	@echo "   Then run: make up"
