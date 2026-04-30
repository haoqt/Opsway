"""
CI config file generator — renders 7 GitLab CI files from a project's stored config dict.
Passwords and secrets are never stored; odoo.conf.template uses envsubst variables.
"""
import copy

DEFAULT_CI_CONFIG: dict = {
    "pipeline": {
        "runner_tags": ["opsway-runner"],
        "python_image": "python:3.11",
        "stages": ["code_quality", "deploy-dev", "deploy-staging", "deploy-prod"],
        "branch_map": {"dev": "development", "staging": "staging", "prod": "production"},
        "deploy_prod_manual": True,
    },
    "sync": {
        "enabled": False,
        "repo": "github.com/org/repo.git",
        "target_branch": "staging",
        "source_path": "addons/custom/*",
        "git_user_email": "",
        "git_user_name": "",
    },
    "docker": {
        "postgres_image": "postgres:15-alpine",
        "odoo_image": "",
        "network_mtu": 1450,
    },
    "odoo": {
        "addons_paths": ["/mnt/extra-addons/custom/", "/mnt/extra-addons/enterprise"],
        "workers": 4,
        "max_cron_threads": 2,
        "limit_memory_hard": 2684354560,
        "limit_memory_soft": 2147483648,
        "limit_time_cpu": 60000,
        "limit_time_real": 120000,
        "limit_time_real_cron": -1,
        "log_level": "info",
        "log_handler": ":INFO",
        "proxy_mode": True,
        "test_enable": False,
        "test_tags": "",
    },
    "linting": {
        "flake8_max_line_length": 120,
        "flake8_max_complexity": 20,
        "flake8_ignore": ["E203", "E501", "W503", "E128", "C901"],
        "pylint_valid_odoo_versions": ["17.0"],
        "pre_commit_flake8_version": "5.0.4",
        "pre_commit_pylint_odoo_version": "7.0.2",
        "excluded_addons": [],
    },
}


def get_effective_config(stored: dict) -> dict:
    """Deep-merge stored config over DEFAULT_CI_CONFIG (section level)."""
    result = copy.deepcopy(DEFAULT_CI_CONFIG)
    for section, defaults in DEFAULT_CI_CONFIG.items():
        if section in stored and isinstance(stored[section], dict):
            result[section] = {**defaults, **stored[section]}
    return result


# ── Helpers ────────────────────────────────────────────────────

def _odoo_image(docker_cfg: dict, project_odoo_version: str | None) -> str:
    if docker_cfg.get("odoo_image"):
        return docker_cfg["odoo_image"]
    v = (project_odoo_version or "17").strip()
    if "." not in v:
        v = f"{v}.0"
    return f"odoo:{v}-latest"


def _odoo_ver(docker_cfg: dict, project_odoo_version: str | None) -> str:
    """Return bare version string like '17.0' from image or project field."""
    img = _odoo_image(docker_cfg, project_odoo_version)
    ver = img.replace("odoo:", "").split("-")[0]
    return ver if ver else "17.0"


def _tag_lines(tags: list[str], indent: int = 4) -> str:
    pad = " " * indent
    return "\n".join(f"{pad}- {t}" for t in tags)


# ── File generators ────────────────────────────────────────────

def generate_opsway_yml(config: dict, project_odoo_version: str | None) -> str:
    """Generate .opsway.yml — the Opsway pipeline definition file.

    Format is job-based (similar to .gitlab-ci.yml).  Each top-level key
    (except 'version' and 'stages') is a job.  Jobs are executed in stage order.

    Job execution modes (set via 'trigger' or 'image' / 'exec_in'):
      trigger: opsway  — Opsway manages the container via Docker SDK (deploy jobs)
      image: <img>     — script runs inside a fresh Docker container (code quality)
      exec_in: odoo    — script runs via docker exec inside the running Odoo container (tests)
    """
    p = config["pipeline"]
    d = config["docker"]

    python_image = p.get("python_image", "python:3.11")
    odoo_img = _odoo_image(d, project_odoo_version)

    return f"""\
version: "1"

# Stages executed by Opsway on each build, in order.
# Remove a stage name to skip all jobs in that stage.
stages:
  - code_quality
  - deploy
  - tests

# ── Code Quality ───────────────────────────────────────────────────────────────
# Runs pre-commit hooks inside an isolated Python container before deploy.
# 'allow_failure: true' means lint issues are logged but do not block the build.
code_quality:
  stage: code_quality
  image: {python_image}
  script:
    - apt-get update -qq && apt-get install -y git --no-install-recommends -qq
    - pip install pre-commit --quiet
    - pre-commit run --all-files --config .pre-commit-config.yml
  allow_failure: true

# ── Deploy ─────────────────────────────────────────────────────────────────────
# 'trigger: opsway' — Opsway manages the full container lifecycle (postgres +
# odoo, DB init/upgrade, healthcheck, rollback) via Docker SDK.
# 'compose_file' tells Opsway which docker-compose.yml to read for image & network config.
deploy_development:
  stage: deploy
  trigger: opsway
  environment: development
  compose_file: docker-compose.yml
  when: auto

deploy_staging:
  stage: deploy
  trigger: opsway
  environment: staging
  compose_file: docker-compose.yml
  when: auto

deploy_production:
  stage: deploy
  trigger: opsway
  environment: production
  compose_file: docker-compose.yml
  when: manual                   # requires a manual trigger from the Opsway UI

# ── Tests ──────────────────────────────────────────────────────────────────────
# 'exec_in: odoo' — script runs via docker exec inside the running Odoo container.
# Only executes for development environment branches.
tests:
  stage: tests
  exec_in: odoo
  script:
    - odoo --test-enable --test-tags at_install --stop-after-init -d ${{DB_NAME}} --db_host ${{DB_HOST}}
  allow_failure: true
  only:
    - development
"""


# Keep old name as alias for any stored content referencing it
generate_gitlab_ci = generate_opsway_yml


def generate_docker_compose(config: dict, project_odoo_version: str | None) -> str:
    d = config["docker"]
    o = config["odoo"]
    postgres_img = d.get("postgres_image", "postgres:15-alpine")
    odoo_img = _odoo_image(d, project_odoo_version)
    mtu = d.get("network_mtu", 1450)
    workers = o.get("workers", 4)

    return f"""\
# docker-compose.yml — local development / self-managed deployment
# Images must match .opsway.yml docker section.
# Secrets come from a .env file: DB_USER, DB_PASSWORD, ODOO_ADMIN_PASSWD
# Run: envsubst < odoo.conf.template > odoo.conf  before starting.

services:
  database:
    image: {postgres_img}
    container_name: ${{PROJECT_NAME:-opsway}}_db
    shm_size: 1g
    volumes:
      - db_data:/var/lib/postgresql/data/pg_data
      - ./backup:/etc/backup
    restart: unless-stopped
    environment:
      POSTGRES_DB: postgres
      POSTGRES_USER: ${{DB_USER:-odoo}}
      POSTGRES_PASSWORD: ${{DB_PASSWORD:-odoo}}
      PGDATA: /var/lib/postgresql/data/pg_data
    networks:
      - odoo_net
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${{DB_USER:-odoo}}"]
      interval: 10s
      timeout: 5s
      retries: 5

  web:
    image: {odoo_img}
    container_name: ${{PROJECT_NAME:-opsway}}_web
    depends_on:
      database:
        condition: service_healthy
    volumes:
      - ./requirements.txt:/opt/requirements.txt
      - ./odoo.conf:/etc/odoo/odoo.conf
      - ./addons:/mnt/extra-addons
      - odoo_data:/var/lib/odoo
    command: /bin/bash -c "pip3 install -r /opt/requirements.txt --quiet && odoo"
    environment:
      HOST: database
      USER: ${{DB_USER:-odoo}}
      PASSWORD: ${{DB_PASSWORD:-odoo}}
    restart: unless-stopped
    ports:
      - "8069:8069"
      - "8072:8072"
    networks:
      - odoo_net

volumes:
  db_data:
  odoo_data:

networks:
  odoo_net:
    driver: bridge
    driver_opts:
      com.docker.network.driver.mtu: {mtu}
"""


def generate_odoo_conf_template(config: dict) -> str:
    o = config["odoo"]
    addons_path = ",".join(o.get("addons_paths", ["/mnt/extra-addons/custom/"]))
    workers = o.get("workers", 4)
    max_cron = o.get("max_cron_threads", 2)
    mem_hard = o.get("limit_memory_hard", 2684354560)
    mem_soft = o.get("limit_memory_soft", 2147483648)
    t_cpu = o.get("limit_time_cpu", 60000)
    t_real = o.get("limit_time_real", 120000)
    t_cron = o.get("limit_time_real_cron", -1)
    log_level = o.get("log_level", "info")
    log_handler = o.get("log_handler", ":INFO")
    proxy_mode = "True" if o.get("proxy_mode", True) else "False"
    test_enable = "True" if o.get("test_enable", False) else "False"
    test_tags = o.get("test_tags", "")

    return f"""\
[options]
addons_path = {addons_path}
admin_passwd = ${{ODOO_ADMIN_PASSWD}}
csv_internal_sep = ,
data_dir = /var/lib/odoo
db_host = database
db_maxconn = 128
db_name = False
db_password = ${{DB_PASSWORD}}
db_port = 5432
db_sslmode = prefer
db_template = template1
db_user = ${{DB_USER}}
pidfile = None
demo = {{}}
email_from = False
http_enable = True
http_interface =
http_port = 8069
import_partial =
limit_memory_hard = {mem_hard}
limit_memory_soft = {mem_soft}
limit_request = 8192
limit_time_cpu = {t_cpu}
limit_time_real = {t_real}
limit_time_real_cron = {t_cron}
list_db = True
log_db = False
log_db_level = warning
log_handler = {log_handler}
log_level = {log_level}
logfile = /var/log/odoo/odoo.log
logrotate = True
longpolling_port = 8072
max_cron_threads = {max_cron}
transient_age_limit = 1.0
proxy_mode = {proxy_mode}
reportgz = False
server_wide_modules = web
smtp_password = False
smtp_port = 25
smtp_server = localhost
smtp_ssl = False
smtp_user = False
test_commit = False
test_enable = {test_enable}
test_file = False
test_tags = {test_tags if test_tags else "False"}
test_report_directory = False
workers = {workers}
"""


def generate_flake8(config: dict) -> str:
    lint = config["linting"]
    max_line = lint.get("flake8_max_line_length", 120)
    max_complex = lint.get("flake8_max_complexity", 20)
    ignore_list = lint.get("flake8_ignore", ["E203", "E501", "W503", "E128", "C901"])
    if isinstance(ignore_list, list):
        ignore_str = ",".join(ignore_list)
    else:
        ignore_str = str(ignore_list)

    return f"""\
[flake8]
max-line-length = {max_line}
max-complexity = {max_complex}
# B = bugbear
# B9 = bugbear opinionated (incl line length)
select = C,E,F,W,B,B9
ignore = {ignore_str}
per-file-ignores=
    __init__.py:F401
"""


def generate_pre_commit_config(config: dict) -> str:
    lint = config["linting"]
    flake8_ver = lint.get("pre_commit_flake8_version", "5.0.4")
    pylint_ver = lint.get("pre_commit_pylint_odoo_version", "7.0.2")
    excluded = lint.get("excluded_addons", [])

    extra_excludes = ""
    if excluded:
        extra_excludes = "\n" + "\n".join(f"  addons/custom/{a}/|" for a in excluded)

    return f"""\
exclude: |
  (?x)
  # NOT INSTALLABLE ADDONS
  # END NOT INSTALLABLE ADDONS
  # Auto-generated or tool-managed files
  ^setup/|/static/description/index\\.html$|
  \\.svg$|/tests/([^/]+/)?cassettes/|^\\.copier-answers\\.yml$|^\\.github/|
  ^README\\.md$|
  /static/(src/)?lib/|
  ^docs/_templates/.*\\.html$|
  readme/.*\\.(rst|md)$|
  /build/|/dist/|
  /tests/samples/.*|
  (LICENSE.*|COPYING.*)|
  addons/enterprise/|{extra_excludes}
  backup/|
  requirements.txt|odoo.conf.template|docker-compose.yml|docker-compose-gitlab-ci.yml|
  \\.pylintrc-mandatory|\\.pylintrc|\\.prettierrc\\.yml|\\.pre-commit-config\\.yaml|
  \\.isort\\.cfg|\\.gitlab-ci\\.yml|\\.gitignore|\\.flake8|\\.eslintrc\\.yml|\\.eslintrc|
  \\.env|\\.editorconfig

default_language_version:
  python: python3

repos:
  - repo: local
    hooks:
      - id: forbidden-files
        name: forbidden files
        entry: found forbidden files; remove them
        language: fail
        files: "\\.rej$"
      - id: en-po-files
        name: en.po files cannot exist
        entry: found a en.po file
        language: fail
        files: '[a-zA-Z0-9_]*/i18n/en\\.po$'

  - repo: https://github.com/PyCQA/flake8
    rev: {flake8_ver}
    hooks:
      - id: flake8
        name: flake8
        exclude: 'tests|env|docs'
        additional_dependencies: ["flake8-bugbear==20.1.4"]

  - repo: https://github.com/OCA/pylint-odoo
    rev: {pylint_ver}
    hooks:
      - id: pylint_odoo
        name: pylint with optional checks
        args:
          - --rcfile=.pylintrc
          - --exit-zero
        verbose: true
      - id: pylint_odoo
        args:
          - --rcfile=.pylintrc-mandatory
"""


def _pylintrc_body(valid_versions: list[str]) -> str:
    ver_str = ",".join(valid_versions) if isinstance(valid_versions, list) else str(valid_versions)
    return f"""\

[MASTER]
load-plugins=pylint_odoo
score=n

[ODOOLINT]
readme_template_url="https://github.com/OCA/maintainer-tools/blob/master/template/module/README.rst"
manifest_required_keys=license
manifest_deprecated_keys=active
license_allowed=AGPL-3,GPL-2,GPL-2 or any later version,GPL-3,GPL-3 or any later version,LGPL-3
valid_odoo_versions={ver_str}

[MESSAGES CONTROL]
disable=all

enable=anomalous-backslash-in-string,
    assignment-from-none,
    dangerous-default-value,
    development-status-allowed,
    duplicate-key,
    duplicate-po-message-definition,
    missing-import-error,
    po-msgstr-variables,
    po-syntax-error,
    pointless-statement,
    pointless-string-statement,
    print-used,
    redundant-keyword-arg,
    reimported,
    relative-import,
    return-in-init,
    too-few-format-args,
    unreachable,
    eval-used,
    eval-referenced,
    manifest-author-string,
    manifest-required-key,
    api-one-deprecated,
    api-one-multi-together,
    attribute-deprecated,
    class-camelcase,
    create-user-wo-reset-password,
    consider-merging-classes-inherited,
    dangerous-filter-wo-user,
    dangerous-view-replace-wo-priority,
    deprecated-module,
    duplicate-id-csv,
    duplicate-xml-fields,
    duplicate-xml-record-id,
    incoherent-interpreter-exec-perm,
    javascript-lint,
    manifest-deprecated-key,
    method-compute,
    method-inverse,
    method-required-super,
    method-search,
    no-utf8-coding-comment,
    odoo-addons-relative-import,
    old-api7-method-defined,
    openerp-exception-warning,
    redefined-builtin,
    redundant-modulename-xml,
    too-complex,
    use-vim-comment,
    wrong-tabs-instead-of-spaces,
    xml-syntax-error,

[REPORTS]
msg-template={{path}}:{{line}}: [{{msg_id}}({{symbol}}), {{obj}}] {{msg}}
output-format=colorized
reports=no
"""


def generate_pylintrc(config: dict) -> str:
    lint = config["linting"]
    versions = lint.get("pylint_valid_odoo_versions", ["17.0"])
    return _pylintrc_body(versions)


def generate_pylintrc_mandatory(config: dict) -> str:
    lint = config["linting"]
    versions = lint.get("pylint_valid_odoo_versions", ["17.0"])
    return _pylintrc_body(versions)


CI_FILENAMES = [
    ".opsway.yml",
    "docker-compose.yml",
    "odoo.conf.template",
    ".flake8",
    ".pre-commit-config.yml",
    ".pylintrc",
    ".pylintrc-mandatory",
]

FILENAME_GENERATORS = {
    ".opsway.yml": generate_opsway_yml,
    "docker-compose.yml": generate_docker_compose,
    "odoo.conf.template": generate_odoo_conf_template,
    ".flake8": generate_flake8,
    ".pre-commit-config.yml": generate_pre_commit_config,
    ".pylintrc": generate_pylintrc,
    ".pylintrc-mandatory": generate_pylintrc_mandatory,
}
