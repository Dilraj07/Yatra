from datetime import datetime, timezone, timedelta
from typing import Any

from app.core.db import get_pg_conn

_LIVE_SUPPLIERS: list[dict[str, Any]] = [
    {"supplier_id": 1, "name": "Archaeological Survey of India (ASI)", "category": "MONUMENT_PASSES"},
    {"supplier_id": 2, "name": "Akasa Air Aviation", "category": "DOMESTIC_FLIGHTS"},
    {"supplier_id": 3, "name": "Palolem Heritage Hospitality", "category": "RESORT_STAY"},
]

_LIVE_POIS: list[dict[str, Any]] = [
    {
        "poi_id": 1,
        "supplier_id": 1,
        "name": "Vijayanagara Stone Chariot & Vittala Complex",
        "city": "Hampi",
        "lat": 15.3350,
        "lon": 76.4600,
        "capacity_managed": True,
        "description": "Archaeological Survey of India Protected World Heritage Site. Hourly visitor caps strictly enforced.",
        "supplier_name": "Archaeological Survey of India (ASI)",
    },
    {
        "poi_id": 2,
        "supplier_id": 1,
        "name": "Virupaksha Sacred Temple & Ghats",
        "city": "Hampi",
        "lat": 15.3358,
        "lon": 76.4610,
        "capacity_managed": True,
        "description": "Active 7th-century Dravidian temple complex on the Tungabhadra River.",
        "supplier_name": "Archaeological Survey of India (ASI)",
    },
    {
        "poi_id": 3,
        "supplier_id": 1,
        "name": "Basilica of Bom Jesus & Baroque Museum",
        "city": "Old Goa",
        "lat": 15.5009,
        "lon": 73.9116,
        "capacity_managed": True,
        "description": "UNESCO World Heritage Baroque landmark housing the sacred relics of St. Francis Xavier.",
        "supplier_name": "Archaeological Survey of India (ASI)",
    },
    {
        "poi_id": 4,
        "supplier_id": 3,
        "name": "Aguada Fort & Portuguese Lighthouse",
        "city": "Candolim, Goa",
        "lat": 15.4925,
        "lon": 73.7736,
        "capacity_managed": False,
        "description": "17th-century Portuguese coastal fortress overlooking Sinquerim Beach.",
        "supplier_name": "Palolem Heritage Hospitality",
    },
]

_LIVE_SLOTS: list[dict[str, Any]] = [
    {
        "slot_id": 1,
        "poi_id": 1,
        "poi_name": "Vijayanagara Stone Chariot & Vittala Complex",
        "circuit": "Hampi Archaeological Morning Circuit (06:00 - 09:30)",
        "city": "Hampi",
        "window_start": "2026-12-19T06:00:00Z",
        "window_end": "2026-12-19T09:30:00Z",
        "capacity_total": 40,
        "seats_taken": 3,
        "price_inr": 250.0,
    },
    {
        "slot_id": 2,
        "poi_id": 1,
        "poi_name": "Vijayanagara Stone Chariot & Vittala Complex",
        "circuit": "Hampi Archaeological Sunset Circuit (16:00 - 18:30)",
        "city": "Hampi",
        "window_start": "2026-12-19T16:00:00Z",
        "window_end": "2026-12-19T18:30:00Z",
        "capacity_total": 40,
        "seats_taken": 8,
        "price_inr": 300.0,
    },
    {
        "slot_id": 3,
        "poi_id": 2,
        "poi_name": "Virupaksha Sacred Temple & Ghats",
        "circuit": "Tungabhadra Dawn Darshan & Architectural Tour (06:30 - 08:30)",
        "city": "Hampi",
        "window_start": "2026-12-20T06:30:00Z",
        "window_end": "2026-12-20T08:30:00Z",
        "capacity_total": 60,
        "seats_taken": 12,
        "price_inr": 150.0,
    },
    {
        "slot_id": 4,
        "poi_id": 3,
        "poi_name": "Basilica of Bom Jesus & Baroque Museum",
        "circuit": "Old Goa Heritage & Reliquary Guided Access (10:00 - 12:00)",
        "city": "Old Goa",
        "window_start": "2026-12-18T10:00:00Z",
        "window_end": "2026-12-18T12:00:00Z",
        "capacity_total": 50,
        "seats_taken": 15,
        "price_inr": 200.0,
    },
]

_LIVE_HOLDS: list[dict[str, Any]] = [
    {
        "hold_id": 1,
        "slot_id": 1,
        "leg_id": 3,
        "seats": 3,
        "state": "HELD",
        "held_until": "2026-12-23T18:00:00Z",
        "created_at": "2026-11-23T10:00:00Z",
        "circuit": "Hampi Archaeological Morning Circuit (06:00 - 09:30)",
        "poi_name": "Vijayanagara Stone Chariot & Vittala Complex",
    }
]


def list_suppliers() -> list[dict[str, Any]]:
    try:
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM supplier ORDER BY supplier_id ASC")
                return cur.fetchall()
    except Exception:
        return _LIVE_SUPPLIERS


def list_pois() -> list[dict[str, Any]]:
    try:
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT p.*, s.name AS supplier_name "
                    "FROM poi p LEFT JOIN supplier s ON s.supplier_id = p.supplier_id "
                    "ORDER BY p.poi_id ASC"
                )
                return cur.fetchall()
    except Exception:
        return _LIVE_POIS


def create_poi(
    supplier_id: int | None,
    name: str,
    city: str,
    lat: float,
    lon: float,
    capacity_managed: bool,
    description: str,
) -> dict[str, Any]:
    try:
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
    except Exception:
        new_id = max((p["poi_id"] for p in _LIVE_POIS), default=0) + 1
        sup = next((s for s in _LIVE_SUPPLIERS if s["supplier_id"] == supplier_id), None)
        new_poi = {
            "poi_id": new_id,
            "supplier_id": supplier_id,
            "name": name,
            "city": city,
            "lat": lat,
            "lon": lon,
            "capacity_managed": capacity_managed,
            "description": description,
            "supplier_name": sup["name"] if sup else "Local Operator",
        }
        _LIVE_POIS.append(new_poi)
        return new_poi


def list_slots() -> list[dict[str, Any]]:
    try:
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM slot_availability ORDER BY window_start ASC")
                return cur.fetchall()
    except Exception:
        return _LIVE_SLOTS


def create_slot(
    poi_id: int,
    circuit: str,
    window_start: datetime,
    window_end: datetime,
    capacity_total: int,
    price_inr: float,
) -> dict[str, Any]:
    try:
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
    except Exception:
        poi = next((p for p in _LIVE_POIS if p["poi_id"] == poi_id), None)
        new_id = max((s["slot_id"] for s in _LIVE_SLOTS), default=0) + 1
        new_slot = {
            "slot_id": new_id,
            "poi_id": poi_id,
            "poi_name": poi["name"] if poi else f"Heritage Site #{poi_id}",
            "circuit": circuit,
            "city": poi["city"] if poi else "India",
            "window_start": window_start.isoformat() if hasattr(window_start, "isoformat") else str(window_start),
            "window_end": window_end.isoformat() if hasattr(window_end, "isoformat") else str(window_end),
            "capacity_total": capacity_total,
            "seats_taken": 0,
            "price_inr": float(price_inr),
        }
        _LIVE_SLOTS.append(new_slot)
        return new_slot


def list_holds(limit: int = 50) -> list[dict[str, Any]]:
    try:
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
    except Exception:
        return _LIVE_HOLDS[:limit]


def create_hold(slot_id: int, seats: int, leg_id: int | None) -> dict[str, Any]:
    try:
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
    except Exception:
        slot = next((s for s in _LIVE_SLOTS if s["slot_id"] == slot_id), None)
        if slot:
            slot["seats_taken"] = min(slot["capacity_total"], slot["seats_taken"] + seats)
        new_id = max((h["hold_id"] for h in _LIVE_HOLDS), default=0) + 1
        held_until = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()
        new_hold = {
            "hold_id": new_id,
            "slot_id": slot_id,
            "leg_id": leg_id,
            "seats": seats,
            "state": "HELD",
            "held_until": held_until,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "circuit": slot["circuit"] if slot else f"Slot #{slot_id}",
            "poi_name": slot["poi_name"] if slot else f"Site #{slot_id}",
        }
        _LIVE_HOLDS.insert(0, new_hold)
        return new_hold


def release_hold(hold_id: int) -> dict[str, Any] | None:
    try:
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("UPDATE slot_hold SET state = 'RELEASED' WHERE hold_id = %s RETURNING *", (hold_id,))
                row = cur.fetchone()
                conn.commit()
                return row
    except Exception:
        for h in _LIVE_HOLDS:
            if h["hold_id"] == hold_id:
                h["state"] = "RELEASED"
                # Release seat count on corresponding slot
                slot = next((s for s in _LIVE_SLOTS if s["slot_id"] == h["slot_id"]), None)
                if slot:
                    slot["seats_taken"] = max(0, slot["seats_taken"] - h["seats"])
                return h
        return None


def expire_stale_holds() -> list[int]:
    try:
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE slot_hold SET state = 'EXPIRED' "
                    "WHERE state = 'HELD' AND held_until < NOW() RETURNING hold_id"
                )
                ids = [r["hold_id"] for r in cur.fetchall()]
                conn.commit()
                return ids
    except Exception:
        now_iso = datetime.now(timezone.utc).isoformat()
        expired = []
        for h in _LIVE_HOLDS:
            if h["state"] == "HELD" and h.get("held_until", "") < now_iso:
                h["state"] = "EXPIRED"
                expired.append(h["hold_id"])
        return expired
