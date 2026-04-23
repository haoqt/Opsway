import asyncio
import logging
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.models import Branch
from app.worker.tasks.neutralize import neutralize_database

logging.basicConfig(level=logging.INFO)

def run():
    print("Testing neutralization...")
    branch_id = "53617de9-01b3-43bc-8714-f7d6c7247fe1"
    try:
        neutralize_database(branch_id)
        print("Neutralization completed.")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    run()
