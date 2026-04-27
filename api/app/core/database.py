from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.core.config import get_settings

settings = get_settings()

engine = create_async_engine(
    settings.database_url,
    echo=settings.app_env == "development",
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    """FastAPI dependency — yields an async DB session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


import logging
from sqlalchemy import select

async def create_tables():
    """Create all tables (dev only — use Alembic in prod)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        
    await init_accounts()

async def init_accounts():
    """Seed initial accounts configured in .env"""
    if not settings.initial_accounts:
        return
        
    # Lazy import to avoid circular dependencies
    from app.models import User
    from app.core.security import hash_password
    
    logger = logging.getLogger(__name__)
    
    raw_accounts = str(settings.initial_accounts).strip().replace("\\n", "\n")
    import re
    accounts = [x.strip() for x in re.split(r'[,\n]+', raw_accounts) if x.strip()]
    
    async with AsyncSessionLocal() as session:
        for acc in accounts:
            try:
                parts = acc.split(":")
                if len(parts) >= 2:
                    email = parts[0].strip()
                    password = parts[1].strip()[:70]  # bcrypt limit is 72 max
                    username = parts[2].strip() if len(parts) > 2 else email.split("@")[0]
                    
                    if not email or not password:
                        continue
                        
                    # Check if exists
                    stmt = select(User).where(User.email == email)
                    result = await session.execute(stmt)
                    if not result.scalar_one_or_none():
                        user = User(
                            email=email,
                            username=username,
                            hashed_password=hash_password(password),
                            is_superuser=True,
                            full_name=username.capitalize()
                        )
                        session.add(user)
                        logger.info(f"✨ Created initial admin account: {email}")
            except Exception as exc:
                logger.error(f"Failed to parse or create account from '{acc[:30]}': {exc}")
                
        await session.commit()

