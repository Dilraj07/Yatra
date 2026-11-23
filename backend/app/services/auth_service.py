from typing import Any

from app.core.exceptions import UnauthorizedError
from app.core.security import create_access_token, hash_password, verify_password
from app.repositories import user_repo
from app.schemas.auth import ClerkSyncRequest, LoginRequest, RegisterRequest


def register_user(payload: RegisterRequest) -> dict[str, Any]:
    pw_hash = hash_password(payload.password)
    user = user_repo.create_user(
        email=payload.email.lower(),
        full_name=payload.full_name.strip(),
        home_city=payload.home_city.strip(),
        password_hash=pw_hash,
    )
    token = create_access_token(user["user_id"], user["email"], user["full_name"])
    return {"access_token": token, "token_type": "bearer", "user": user}


def login_user(payload: LoginRequest) -> dict[str, Any]:
    user = user_repo.get_user_by_email(payload.email.lower())
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise UnauthorizedError("Invalid email or password")
    token = create_access_token(user["user_id"], user["email"], user["full_name"])
    user.pop("password_hash", None)
    return {"access_token": token, "token_type": "bearer", "user": user}


def sync_clerk_user(payload: ClerkSyncRequest) -> dict[str, Any]:
    email = payload.email.lower().strip()
    user = user_repo.get_user_by_email(email)
    if not user:
        # Generate pseudo-hash for OAuth user
        pw_hash = hash_password(f"clerk_oauth_{payload.clerk_id or email}")
        user = user_repo.create_user(
            email=email,
            full_name=payload.full_name.strip() or "Traveler",
            home_city=payload.home_city.strip() or "Bengaluru",
            password_hash=pw_hash,
        )
    token = create_access_token(user["user_id"], user["email"], user["full_name"])
    user_data = dict(user)
    user_data.pop("password_hash", None)
    if payload.avatar_url:
        user_data["avatar_url"] = payload.avatar_url
    return {"access_token": token, "token_type": "bearer", "user": user_data}

