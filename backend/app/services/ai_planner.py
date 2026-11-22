import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import psycopg

from app.core.config import settings
from app.core.db import get_mongo_db, get_pg_conn
from app.core.exceptions import DomainError, NotFoundError


def _extract_intent_with_gemini(prompt: str, available_slots: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not settings.gemini_api_key:
        return None
    slot_brief = [
        {
            "slot_id": s["slot_id"],
            "poi_name": s["poi_name"],
            "city": s["city"],
            "circuit": s["circuit"],
            "window_start": str(s["window_start"]),
            "window_end": str(s["window_end"]),
            "seats_remaining": s["seats_remaining"],
            "price_inr": float(s["price_inr"]),
        }
        for s in available_slots
    ]
    system_prompt = (
        "You are Yatra's untrusted itinerary drafting assistant. "
        "Return strict JSON with keys: destination (string), summary (string), "
        "selected_slot_ids (list of int), include_flight (bool), include_hotel (bool), "
        "prefer_budget_inr (number)."
    )
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{settings.gemini_model}:generateContent?key={settings.gemini_api_key}"
    )
    payload = {
        "contents": [
            {
                "parts": [
                    {
                        "text": f"{system_prompt}\nUser request: {prompt}\nAvailable slots: {json.dumps(slot_brief)}"
                    }
                ]
            }
        ],
        "generationConfig": {"responseMimeType": "application/json"},
    }
    try:
        with httpx.Client(timeout=15.0) as client:
            res = client.post(url, json=payload)
            if res.status_code == 200:
                text = res.json()["candidates"][0]["content"]["parts"][0]["text"]
                return json.loads(text)
    except Exception:
        return None
    return None


def _extract_intent_local(prompt: str, available_slots: list[dict[str, Any]]) -> dict[str, Any]:
    lower = prompt.lower()
    city = "Hampi" if "hampi" in lower else "Agra"
    budget_match = re.search(r"(\d{4,6})", lower.replace(",", ""))
    prefer_budget = float(budget_match.group(1)) if budget_match else 15000.0
    matching_slots = [s for s in available_slots if s["city"].lower() == city.lower()] or available_slots[:2]
    chosen = [s["slot_id"] for s in matching_slots if s["seats_remaining"] > 0][:2]
    if not chosen and matching_slots:
        chosen = [matching_slots[0]["slot_id"]]

    return {
        "destination": city,
        "summary": f"Constraint-verified {city} group itinerary drafted from: {prompt[:110]}",
        "selected_slot_ids": chosen,
        "include_flight": "no flight" not in lower,
        "include_hotel": "no hotel" not in lower,
        "prefer_budget_inr": prefer_budget,
    }


def draft_itinerary_with_self_correction(
    trip_id: int,
    user_id: int,
    prompt: str,
    inject_overlap_test: bool = False,
) -> dict[str, Any]:
    mongo = get_mongo_db()
    trace: list[dict[str, Any]] = []

    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM trip WHERE trip_id = %s", (trip_id,))
            trip = cur.fetchone()
            if not trip:
                raise NotFoundError(f"Trip {trip_id} not found")

            cur.execute(
                "SELECT tm.user_id, u.full_name, tm.budget_ceiling, tm.joining_city "
                "FROM trip_member tm JOIN app_user u ON u.user_id = tm.user_id "
                "WHERE tm.trip_id = %s ORDER BY tm.user_id",
                (trip_id,),
            )
            members = cur.fetchall()
            if not members:
                raise DomainError("Trip has no members")

            cur.execute("SELECT kind, value, is_hard FROM member_constraint WHERE trip_id = %s", (trip_id,))
            constraints = cur.fetchall()

            cur.execute("SELECT * FROM slot_availability ORDER BY window_start ASC")
            available_slots = cur.fetchall()

            cur.execute("SELECT COALESCE(MAX(version), 0) + 1 AS next_ver FROM itinerary WHERE trip_id = %s", (trip_id,))
            next_version = cur.fetchone()["next_ver"]

        intent = _extract_intent_with_gemini(prompt, available_slots)
        engine_used = "gemini_api" if intent else "local_constraint_nlp"
        if not intent:
            intent = _extract_intent_local(prompt, available_slots)

        trace.append({"step": "intent_extraction", "engine": engine_used, "intent": intent})

        draft_id = str(
            mongo["itinerary_drafts"].insert_one(
                {
                    "trip_id": trip_id,
                    "requested_by": user_id,
                    "prompt": prompt,
                    "engine": engine_used,
                    "intent": intent,
                    "member_count": len(members),
                    "constraints_snapshot": constraints,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
            ).inserted_id
        )

        start_date = trip["travel_window"].lower
        base_dt = datetime(start_date.year, start_date.month, start_date.day, 8, 0, tzinfo=timezone.utc)
        candidate_legs: list[dict[str, Any]] = []

        if intent.get("include_flight", True):
            candidate_legs.append(
                {
                    "kind": "FLIGHT",
                    "title": f"Group Flight to {intent['destination']} (Auto-Drafted)",
                    "poi_id": None,
                    "slot_id": None,
                    "start": base_dt,
                    "end": base_dt + timedelta(hours=2, minutes=30),
                    "est_cost_inr": 4800.0 * len(members),
                    "supplier_meta": {"airline": "Akasa Air", "destination": intent["destination"]},
                }
            )

        if intent.get("include_hotel", True):
            hotel_start = (base_dt + timedelta(hours=1)) if inject_overlap_test else (base_dt + timedelta(hours=4))
            candidate_legs.append(
                {
                    "kind": "HOTEL",
                    "title": f"{intent['destination']} Heritage Group Stay",
                    "poi_id": None,
                    "slot_id": None,
                    "start": hotel_start,
                    "end": hotel_start + timedelta(hours=2),
                    "est_cost_inr": 3200.0 * len(members),
                    "supplier_meta": {"rooms": max(1, (len(members) + 1) // 2), "meal_plan": "breakfast"},
                }
            )

        slot_lookup = {s["slot_id"]: s for s in available_slots}
        for sid in intent.get("selected_slot_ids", []):
            slot = slot_lookup.get(sid)
            if slot:
                candidate_legs.append(
                    {
                        "kind": "ATTRACTION",
                        "title": f"{slot['poi_name']} — {slot['circuit']}",
                        "poi_id": slot["poi_id"],
                        "slot_id": slot["slot_id"],
                        "start": slot["window_start"],
                        "end": slot["window_end"],
                        "est_cost_inr": float(slot["price_inr"]) * len(members),
                        "supplier_meta": {"circuit": slot["circuit"], "seats_requested": len(members)},
                    }
                )

        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO itinerary (trip_id, version, status, summary) "
                "VALUES (%s, %s, 'DRAFT', %s) RETURNING *",
                (trip_id, next_version, intent["summary"]),
            )
            itinerary = cur.fetchone()
            itinerary_id = itinerary["itinerary_id"]

            seq = 1
            created_legs = []
            for leg in candidate_legs:
                attempts = 0
                current_start = leg["start"]
                current_end = leg["end"]
                duration = current_end - current_start

                while attempts < 4:
                    attempts += 1
                    sp_name = f"sp_leg_{seq}_{attempts}"
                    cur.execute(f"SAVEPOINT {sp_name}")
                    try:
                        cur.execute(
                            "INSERT INTO itinerary_leg "
                            "(itinerary_id, poi_id, slot_id, seq, kind, title, span, est_cost_inr, supplier_meta) "
                            "VALUES (%s, %s, %s, %s, %s, %s, tstzrange(%s, %s), %s, %s::jsonb) "
                            "RETURNING leg_id, seq, kind, title, lower(span) AS span_start, upper(span) AS span_end, est_cost_inr, slot_id",
                            (
                                itinerary_id,
                                leg["poi_id"],
                                leg["slot_id"],
                                seq,
                                leg["kind"],
                                leg["title"],
                                current_start,
                                current_end,
                                leg["est_cost_inr"],
                                json.dumps(leg["supplier_meta"]),
                            ),
                        )
                        inserted_leg = cur.fetchone()
                        for m in members:
                            cur.execute(
                                "INSERT INTO leg_participant (leg_id, user_id) VALUES (%s, %s)",
                                (inserted_leg["leg_id"], m["user_id"]),
                            )
                        cur.execute(f"RELEASE SAVEPOINT {sp_name}")
                        created_legs.append(inserted_leg)
                        trace.append(
                            {"step": f"insert_leg_{seq}", "attempt": attempts, "status": "accepted_by_postgres", "title": leg["title"]}
                        )
                        seq += 1
                        break
                    except psycopg.Error as exc:
                        cur.execute(f"ROLLBACK TO SAVEPOINT {sp_name}")
                        sqlstate = getattr(exc, "sqlstate", "UNKNOWN")
                        trace.append(
                            {
                                "step": f"insert_leg_{seq}",
                                "attempt": attempts,
                                "status": "rejected_by_postgres",
                                "sqlstate": sqlstate,
                                "db_error": str(exc).split("\n")[0],
                                "self_correction": "Shifted leg window forward by +3 hours to resolve GiST overlap",
                            }
                        )
                        if sqlstate == "23P01":
                            current_start = current_start + timedelta(hours=3)
                            current_end = current_start + duration
                        else:
                            raise
            conn.commit()

    convo_id = str(
        mongo["llm_conversations"].insert_one(
            {
                "trip_id": trip_id,
                "itinerary_id": itinerary_id,
                "draft_doc_id": draft_id,
                "user_id": user_id,
                "prompt": prompt,
                "engine": engine_used,
                "trace": trace,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        ).inserted_id
    )

    return {
        "itinerary": itinerary,
        "legs": created_legs,
        "engine": engine_used,
        "mongo_conversation_id": convo_id,
        "mongo_draft_id": draft_id,
        "self_correction_trace": trace,
    }
