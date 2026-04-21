import sys
import os

# Add parent dir to path so we can import app
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from app.models import Project
from app.services.ssh import generate_ssh_key_pair
from app.core.config import get_settings

def backfill():
    settings = get_settings()
    engine = create_engine(settings.database_url.replace("+asyncpg", "+psycopg2"))
    Session = sessionmaker(bind=engine)
    session = Session()

    projects = session.execute(select(Project).where(Project.deploy_key_private == None)).scalars().all()
    
    if not projects:
        print("No projects missing deploy keys.")
        return

    print(f"Found {len(projects)} projects missing keys. Generating...")

    for p in projects:
        print(f"Generating key for {p.name} ({p.slug})...")
        pub, priv = generate_ssh_key_pair(f"opsway-{p.slug}")
        p.deploy_key_public = pub
        p.deploy_key_private = priv
    
    session.commit()
    print("✅ Successfully backfilled keys for all projects.")

if __name__ == "__main__":
    backfill()
