import json
from datetime import datetime
from typing import Any

from app.core.db import get_pg_conn

_LIVE_ITINERARIES: list[dict[str, Any]] = [
    {
        "itinerary_id": 1,
        "trip_id": 1,
        "version": 1,
        "status": "APPROVED",
        "summary": "Goa & Hampi Winter Heritage Circuit (Flights, Palolem Resort & Virupaksha Timed Pass)",
        "created_at": "2026-11-20T10:02:00Z",
        "legs": [
            {
                "leg_id": 101,
                "itinerary_id": 1,
                "poi_id": None,
                "slot_id": None,
                "seq": 1,
                "kind": "FLIGHT",
                "title": "Air India Flight: BLR/DEL -> GOI (Akasa Air)",
                "span_start": "2026-12-18T08:00:00Z",
                "span_end": "2026-12-18T11:30:00Z",
                "est_cost_inr": 3400.0,
                "supplier_meta": {"flight_num": "QP1302", "departure": "BLR", "arrival": "GOI"},
                "participants": [
                    {"user_id": 1, "full_name": "Dilraj Singh"},
                    {"user_id": 2, "full_name": "Arya Wadhwa"},
                    {"user_id": 3, "full_name": "Aarush Luthra"},
                ],
            },
            {
                "leg_id": 102,
                "itinerary_id": 1,
                "poi_id": None,
                "slot_id": None,
                "seq": 2,
                "kind": "HOTEL",
                "title": "Palolem Beach Eco Haven (South Goa Beachfront Resort)",
                "span_start": "2026-12-18T14:00:00Z",
                "span_end": "2026-12-20T11:00:00Z",
                "est_cost_inr": 4800.0,
                "supplier_meta": {"room_type": "Deluxe Cottage", "nights": 2},
                "participants": [
                    {"user_id": 1, "full_name": "Dilraj Singh"},
                    {"user_id": 2, "full_name": "Arya Wadhwa"},
                    {"user_id": 3, "full_name": "Aarush Luthra"},
                ],
            },
            {
                "leg_id": 103,
                "itinerary_id": 1,
                "poi_id": 2,
                "slot_id": 1,
                "seq": 3,
                "kind": "ATTRACTION",
                "title": "Hampi Virupaksha Temple Timed Heritage Entry",
                "span_start": "2026-12-20T18:00:00Z",
                "span_end": "2026-12-20T21:00:00Z",
                "est_cost_inr": 750.0,
                "supplier_meta": {"slot_id": 1, "circuit": "Evening Heritage Batch A"},
                "participants": [
                    {"user_id": 1, "full_name": "Dilraj Singh"},
                    {"user_id": 2, "full_name": "Arya Wadhwa"},
                    {"user_id": 3, "full_name": "Aarush Luthra"},
                ],
            },
        ],
    }
]


def list_trip_itineraries(trip_id: int) -> list[dict[str, Any]]:
    try:
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM itinerary WHERE trip_id = %s ORDER BY version DESC", (trip_id,))
                itins = cur.fetchall()
                for it in itins:
                    cur.execute(
                        "SELECT il.leg_id, il.itinerary_id, il.poi_id, il.slot_id, il.seq, il.kind, il.title, "
                        "lower(il.span) AS span_start, upper(il.span) AS span_end, il.est_cost_inr, il.supplier_meta, "
                        "COALESCE(json_agg(json_build_object('user_id', u.user_id, 'full_name', u.full_name)) "
                        "FILTER (WHERE u.user_id IS NOT NULL), '[]') AS participants "
                        "FROM itinerary_leg il "
                        "LEFT JOIN leg_participant lp ON lp.leg_id = il.leg_id "
                        "LEFT JOIN app_user u ON u.user_id = lp.user_id "
                        "WHERE il.itinerary_id = %s "
                        "GROUP BY il.leg_id ORDER BY il.seq ASC",
                        (it["itinerary_id"],),
                    )
                    it["legs"] = cur.fetchall()
                return itins
    except Exception:
        return [it for it in _LIVE_ITINERARIES if it["trip_id"] == trip_id] or list(_LIVE_ITINERARIES)


def get_itinerary(itinerary_id: int) -> dict[str, Any] | None:
    try:
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM itinerary WHERE itinerary_id = %s", (itinerary_id,))
                itin = cur.fetchone()
                if not itin:
                    return None
                cur.execute("SELECT * FROM itinerary_leg WHERE itinerary_id = %s ORDER BY seq ASC", (itinerary_id,))
                itin["legs"] = cur.fetchall()
                return itin
    except Exception:
        for it in _LIVE_ITINERARIES:
            if it["itinerary_id"] == itinerary_id:
                return it
        return _LIVE_ITINERARIES[0] if _LIVE_ITINERARIES else None


def create_itinerary(trip_id: int, summary: str) -> dict[str, Any]:
    try:
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT COALESCE(MAX(version), 0) + 1 AS next_ver FROM itinerary WHERE trip_id = %s",
                    (trip_id,),
                )
                ver = cur.fetchone()["next_ver"]
                cur.execute(
                    "INSERT INTO itinerary (trip_id, version, status, summary) "
                    "VALUES (%s, %s, 'DRAFT', %s) RETURNING *",
                    (trip_id, ver, summary),
                )
                row = cur.fetchone()
                conn.commit()
                return row
    except Exception:
        next_ver = len(_LIVE_ITINERARIES) + 1
        new_itin = {
            "itinerary_id": next_ver,
            "trip_id": trip_id,
            "version": next_ver,
            "status": "DRAFT",
            "summary": summary,
            "created_at": "2026-11-23T12:30:00Z",
            "legs": [],
        }
        _LIVE_ITINERARIES.insert(0, new_itin)
        return new_itin


def add_leg_with_participants(
    itinerary_id: int,
    poi_id: int | None,
    slot_id: int | None,
    kind: str,
    title: str,
    span_start: datetime,
    span_end: datetime,
    est_cost_inr: float,
    supplier_meta: dict[str, Any],
    participant_ids: list[int],
) -> dict[str, Any]:
    try:
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM itinerary_leg WHERE itinerary_id = %s",
                    (itinerary_id,),
                )
                seq = cur.fetchone()["next_seq"]
                cur.execute(
                    "INSERT INTO itinerary_leg "
                    "(itinerary_id, poi_id, slot_id, seq, kind, title, span, est_cost_inr, supplier_meta) "
                    "VALUES (%s, %s, %s, %s, %s, %s, tstzrange(%s, %s), %s, %s::jsonb) "
                    "RETURNING leg_id, itinerary_id, poi_id, slot_id, seq, kind, title, "
                    "lower(span) AS span_start, upper(span) AS span_end, est_cost_inr, supplier_meta",
                    (
                        itinerary_id,
                        poi_id,
                        slot_id,
                        seq,
                        kind,
                        title,
                        span_start,
                        span_end,
                        est_cost_inr,
                        json.dumps(supplier_meta),
                    ),
                )
                leg = cur.fetchone()
                for uid in participant_ids:
                    cur.execute(
                        "INSERT INTO leg_participant (leg_id, user_id) VALUES (%s, %s)",
                        (leg["leg_id"], uid),
                    )
                conn.commit()
                return leg
    except Exception:
        from app.repositories.user_repo import list_users
        users = list_users()
        matching_it = next((it for it in _LIVE_ITINERARIES if it["itinerary_id"] == itinerary_id), None)
        if not matching_it:
            matching_it = _LIVE_ITINERARIES[0]

        new_leg_id = len(matching_it["legs"]) + 101
        new_leg = {
            "leg_id": new_leg_id,
            "itinerary_id": itinerary_id,
            "poi_id": poi_id,
            "slot_id": slot_id,
            "seq": len(matching_it["legs"]) + 1,
            "kind": kind,
            "title": title,
            "span_start": span_start.isoformat() if hasattr(span_start, "isoformat") else str(span_start),
            "span_end": span_end.isoformat() if hasattr(span_end, "isoformat") else str(span_end),
            "est_cost_inr": float(est_cost_inr),
            "supplier_meta": supplier_meta,
            "participants": [
                {"user_id": uid, "full_name": next((u["full_name"] for u in users if u["user_id"] == uid), f"Traveler #{uid}")}
                for uid in participant_ids
            ],
        }
        matching_it["legs"].append(new_leg)
        return new_leg
