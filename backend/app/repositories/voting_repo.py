import math
from typing import Any

from app.core.db import get_pg_conn


def list_proposals(trip_id: int) -> list[dict[str, Any]] | None:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT t.quorum_pct, (SELECT COUNT(*) FROM trip_member WHERE trip_id = t.trip_id) AS member_count "
                "FROM trip t WHERE t.trip_id = %s",
                (trip_id,),
            )
            tinfo = cur.fetchone()
            if not tinfo:
                return None

            required_votes = math.ceil((tinfo["member_count"] * tinfo["quorum_pct"]) / 100.0) if tinfo["member_count"] else 1
            cur.execute(
                "SELECT p.proposal_id, p.trip_id, p.itinerary_id, i.version AS itinerary_version, "
                "i.status AS itinerary_status, i.summary AS itinerary_summary, p.status, "
                "lower(p.voting_window) AS window_start, upper(p.voting_window) AS window_end, "
                "u.full_name AS raised_by_name "
                "FROM proposal p "
                "JOIN itinerary i ON i.itinerary_id = p.itinerary_id "
                "JOIN app_user u ON u.user_id = p.raised_by "
                "WHERE p.trip_id = %s ORDER BY p.proposal_id DESC",
                (trip_id,),
            )
            proposals = cur.fetchall()
            for prop in proposals:
                cur.execute(
                    "SELECT v.user_id, u.full_name, v.choice, v.cast_at "
                    "FROM vote v JOIN app_user u ON u.user_id = v.user_id "
                    "WHERE v.proposal_id = %s ORDER BY v.cast_at ASC",
                    (prop["proposal_id"],),
                )
                votes = cur.fetchall()
                approve_count = sum(1 for v in votes if v["choice"] == "APPROVE")
                prop["votes"] = votes
                prop["approve_count"] = approve_count
                prop["required_votes"] = required_votes
                prop["member_count"] = tinfo["member_count"]
                prop["quorum_pct"] = tinfo["quorum_pct"]
                prop["quorum_met"] = approve_count >= required_votes
            return proposals


def create_proposal(trip_id: int, itinerary_id: int, raised_by: int) -> dict[str, Any]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE itinerary SET status = 'PROPOSED' WHERE itinerary_id = %s AND status = 'DRAFT'",
                (itinerary_id,),
            )
            cur.execute(
                "INSERT INTO proposal (trip_id, itinerary_id, raised_by, status) "
                "VALUES (%s, %s, %s, 'OPEN') RETURNING proposal_id, trip_id, itinerary_id, status",
                (trip_id, itinerary_id, raised_by),
            )
            row = cur.fetchone()
            conn.commit()
            return row


def upsert_vote(proposal_id: int, user_id: int, choice: str) -> dict[str, Any]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO vote (proposal_id, user_id, choice) VALUES (%s, %s, %s) "
                "ON CONFLICT (proposal_id, user_id) DO UPDATE SET choice = EXCLUDED.choice, cast_at = NOW() "
                "RETURNING proposal_id, user_id, choice, cast_at",
                (proposal_id, user_id, choice),
            )
            row = cur.fetchone()
            conn.commit()
            return row


def approve_itinerary(itinerary_id: int) -> dict[str, Any] | None:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE itinerary SET status = 'APPROVED' WHERE itinerary_id = %s RETURNING *", (itinerary_id,))
            itin = cur.fetchone()
            if not itin:
                return None
            cur.execute(
                "UPDATE proposal SET status = 'PASSED' WHERE itinerary_id = %s AND status = 'OPEN'",
                (itinerary_id,),
            )
            cur.execute("UPDATE trip SET status = 'APPROVED' WHERE trip_id = %s", (itin["trip_id"],))
            conn.commit()  # Triggers deferred trg_enforce_itinerary_quorum
            return itin
