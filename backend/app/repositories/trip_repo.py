import json
from datetime import date
from typing import Any

from app.core.db import get_pg_conn


def list_trips() -> list[dict[str, Any]]:
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


def add_member(trip_id: int, user_id: int, role: str, budget_ceiling: float, joining_city: str) -> dict[str, Any]:
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


def remove_member(trip_id: int, user_id: int) -> bool:
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
