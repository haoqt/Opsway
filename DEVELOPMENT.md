# Opsway Development Guide

Welcome to the Opsway developer guide. Opsway runs as a modern, containerized stack. This guide covers how to set up the environment, run the services locally, and start building.

## 🏗️ Architecture Overview

Opsway is a monorepo defined loosely via Docker Compose:
- **`web/`**: Next.js 14 frontend (Next.js, Tailwind, shadcn/ui, React Query, next-themes).
- **`api/`**: FastAPI backend (SQLAlchemy, PostgreSQL, JWT Auth).
- **`api/app/worker/`**: Celery worker suite doing the heavy lifting (Docker orchestration, Git syncing).
- **`infra/`**: Configuration for Traefik routing and external tools.

---

## 🛠️ Prerequisites

- **Docker** and **Docker Compose** installed and running.
- **Node.js 20+** (if you want to run the web frontend locally outside Docker).
- **Python 3.11+** (if you want to run the API locally outside Docker).
- **Make** command line utility.

---

## 🚀 Quick Start (Dockerized)

The easiest way to run the entire Opsway stack is using the provided `Makefile`.

1. **Copy Environment Variables**:
   ```bash
   make setup
   # This copies .env.example to .env
   ```
2. **Start the Stack**:
   ```bash
   make up
   ```
   *This will build the Docker images and start Postgres, Redis, MinIO, Traefik, MailHog, API, Celery Workers, and the Web UI in the background.*

3. **Check Status**:
   ```bash
   make ps
   make logs
   ```

### Accessing Local Services

Once `make up` finishes, the following local endpoints will be available (routed via Traefik):

| Service | Local URL | Description |
|---|---|---|
| **Dashboard** | `http://opsway.localhost` | Main Opsway Web UI |
| **API Docs** | `http://api.localhost/docs` | Swagger UI for FastAPI |
| **Traefik Admin** | `http://localhost:8080` | Traefik load balancer dashboard |
| **MailHog** | `http://mail.localhost` | Development email catcher |
| **MinIO Console** | `http://minio.localhost:9001` | S3 Buckets / DB Backups UI |
| **Odoo Tunnels** | `http://*.localhost` | Auto-provisioned Odoo instances |

---

## 💻 Hybrid Local Development

Often you might want to run the frontend natively on your host OS for faster hot-reloading (since Node.js is widely installed), while keeping the database, proxy, and Python API entirely within Docker to avoid complex `Python 3.12` environment setup issues on your host machine.

### 1. Run Backend Stack (Databases + API + Workers)
Start the support queues and the FastAPI backend. Docker handles all the Python 3.12 isolated environments automatically.
```bash
# Start required infra & python backend
docker compose up -d postgres redis traefik api worker web minio beat
```
*(Note: Since the API code isn't volume-mounted by default, changes to `api/` will require restarting or rebuilding the API container: `docker compose up -d --build api`)*

> [!NOTE]
> **macOS Traefik Quirk:** On some Macs, Docker Desktop blocks Traefik from correctly reading `/var/run/docker.sock`. If you get a `404 Not Found` at `http://api.localhost/docs`, you can **bypass Traefik completely** by hitting the natively exposed port: **[http://localhost:8000/docs](http://localhost:8000/docs)**.

### 2. Run Web Frontend Locally
You can run the Next.js UI natively:
```bash
cd web
npm install
npm run dev
# The Next.js dashboard is now at -> http://localhost:3000
```

---

## 🍏 macOS & Infrastructure Stabilization

If you are developing on **macOS**, pay attention to these critical settings in your `.env`:

### 1. Docker API Compatibility
If you see `500 Internal Server Error` when performing project actions, ensure your API version matches your Docker Desktop:
```env
DOCKER_API_VERSION=1.54
```

### 2. File Sharing (Volumes)
Since the API/Worker runs inside Docker, it needs to tell the Host Docker Daemon where to find the source code for volume mounting.
Set **`HOST_BUILD_WORKSPACE`** to the absolute path of this project on your **Mac**:
```env
HOST_BUILD_WORKSPACE=/Users/yourname/path/to/opsway/opsway/build_workspace
```

### 3. Dynamic Port Allocation (NAT)
Opsway assigns host ports to Odoo containers in the range **10000–20000**.
- **Self-Healing**: If a port is occupied by another container or a host process, the worker will automatically find the next available one.
- **Direct Access**: If Traefik subdomains (`*.localhost`) are failing, instances are always accessible via `http://localhost:PORT`.

---

## 🎨 UI/UX & Theming

Opsway follows a premium design philosophy with a focus on deep aesthetics and real-time feedback.

### 1. Theming System
We use `next-themes` with a custom HSL-based palette defined in `globals.css`.
- **Obsidian Dark Mode**: Deep slate backgrounds (`--background: 224 71% 4%`) with high-depth card styling.
- **Soft Slate Light Mode**: Clean, high-contrast light theme with soft gray accents.
- **Color Accents**: Primary accent is Violet (`--primary: 262 83% 58%`), with environment-specific colors (Emerald for Prod, Amber for Staging, Sky for Dev).

### 2. Dashboard Layout
The project dashboard uses a **3-column lane system** to group branches by environment. Each lane is visually distinct:
- **Production**: Emerald borders and accents.
- **Staging**: Amber borders and accents.
- **Development**: Subtle borders and sky-blue accents.

### 3. Real-Time Feedback
- **React Query Polling**: Branch cards poll for metrics (CPU/RAM) and task status every 10-15 seconds.
- **Status Badges**: Clear visual indicators for `Running`, `Offline`, `Failed`, and `Neutralized` states.

---

## 📋 Pipeline Config — `.opsway.yml`

Mỗi repository được Opsway quản lý cần có file `.opsway.yml` ở root. File này định nghĩa toàn bộ pipeline build: từ code quality, deploy container, đến chạy tests.

### Cấu trúc cơ bản

```yaml
version: "1"

stages:
  - code_quality   # optional
  - deploy
  - tests          # optional

code_quality:
  stage: code_quality
  image: python:3.11
  script:
    - pip install pre-commit --quiet
    - pre-commit run --all-files --config .pre-commit-config.yml
  allow_failure: true

deploy_development:
  stage: deploy
  trigger: opsway       # Opsway quản lý container lifecycle
  environment: development
  when: auto            # tự động khi push

deploy_production:
  stage: deploy
  trigger: opsway
  environment: production
  when: manual          # cần bấm Deploy từ UI

tests:
  stage: tests
  exec_in: odoo         # chạy bên trong Odoo container đang chạy
  script:
    - odoo --test-enable --test-tags at_install --stop-after-init -d ${DB_NAME}
  allow_failure: true
  only:
    - development       # chỉ chạy cho branch development
```

### Job types

| Field | Mô tả |
|---|---|
| `trigger: opsway` | Deploy job — Opsway quản lý toàn bộ lifecycle (postgres, init DB, Odoo container, rollback) |
| `image: <img>` | Code quality job — chạy script trong fresh Docker container |
| `exec_in: odoo` | Test job — chạy script qua `docker exec` bên trong Odoo container đang chạy |
| `when: auto` | Tự động chạy khi push |
| `when: manual` | Chỉ chạy khi bấm Deploy từ Opsway UI |
| `allow_failure: true` | Job fail không block toàn bộ build |
| `only: [development]` | Chỉ chạy cho những environment nhất định |

---

### Deploy Job — `services:` block

Deploy jobs hỗ trợ khai báo services theo cú pháp tương tự docker-compose. Opsway quản lý toàn bộ vòng đời: DB init, healthcheck, port mapping, rollback tự động.

```yaml
deploy_development:
  stage: deploy
  trigger: opsway
  environment: development
  when: auto
  services:
    database:
      image: postgres:15-alpine      # default: postgres:15-alpine
      shm_size: 1g                   # shared memory cho PostgreSQL
      volumes:
        - db_data:/var/lib/postgresql/data/pg_data    # named volume
        - ./backup:/etc/backup                         # bind mount (phải tồn tại)
      environment:
        POSTGRES_USER: ${DB_USER:-odoo}        # ${VAR:-default} syntax
        POSTGRES_PASSWORD: ${DB_PASSWORD:-odoo}
        PGDATA: /var/lib/postgresql/data/pg_data

    web:
      image: odoo:16.0                         # override image mặc định của branch
      links:
        - database                             # network alias, optional
      command: /bin/bash -c "pip3 install -r /opt/requirements.txt --quiet 2>/dev/null; odoo"
      volumes:
        - ./requirements.txt:/opt/requirements.txt   # skip nếu file không tồn tại
        - ./odoo.conf:/etc/odoo/odoo.conf            # skip nếu file không tồn tại
        - ./addons:/mnt/extra-addons                 # override default repo mount
      environment:
        HOST: database             # Opsway luôn override bằng hostname thực
        USER: ${DB_USER:-odoo}     # propagated từ database service nếu không đặt
        PASSWORD: ${DB_PASSWORD:-odoo}
        LIST_DB: "False"
        SERVER_WIDE_MODULES: "base,web"

    # Service phụ (redis, memcached, ...) — cần có field `image:`
    redis:
      image: redis:7-alpine
      environment:
        REDIS_PASSWORD: ${REDIS_PASSWORD:-}

    networks:
      odoo_net:
        driver_opts:
          com.docker.network.driver.mtu: 1450  # fix MTU cho một số cloud providers
```

#### Quy tắc quan trọng

| Hành vi | Chi tiết |
|---|---|
| **HOST luôn bị override** | Opsway inject `HOST=<pg_container_name>` sau cùng — khai báo để tài liệu hoá |
| **Network aliases tự động** | Service name (`database`, `redis`, ...) tự động thành hostname trong network |
| **Bind mount thiếu file → skip** | Nếu `./odoo.conf` không tồn tại trong repo, volume bị bỏ qua, không lỗi |
| **`/mnt/extra-addons` override** | Khai báo `./addons:/mnt/extra-addons` sẽ replace default repo mount |
| **`depends_on` bị ignore** | Opsway đã start postgres trước và wait healthy — không cần khai báo |
| **Variable resolution** | `${VAR:-default}` resolve từ branch env vars + `PROJECT_NAME`, `BRANCH_NAME` |
| **Odoo version từ image** | `image: odoo:16.0` tự động set Odoo version = 16 |

#### Khai báo đơn giản (không dùng services block)

```yaml
deploy_development:
  stage: deploy
  trigger: opsway
  environment: development
  when: auto
  image: odoo:17.0          # override image
  env:
    LIST_DB: "False"
    SERVER_WIDE_MODULES: "base,web"
  volumes:
    - ./addons:/mnt/extra-addons
  depends:
    - name: redis
      image: redis:7-alpine
```

#### Biến môi trường trong script

Trong `exec_in: odoo` jobs, các biến sau được inject tự động:
- `${DB_NAME}` — tên database của branch
- `${DB_HOST}` — hostname của PostgreSQL container

---

## 🔒 Safety & Concurrency

### 1. Task-Based Locking
To prevent data corruption, the UI implements reactive locking. When a branch is performing an active task (Build, Clone, Promote):
- **Destructive Actions Disabled**: Buttons for Restore, Backup, and Upload are disabled in the UI.
- **Task Indicator**: A spinning loader and task name are displayed in the branch card and header.

### 2. Odoo Container Lifecycle
The backend ensures that the Odoo container is properly initialized before the HTTP server starts. We handle `UnboundLocalError` by explicitly tracking the `odoo_container` object throughout the build task.

---

## 💾 Database Migrations (Dev Mode)

Currently, Opsway uses SQLAlchemy's `create_tables()` on startup. This automatically creates **new** tables but **does not** alter existing tables if you add new fields/columns to your models (`models/__init__.py`). 

If you add a new field to an existing model and restart the `api`, you might encounter `500 Internal Server Error` and logs complaining about `UndefinedColumnError`.

To fix this without wiping your development database, use `psql` inside the `opsway_postgres` container to append the columns and provide default values.

### Example: Adding a new field to Projects
If you add `backup_schedule: Mapped[str] = mapped_column(String(50), default="daily")` to `Project`:

1. **Add the column via SQL:**
   ```bash
   docker exec opsway_postgres psql -U opsway -d opsway -c "ALTER TABLE projects ADD COLUMN IF NOT EXISTS backup_schedule VARCHAR;"
   ```
2. **Backfill existing rows with a default (Crucial for Pydantic Validation!):**
   ```bash
   docker exec opsway_postgres psql -U opsway -d opsway -c "UPDATE projects SET backup_schedule = 'daily' WHERE backup_schedule IS NULL;"
   ```
3. **Restart the API:**
   ```bash
   docker compose restart api
   ```

*(Note: In the future, this will be handled automatically via Alembic migrations.)*

---

## 🧹 Cleanup & Utilities

Opsway heavily relies on Docker. To properly stop or clean your environment:

### Stopping the Stack
To gracefully stop all running services without deleting database volumes, run:
```bash
docker compose down
```
*(Or use our Makefile shortcut: `make down`)*

### Useful Shortcuts
- **Wipe out database and volumes** (Destructive!): `make clean`
- **Clean stray Odoo containers**: `make clean-builds` (Removes all containers labeled `opsway.managed=true`)
- **Access API Shell**: `make shell-api`
- **Access DB Console**: `make shell-db`

---

---

---

## 📦 Backup & Restoration

Opsway includes a full lifecycle for branch backups (database + filestore).

### 1. Storage (MinIO)
Backups are stored as compressed `.tar.gz` archives in **MinIO**.
- **Internal Access**: API/Worker use `minio:9000`.
- **External Access**: Browser uses `localhost:9000` (handled by presigned URLs).
- **Bucket**: Default bucket is `opsway-backups`.

### 2. Restoration Flow
When a restore is triggered:
1. **Service Stop**: The Odoo container is stopped.
2. **Explicit Wipe**: 
   - Existing DB connections are killed.
   - Database is dropped and recreated (`psql -c "DROP DATABASE..."`).
   - Filestore directory is recursively deleted (`rm -rf /var/lib/odoo/filestore/...`).
3. **Extraction**:
   - `pg_restore` populates the fresh database.
   - Filestore archive is extracted into the container.
4. **Restart**: Service is restarted to apply changes.

### 3. External Backups
You can restore from an external `.tar.gz` file using the **"Upload & Restore"** button. 
- **Format**: The archive must contain `dump.sql` (custom format pg_dump) and a `filestore/` directory.

---

## 🧬 Branch Cloning & Database Neutralization

Opsway provides Odoo.sh-like parity for cloning branches and neutralizing non-production environments to prevent accidental data leaks or email spam.

### 1. Database Cloning (`clone-from`)
When a user requests to clone a branch:
1. The **Target Container** is recreated to match the source environment.
2. The **Database** is copied via `pg_dump` from the source container directly into `pg_restore` on the target container.
3. The **Filestore** is streamed via `tar` from the source container's volume to the target container's volume.

*Note: Both the Source and Target branches must have been built and have active containers for the cloning to succeed.*

### 2. Database Neutralization
If a database is cloned into a **Development** or **Staging** branch, Opsway automatically runs the `neutralize_database` Celery task. This executes direct SQL queries on the target database to:
1. **Disable Scheduled Actions:** `UPDATE ir_cron SET active = false;`
2. **Redirect Outgoing Mail:** Forces all mail servers to use the local `MailHog` container (`mail.localhost`).
3. **Disable Fetchmail:** Stops incoming mail fetching (`fetchmail_server`).
4. **Clear Integrations:** Disables OAuth providers and removes external webhook URLs.
5. **Set Catchall:** Configures `mail.catchall.domain` to prevent actual emails from escaping.

The branch will be marked with a `Neutralized` badge in the UI. Production databases are **never** neutralized.

---

## 🌐 Custom Domain Management

Opsway supports project-level custom domains with automatic SSL (Let's Encrypt) and wildcard subdomain routing.

### 1. How it works
- **Project Domain**: Set a domain in the Project Settings (e.g., `mycompany.com`).
- **Production Routing**: The Production branch (if verified) maps to `https://mycompany.com`.
- **Subdomain Routing**: All branches automatically get subdomains: `https://feature-branch.mycompany.com`.
- **SSL**: Traefik automatically provisions certificates for both the root domain and the wildcard subdomains.

### 2. DNS Setup
To use a custom domain, you must configure two DNS records:
1. **Root A/CNAME**: `@` pointing to your Opsway server IP/host.
2. **Wildcard CNAME**: `*` pointing to the root domain.

### 3. Verification
After setting the domain, click **"Verify Domain"** in the UI. Opsway will perform a CNAME check against your project's slug on the `traefik_domain`.

---

## 🌐 Connecting GitHub Webhooks (Local Development)

To receive real webhook pushes, GitHub must be able to reach your locally running API. Since `localhost` is not accessible from the internet, you need a bridge.

### 1. Set up ngrok
1. **Install ngrok**: `brew install ngrok/ngrok/ngrok` (on macOS) or download from [ngrok.com](https://ngrok.com).
2. **Expose your API**:
   ```bash
   ngrok http 8000
   ```
3. **Copy the Forwarding URL**: It will look like `https://a1b2-c3d4.ngrok-free.app`.
4. **Update `.env`**: Set `WEBHOOK_BASE_URL` to your ngrok URL:
   ```env
   WEBHOOK_BASE_URL=https://a1b2-c3d4.ngrok-free.app/api
   ```
5. **Restart the API**: `docker compose restart api`.

### 2. Configure GitHub
1. Go to your repository on GitHub -> **Settings** -> **Webhooks** -> **Add webhook**.
2. **Payload URL**: Copy the "Payload URL" from the Opsway Project Integration page (it will include your ngrok URL).
3. **Content type**: Set to `application/json`.
4. **Secret**: Copy the "Secret" from the Opsway Project Integration page.
5. **Events**: Select "Just the push event" or "Let me select individual events" (Push, Create, Delete).
6. **Active**: Ensure it is checked.
7. Click **Add webhook**.

### 3. Configure Deploy Keys (Private Repos)
If your repository is **Private**, GitHub requires an SSH key for access.
1. In the Opsway Project **Settings** tab, find the **Public Deploy Key (SSH)**.
2. Click the **Copy** button.
3. Go to your GitHub repository -> **Settings** -> **Deploy keys** -> **Add deploy key**.
4. **Title**: Enter `Opsway CI`.
5. **Key**: Paste the public key you copied.
6. **Allow write access**: Ensure this remains **unchecked**.
7. Click **Add key**.

### 4. Test Connection
In the Opsway Dashboard, go to your Project -> Click the **Test Connection** button. This will ask GitHub to send a "ping" to your local API via ngrok. If successful, you'll see a green "Success" message!
