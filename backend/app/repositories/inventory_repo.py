from datetime import datetime
from typing import Any

from app.core.db import get_pg_conn


def list_suppliers() -> list[dict[str, Any]]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM supplier ORDER BY supplier_id ASC")
            return cur.fetchall()


def list_pois() -> list[dict[str, Any]]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT p.*, s.name AS supplier_name "
                "FROM poi p LEFT JOIN supplier s ON s.supplier_id = p.supplier_id "
                "ORDER BY p.poi_id ASC"
            )
            return cur.fetchall()


def create_poi(
    supplier_id: int | None,
    name: str,
    city: str,
    lat: float,
    lon: float,
    capacity_managed: bool,
    description: str,
) -> dict[str, Any]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO poi (supplier_id, name, city, lat, lon, capacity_managed, description) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING *",
                (supplier_id, name, city, lat, lon, capacity_managed, description),
            )
            row = cur.fetchone()
            conn.commit()
            return row


def list_slots() -> list[dict[str, Any]]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM slot_availability ORDER BY window_start ASC")
            return cur.fetchall()


def create_slot(
    poi_id: int,
    circuit: str,
    window_start: datetime,
    window_end: datetime,
    capacity_total: int,
    price_inr: float,
) -> dict[str, Any]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO capacity_slot (poi_id, circuit, entry_window, capacity_total, seats_taken, price_inr) "
                "VALUES (%s, %s, tstzrange(%s, %s), %s, 0, %s) "
                "RETURNING slot_id, poi_id, circuit, lower(entry_window) AS window_start, "
                "upper(entry_window) AS window_end, capacity_total, seats_taken, price_inr",
                (poi_id, circuit, window_start, window_end, capacity_total, price_inr),
            )
            row = cur.fetchone()
            conn.commit()
            return row


def list_holds(limit: int = 50) -> list[dict[str, Any]]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT sh.*, cs.circuit, p.name AS poi_name "
                "FROM slot_hold sh "
                "JOIN capacity_slot cs ON cs.slot_id = sh.slot_id "
                "JOIN poi p ON p.poi_id = cs.poi_id "
                "ORDER BY sh.hold_id DESC LIMIT %s",
                (limit,),
            )
            return cur.fetchall()


def create_hold(slot_id: int, seats: int, leg_id: int | None) -> dict[str, Any]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO slot_hold (slot_id, leg_id, seats, state) "
                "VALUES (%s, %s, %s, 'HELD') RETURNING *",
                (slot_id, leg_id, seats),
            )
            row = cur.fetchone()
            conn.commit()
            return row


def release_hold(hold_id: int) -> dict[str, Any] | None:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE slot_hold SET state = 'RELEASED' WHERE hold_id = %s RETURNING *", (hold_id,))
            row = cur.fetchone()
            conn.commit()
            return row


def expire_stale_holds() -> list[int]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE slot_hold SET state = 'EXPIRED' "
                "WHERE state = 'HELD' AND held_until < NOW() RETURNING hold_id"
            )
            ids = [r["hold_id"] for r in cur.fetchall()]
            conn.commit()
            return ids
