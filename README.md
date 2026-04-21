# Opsway CI/CD

Welcome to **Opsway** — A self-hosted, git-native CI/CD platform specifically designed for Odoo. Opsway provides an automated deployment pipeline, dynamic environment generation, and a centralized control plane for your Odoo projects, replicating the developer experience of platforms like Odoo.sh but entirely on your own infrastructure.

## 🚀 Features (Phase 1 MVP)

- **Git-Native Deployments**: Automatic builds and deployments triggered by GitHub webhooks.
- **Dynamic Environments**: Instantly spin up dedicated Odoo containers for Development and Staging branches.
- **Wildcard Subdomains**: Automatic routing via Traefik (e.g. `feature-x--my-project.localhost`).
- **Real-Time Logs**: View the build timeline and live deployment logs right inside the dashboard via SSE.
- **Docker Orchestration**: Complete isolation for each database and Odoo instance.
- **Integrated Tooling**: Bundled with PostgreSQL, Redis, MailHog (email interceptor), and MinIO (for backups).

## 📚 Getting Started

For a detailed guide on how to set up the environment, configure the `.env` variables, and run Opsway locally using Docker Compose, please read the:

[👉 Developer Guide (DEVELOPMENT.md)](./DEVELOPMENT.md)

## 🏗️ Architecture

Opsway is composed of three main layers:

1. **Next.js Dashboard** (`web/`): A dark-themed, responsive React interface to manage projects, branches, and builds.
2. **FastAPI Backend** (`api/`): The core API gateway handling GitHub OAuth, user metadata, Webhooks, and SSE Log streaming.
3. **Celery Worker** (`api/app/worker/`): Background workers that interact with the Docker SDK and Git bindings to securely clone repositories, resolve Odoo versions, generate docker networks, and spin up isolated Odoo instances.

## 🧪 License

Internal Tooling - Copyright 2026.