from fastapi import APIRouter

from app.repositories import user_repo
from app.schemas.auth import ClerkSyncRequest, LoginRequest, RegisterRequest
from app.services import auth_service

router = APIRouter(prefix="/api/auth", tags=["Auth & Users"])


@router.post("/register", status_code=201)
def register(payload: RegisterRequest):
    return auth_service.register_user(payload)


@router.post("/login")
def login(payload: LoginRequest):
    return auth_service.login_user(payload)


@router.post("/clerk-sync")
def clerk_sync(payload: ClerkSyncRequest):
    return auth_service.sync_clerk_user(payload)


@router.get("/users")
def list_users():
    return user_repo.list_users()

