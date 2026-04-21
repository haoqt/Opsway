"""
Git utilities — clone, pull, detect Odoo version from __manifest__.py
"""
import os
import re
import ast
import logging
from pathlib import Path

import git
from git import Repo, GitCommandError

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


def get_build_dir(project_slug: str, branch_name: str) -> Path:
    """Return local path where a branch is checked out."""
    safe_branch = branch_name.replace("/", "_").replace("\\", "_")
    return Path(settings.build_workspace) / project_slug / safe_branch


def clone_or_pull(
    repo_url: str,
    project_slug: str,
    branch_name: str,
    deploy_key_path: str | None = None,
) -> tuple[Repo, Path]:
    """
    Clone repo if not exists, else pull latest.
    Returns (Repo, local_path).
    """
    local_path = get_build_dir(project_slug, branch_name)
    local_path.mkdir(parents=True, exist_ok=True)

    env = {}
    if deploy_key_path and os.path.exists(deploy_key_path):
        env["GIT_SSH_COMMAND"] = f"ssh -i {deploy_key_path} -o StrictHostKeyChecking=no"

    if (local_path / ".git").exists():
        logger.info(f"Pulling {branch_name} in {local_path}")
        repo = Repo(local_path)
        with repo.git.custom_environment(**env):
            origin = repo.remotes.origin
            origin.fetch()
            repo.git.checkout(branch_name)
            origin.pull(branch_name)
    else:
        logger.info(f"Cloning {repo_url}#{branch_name} → {local_path}")
        repo = Repo.clone_from(
            repo_url,
            local_path,
            branch=branch_name,
            env=env,
        )
        # Clone submodules
        repo.submodule_update(recursive=True)

    return repo, local_path


def get_latest_commit(repo: Repo) -> dict:
    commit = repo.head.commit
    return {
        "sha": commit.hexsha,
        "short_sha": commit.hexsha[:8],
        "message": commit.message.strip(),
        "author": f"{commit.author.name} <{commit.author.email}>",
    }


def detect_odoo_version(repo_path: Path) -> str | None:
    """
    Try to detect Odoo version from:
    1. .odoo-version file
    2. __manifest__.py 'version' field (e.g. "16.0.1.0.0")
    3. requirements.txt or setup.cfg
    """
    # Check .odoo-version file
    version_file = repo_path / ".odoo-version"
    if version_file.exists():
        ver = version_file.read_text().strip()
        major = ver.split(".")[0]
        if major in ("16", "17", "18"):
            return major

    # Search __manifest__.py files
    for manifest in repo_path.rglob("__manifest__.py"):
        try:
            content = manifest.read_text()
            tree = ast.literal_eval(content)
            if isinstance(tree, dict) and "version" in tree:
                ver_str = str(tree["version"])
                # Extract major version: "16.0.1.0.0" → "16"
                match = re.match(r"^(\d+)\.", ver_str)
                if match:
                    major = match.group(1)
                    if major in ("16", "17", "18"):
                        return major
        except Exception:
            continue

    # Check requirements.txt for odoo
    req_file = repo_path / "requirements.txt"
    if req_file.exists():
        content = req_file.read_text().lower()
        for ver in ("18", "17", "16"):
            if f"odoo=={ver}" in content or f"odoo~={ver}" in content:
                return ver

    return None


def check_manifest_version_bump(
    repo: Repo, prev_sha: str, current_sha: str
) -> list[str]:
    """
    Compare __manifest__.py version between two commits.
    Returns list of modules that have version bumps (need upgrade).
    """
    bumped = []
    try:
        prev_commit = repo.commit(prev_sha)
        curr_commit = repo.commit(current_sha)
        diff = prev_commit.diff(curr_commit, paths="**/__manifest__.py")
        for d in diff:
            if d.a_blob and d.b_blob:
                try:
                    old = ast.literal_eval(d.a_blob.data_stream.read().decode())
                    new = ast.literal_eval(d.b_blob.data_stream.read().decode())
                    if old.get("version") != new.get("version"):
                        module_dir = Path(d.b_path).parent.name
                        bumped.append(module_dir)
                except Exception:
                    pass
    except Exception as e:
        logger.warning(f"Version bump check failed: {e}")
    return bumped
