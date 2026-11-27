from typing import Any
from app.core.db import get_pg_conn


def create_user(email: str, full_name: str, home_city: str, password_hash: str) -> dict[str, Any]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO app_user (email, full_name, home_city, password_hash) "
                "VALUES (%s, %s, %s, %s) RETURNING user_id, email, full_name, home_city, avatar_url, last_seen_at, created_at",
                (email, full_name, home_city, password_hash),
            )
            user = cur.fetchone()
            conn.commit()
            return user


def get_user_by_email(email: str) -> dict[str, Any] | None:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT user_id, email, full_name, home_city, avatar_url, last_seen_at, password_hash FROM app_user WHERE email = %s",
                (email,),
            )
            return cur.fetchone()


_FALLBACK_USERS = [
    {"user_id": 1, "email": "dilraj@yatra.local", "full_name": "Dilraj Singh", "home_city": "Bengaluru", "created_at": "2026-11-20T10:00:00Z"},
    {"user_id": 2, "email": "arya@yatra.local", "full_name": "Arya Wadhwa", "home_city": "Delhi", "created_at": "2026-11-20T10:00:00Z"},
    {"user_id": 3, "email": "aarush@yatra.local", "full_name": "Aarush Luthra", "home_city": "Mumbai", "created_at": "2026-11-20T10:00:00Z"},
    {"user_id": 4, "email": "priya@yatra.local", "full_name": "Priya Sharma", "home_city": "Pune", "created_at": "2026-11-20T10:00:00Z"},
    {"user_id": 5, "email": "rohan@yatra.local", "full_name": "Rohan Gupta", "home_city": "Jaipur", "created_at": "2026-11-20T10:00:00Z"},
    {"user_id": 6, "email": "ananya@yatra.local", "full_name": "Ananya Iyer", "home_city": "Chennai", "created_at": "2026-11-20T10:00:00Z"},
    {"user_id": 7, "email": "vikram@yatra.local", "full_name": "Vikram Malhotra", "home_city": "Hyderabad", "created_at": "2026-11-20T10:00:00Z"},
]


def list_users() -> list[dict[str, Any]]:
    try:
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT user_id, email, full_name, home_city, avatar_url, last_seen_at, created_at "
                    "FROM app_user ORDER BY user_id ASC"
                )
                return cur.fetchall()
    except Exception:
        return list(_FALLBACK_USERS)
