"""
Auth router — register, login, GitHub OAuth
"""
import httpx
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import verify_password, hash_password, create_access_token, decode_token
from app.core.config import get_settings
from app.models import User
from app.schemas import Token, UserLogin, UserRegister, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()

GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_USER_URL = "https://api.github.com/user"


# ── Current user dependency ────────────────────────────────────

async def get_current_user(
    token: str = Depends(__import__("app.core.security", fromlist=["oauth2_scheme"]).oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    payload = decode_token(token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User inactive or not found")
    return user


# ── Endpoints ──────────────────────────────────────────────────

@router.post("/register", response_model=UserOut, status_code=201)
async def register(data: UserRegister, db: AsyncSession = Depends(get_db)):
    """Register a new user with email/password."""
    # Check uniqueness
    existing = await db.execute(select(User).where(User.email == data.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=data.email,
        username=data.username,
        hashed_password=hash_password(data.password),
        full_name=data.full_name,
    )
    db.add(user)
    await db.flush()
    return user


@router.post("/token", response_model=Token)
async def login(data: UserLogin, db: AsyncSession = Depends(get_db)):
    """Login with email/password, returns JWT."""
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()
    if not user or not user.hashed_password or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Account inactive")

    token = create_access_token({"sub": str(user.id)})
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)):
    return current_user


# ── GitHub OAuth ───────────────────────────────────────────────

@router.get("/github")
async def github_login():
    """Redirect to GitHub OAuth."""
    params = {
        "client_id": settings.github_client_id,
        "scope": "repo,admin:repo_hook,read:user,user:email",
    }
    query = "&".join(f"{k}={v}" for k, v in params.items())
    return RedirectResponse(f"{GITHUB_AUTHORIZE_URL}?{query}")


@router.get("/github/callback")
async def github_callback(code: str, db: AsyncSession = Depends(get_db)):
    """Handle GitHub OAuth callback, create/update user."""
    async with httpx.AsyncClient() as client:
        # Exchange code for token
        resp = await client.post(
            GITHUB_TOKEN_URL,
            data={
                "client_id": settings.github_client_id,
                "client_secret": settings.github_client_secret,
                "code": code,
            },
            headers={"Accept": "application/json"},
        )
        token_data = resp.json()
        gh_token = token_data.get("access_token")
        if not gh_token:
            raise HTTPException(status_code=400, detail="Failed to get GitHub token")

        # Get user info
        resp = await client.get(
            GITHUB_USER_URL,
            headers={"Authorization": f"Bearer {gh_token}"},
        )
        gh_user = resp.json()

        # Get primary email
        resp = await client.get(
            "https://api.github.com/user/emails",
            headers={"Authorization": f"Bearer {gh_token}"},
        )
        emails = resp.json()
        primary_email = next(
            (e["email"] for e in emails if e.get("primary")),
            gh_user.get("email", f"{gh_user['login']}@github.com"),
        )

    # Find or create user
    result = await db.execute(select(User).where(User.github_id == str(gh_user["id"])))
    user = result.scalar_one_or_none()

    if not user:
        result = await db.execute(select(User).where(User.email == primary_email))
        user = result.scalar_one_or_none()

    if user:
        user.github_id = str(gh_user["id"])
        user.github_login = gh_user["login"]
        user.github_token = gh_token
        user.avatar_url = gh_user.get("avatar_url")
    else:
        user = User(
            email=primary_email,
            username=gh_user["login"],
            full_name=gh_user.get("name"),
            avatar_url=gh_user.get("avatar_url"),
            github_id=str(gh_user["id"]),
            github_login=gh_user["login"],
            github_token=gh_token,
        )
        db.add(user)

    await db.flush()
    jwt_token = create_access_token({"sub": str(user.id)})

    # Redirect to frontend with token
    return RedirectResponse(f"{settings.frontend_url}/auth/callback?token={jwt_token}")
