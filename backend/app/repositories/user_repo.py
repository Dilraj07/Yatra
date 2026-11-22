from typing import Any
from app.core.db import get_pg_conn


def create_user(email: str, full_name: str, home_city: str, password_hash: str) -> dict[str, Any]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO app_user (email, full_name, home_city, password_hash) "
                "VALUES (%s, %s, %s, %s) RETURNING user_id, email, full_name, home_city, created_at",
                (email, full_name, home_city, password_hash),
            )
            user = cur.fetchone()
            conn.commit()
            return user


def get_user_by_email(email: str) -> dict[str, Any] | None:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT user_id, email, full_name, home_city, password_hash FROM app_user WHERE email = %s",
                (email,),
            )
            return cur.fetchone()


def list_users() -> list[dict[str, Any]]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT user_id, email, full_name, home_city, created_at FROM app_user ORDER BY user_id ASC")
            return cur.fetchall()
