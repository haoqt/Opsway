# Opsway: Premium Odoo CI/CD & Demo Platform

Opsway is a state-of-the-art CI/CD platform designed specifically for Odoo developers and pre-sales teams. It provides a seamless, UI-driven experience for managing Odoo environments, automated builds, and quick demo provisioning.

## 🚀 Key Features

- **Visual Pipeline Editor**: Drag-and-drop CI/CD stages with inline Odoo configuration (Version, Workers, Postgres).
- **Odoo-Native Orchestration**: Built-in support for Odoo 15.0, 16.0, 17.0, and 18.0.
- **Wildcard DNS Routing**: Automatic SSL and routing via Traefik (e.g., `branch.project.opsway.com`).
- **Template-Based Demos**: 1-click provisioning of Odoo instances from database templates (P0 Priority).
- **Multi-Provider Git**: Native integration with GitHub and GitLab.

## 🛠 Tech Stack

- **Frontend**: Next.js 16+, TailwindCSS, Framer Motion, TanStack Query.
- **Backend**: FastAPI (Python 3.11), SQLAlchemy, PostgreSQL.
- **Worker**: Celery + Redis for asynchronous build orchestration.
- **Infrastructure**: Docker SDK for container management, Traefik for dynamic routing.

## 🏗 Getting Started

### Prerequisites
- Docker & Docker Compose (V2 recommended)

### Deployment
Opsway is fully containerized. You can start the entire stack with a single command:

```bash
# Clone the repository
git clone https://github.com/opsway/opsway.git
cd opsway

# Start the full stack (API, Web, Workers, Redis, DB, Traefik)
docker compose up -d
```

### Accessing the Platform
- **Dashboard**: `http://localhost:3000`
- **API Docs**: `http://localhost:8000/docs`
- **Traefik Dashboard**: `http://localhost:8080` (monitoring routing)


## 📖 Documentation
- [Development Guide](DEVELOPMENT.md)
- [Architecture Overview](.agents/memory/project_context.md)
- [Development Roadmap](.agents/memory/plans/roadmap_v2.md)
