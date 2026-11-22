import json
from datetime import datetime
from typing import Any

from app.core.db import get_pg_conn


def list_trip_itineraries(trip_id: int) -> list[dict[str, Any]]:
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


def create_itinerary(trip_id: int, summary: str) -> dict[str, Any]:
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


def add_leg_participant(leg_id: int, user_id: int) -> dict[str, Any]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO leg_participant (leg_id, user_id) VALUES (%s, %s) "
                "RETURNING leg_id, user_id, itinerary_id, lower(span) AS span_start, upper(span) AS span_end",
                (leg_id, user_id),
            )
            row = cur.fetchone()
            conn.commit()
            return row
