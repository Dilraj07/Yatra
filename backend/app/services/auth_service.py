from typing import Any

from app.core.exceptions import UnauthorizedError
from app.core.security import create_access_token, hash_password, verify_password
from app.repositories import user_repo
from app.schemas.auth import LoginRequest, RegisterRequest


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
