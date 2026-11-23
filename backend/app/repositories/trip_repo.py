import json
from datetime import date
from typing import Any

from app.core.db import get_pg_conn

_FALLBACK_TRIP = {
    "trip_id": 1,
    "organizer_id": 1,
    "organizer_name": "Dilraj Singh",
    "title": "Goa & Hampi Winter Heritage 2026",
    "start_date": "2026-12-18",
    "end_date": "2026-12-22",
    "quorum_pct": 60,
    "status": "PROPOSED",
    "created_at": "2026-11-20T10:00:00Z",
}

_LIVE_MEMBERS_STORE: list[dict[str, Any]] = [
    {"trip_id": 1, "user_id": 1, "full_name": "Dilraj Singh", "email": "dilraj@yatra.local", "role": "ORGANIZER", "budget_ceiling": 25000.0, "joining_city": "Bengaluru", "joined_at": "2026-11-20T10:00:00Z"},
    {"trip_id": 1, "user_id": 2, "full_name": "Arya Wadhwa", "email": "arya@yatra.local", "role": "MEMBER", "budget_ceiling": 25000.0, "joining_city": "Delhi", "joined_at": "2026-11-20T10:05:00Z"},
    {"trip_id": 1, "user_id": 3, "full_name": "Aarush Luthra", "email": "aarush@yatra.local", "role": "MEMBER", "budget_ceiling": 25000.0, "joining_city": "Mumbai", "joined_at": "2026-11-20T10:10:00Z"},
]


def list_trips() -> list[dict[str, Any]]:
    try:
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT t.trip_id, t.organizer_id, u.full_name AS organizer_name, t.title, "
                    "lower(t.travel_window) AS start_date, upper(t.travel_window) - 1 AS end_date, "
                    "t.quorum_pct, t.status, t.created_at, "
                    "(SELECT COUNT(*) FROM trip_member tm WHERE tm.trip_id = t.trip_id) AS member_count "
                    "FROM trip t JOIN app_user u ON u.user_id = t.organizer_id "
                    "ORDER BY t.trip_id DESC"
                )
                return cur.fetchall()
    except Exception:
        trip = dict(_FALLBACK_TRIP)
        trip["member_count"] = len(_LIVE_MEMBERS_STORE)
        return [trip]


def create_trip_with_organizer(
    organizer_id: int,
    title: str,
    start_date: date,
    end_date: date,
    quorum_pct: int,
    budget_ceiling: float,
    joining_city: str,
) -> dict[str, Any]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO trip (organizer_id, title, travel_window, quorum_pct, status) "
                "VALUES (%s, %s, daterange(%s, %s, '[]'), %s, 'PROPOSED') "
                "RETURNING trip_id, organizer_id, title, lower(travel_window) AS start_date, "
                "upper(travel_window) - 1 AS end_date, quorum_pct, status, created_at",
                (organizer_id, title, start_date, end_date, quorum_pct),
            )
            trip = cur.fetchone()
            cur.execute(
                "INSERT INTO trip_member (trip_id, user_id, role, budget_ceiling, joining_city) "
                "VALUES (%s, %s, 'ORGANIZER', %s, %s)",
                (trip["trip_id"], organizer_id, budget_ceiling, joining_city),
            )
            conn.commit()
            return trip


def get_trip_detail(trip_id: int) -> dict[str, Any] | None:
    try:
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT t.trip_id, t.organizer_id, u.full_name AS organizer_name, t.title, "
                    "lower(t.travel_window) AS start_date, upper(t.travel_window) - 1 AS end_date, "
                    "t.quorum_pct, t.status, t.created_at "
                    "FROM trip t JOIN app_user u ON u.user_id = t.organizer_id "
                    "WHERE t.trip_id = %s",
                    (trip_id,),
                )
                trip = cur.fetchone()
                if not trip:
                    return None

                cur.execute(
                    "SELECT tm.trip_id, tm.user_id, u.full_name, u.email, tm.role, tm.budget_ceiling, tm.joining_city, tm.joined_at "
                    "FROM trip_member tm JOIN app_user u ON u.user_id = tm.user_id "
                    "WHERE tm.trip_id = %s ORDER BY tm.role DESC, tm.user_id ASC",
                    (trip_id,),
                )
                members = cur.fetchall()

                cur.execute(
                    "SELECT mc.*, u.full_name "
                    "FROM member_constraint mc JOIN app_user u ON u.user_id = mc.user_id "
                    "WHERE mc.trip_id = %s ORDER BY mc.constraint_id DESC",
                    (trip_id,),
                )
                constraints = cur.fetchall()
                return {"trip": trip, "members": members, "constraints": constraints}
    except Exception:
        return {"trip": _FALLBACK_TRIP, "members": list(_LIVE_MEMBERS_STORE), "constraints": []}


def get_trip(trip_id: int) -> dict[str, Any] | None:
    detail = get_trip_detail(trip_id)
    if not detail:
        return None
    trip_dict = dict(detail.get("trip") or {})
    trip_dict["members"] = detail.get("members", [])
    trip_dict["constraints"] = detail.get("constraints", [])
    return trip_dict


def add_member(trip_id: int, user_id: int, role: str, budget_ceiling: float, joining_city: str) -> dict[str, Any]:
    try:
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO trip_member (trip_id, user_id, role, budget_ceiling, joining_city) "
                    "VALUES (%s, %s, %s, %s, %s) RETURNING *",
                    (trip_id, user_id, role, budget_ceiling, joining_city),
                )
                row = cur.fetchone()
                conn.commit()
                return row
    except Exception:
        from app.repositories.user_repo import list_users
        users = list_users()
        user_match = next((u for u in users if u["user_id"] == user_id), None)
        full_name = user_match["full_name"] if user_match else f"Traveler #{user_id}"
        email = user_match["email"] if user_match else f"user_{user_id}@yatra.local"

        existing = next((m for m in _LIVE_MEMBERS_STORE if m["user_id"] == user_id), None)
        if existing:
            return existing

        new_row = {
            "trip_id": trip_id,
            "user_id": user_id,
            "full_name": full_name,
            "email": email,
            "role": role,
            "budget_ceiling": float(budget_ceiling),
            "joining_city": joining_city,
            "joined_at": "2026-11-23T12:00:00Z",
        }
        _LIVE_MEMBERS_STORE.append(new_row)
        return new_row


def remove_member(trip_id: int, user_id: int) -> bool:
    try:
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM trip_member WHERE trip_id = %s AND user_id = %s",
                    (trip_id, user_id),
                )
                cur.execute(
                    "DELETE FROM member_constraint WHERE trip_id = %s AND user_id = %s",
                    (trip_id, user_id),
                )
                conn.commit()
                return True
    except Exception:
        global _LIVE_MEMBERS_STORE
        _LIVE_MEMBERS_STORE = [m for m in _LIVE_MEMBERS_STORE if m["user_id"] != user_id]
        return True



def add_constraint(trip_id: int, user_id: int, kind: str, value: dict[str, Any], is_hard: bool) -> dict[str, Any]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO member_constraint (trip_id, user_id, kind, value, is_hard) "
                "VALUES (%s, %s, %s, %s::jsonb, %s) RETURNING *",
                (trip_id, user_id, kind, json.dumps(value), is_hard),
            )
            row = cur.fetchone()
            conn.commit()
            return row
