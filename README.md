# Opsway CI/CD

**Opsway** — Nền tảng CI/CD tự host, git-native, được xây dựng riêng cho Odoo. Opsway tự động hoá toàn bộ vòng đời deployment: từ push code đến container Odoo đang chạy, với trải nghiệm tương tự Odoo.sh nhưng trên hạ tầng của bạn.

---

## 🚀 Tính năng

### Core Platform
- **Dual Project Mode**: Hỗ trợ **Odoo Projects** (quản lý qua UI, không cần CI file) và **Generic Projects** (pipeline tùy chỉnh qua `.opsway.yml`)
- **Git-Native Deployments**: Build và deploy tự động qua GitHub/GitLab webhooks
- **Dynamic Environments**: Spin up container Odoo riêng cho từng branch (Development / Staging / Production)
- **Real-Time Logs**: Build timeline và live log stream qua SSE ngay trong dashboard
- **Docker Orchestration**: Mỗi branch có PostgreSQL + Odoo container hoàn toàn riêng biệt

### Odoo Project Mode
- Chọn **Odoo Version** (16 / 17 / 18) và **PostgreSQL Version** khi tạo project
- Không cần viết `.opsway.yml` — pipeline được generate tự động từ cấu hình DB
- **Custom Addons Path**: Chỉ định thư mục addons trong repo (ví dụ `custom_addons/`)
- **Per-branch overrides**: Mỗi branch có thể override `odoo_image`, `postgres_version`, `custom_addons_path`
- **Odoo Workers**: Cấu hình số workers (0 = multi-threading mode)
- **Custom Docker Image**: Override image Odoo mặc định (registry riêng, image tùy chỉnh)

### Generic Project Mode
- Pipeline đầy đủ qua **`.opsway.yml`** ở root repository
- Hỗ trợ `services:` block kiểu docker-compose: `database`, `web`, extra services
- **CI Config Files editor**: Quản lý `.opsway.yml`, `odoo.conf.template`, `.flake8`, v.v. trực tiếp trên UI
- **Variable resolution**: `${VAR:-default}` từ branch env vars + built-ins

### Quản lý Môi trường
- **Branch Cloning**: Clone database + filestore từ Production → Staging/Dev (tương tự Odoo.sh)
- **Auto-Neutralization**: Tắt cron, redirect mail sang MailHog, clear OAuth tokens sau khi clone
- **Database Backups**: Tự động backup theo lịch, lưu trữ trên MinIO (S3-compatible)
- **Uptime Monitoring**: Giám sát trạng thái container của từng branch
- **Resource Metrics**: CPU/RAM realtime trên branch card

### Infrastructure
- **Wildcard Subdomains**: Routing tự động qua Traefik (`feature-x.my-project.localhost`)
- **Custom Domains**: Domain riêng với SSL tự động (Let's Encrypt)
- **MailHog**: Email catcher tích hợp cho dev/staging
- **MinIO**: Backup storage tích hợp (S3-compatible)
- **GitLab Support**: Kết nối GitLab self-hosted, tự động đăng ký webhook qua API token

---

## 📚 Bắt đầu

Xem hướng dẫn chi tiết cài đặt, cấu hình `.env`, và chạy Opsway local:

[👉 Developer Guide (DEVELOPMENT.md)](./DEVELOPMENT.md)

---

## 🏗️ Kiến trúc

```
┌─────────────────────────────────────────────────┐
│              Next.js Dashboard (web/)            │
│  React Query · Tailwind · shadcn/ui · DnD Kit   │
└────────────────────┬────────────────────────────┘
                     │ REST API / SSE
┌────────────────────▼────────────────────────────┐
│              FastAPI Backend (api/)              │
│  SQLAlchemy · PostgreSQL · JWT · Webhooks        │
└────────────────────┬────────────────────────────┘
                     │ Celery Tasks
┌────────────────────▼────────────────────────────┐
│           Celery Worker (api/app/worker/)        │
│  Docker SDK · GitPython · DB Init · Backups      │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│              Docker Infrastructure               │
│  Traefik · PostgreSQL · Redis · MailHog · MinIO  │
└─────────────────────────────────────────────────┘
```

---

## 🧪 License

Internal Tooling — Copyright 2026.