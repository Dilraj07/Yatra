from datetime import datetime, timezone
from decimal import Decimal
import re
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from bson import ObjectId

from app.core.config import settings
from app.core.db import get_mongo_db, get_pg_conn
from app.core.security import bearer_scheme, decode_access_token
from app.schemas.chat import ChatAnalyzeRequest, ChatMessageIn
from app.services import ai_planner

router = APIRouter(prefix="/api/chat", tags=["Trip Discussion & AI Agent"])


def _clean_for_mongo(val: Any) -> Any:
    if isinstance(val, dict):
        return {k: _clean_for_mongo(v) for k, v in val.items()}
    elif isinstance(val, list):
        return [_clean_for_mongo(v) for v in val]
    elif isinstance(val, Decimal):
        return float(val)
    elif hasattr(val, "isoformat"):
        return val.isoformat()
    elif hasattr(val, "lower") and hasattr(val, "upper"):
        return str(val)
    return val


def _get_optional_user(token_header):
    if not token_header:
        return None
    try:
        return decode_access_token(token_header.credentials)
    except Exception:
        return None


def _format_msg(doc: dict[str, Any]) -> dict[str, Any]:
    doc["id"] = str(doc.get("_id", ""))
    if "_id" in doc:
        del doc["_id"]
    return doc


def _seed_initial_trip_messages(trip_id: int) -> list[dict[str, Any]]:
    mongo = get_mongo_db()
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT title, travel_window FROM trip WHERE trip_id = %s", (trip_id,))
            trip_row = cur.fetchone()
            cur.execute(
                "SELECT u.user_id, u.full_name, tm.role, tm.budget_ceiling "
                "FROM trip_member tm JOIN app_user u ON u.user_id = tm.user_id "
                "WHERE tm.trip_id = %s ORDER BY tm.role DESC, tm.user_id ASC",
                (trip_id,),
            )
            members = cur.fetchall()

    trip_title = trip_row["title"] if trip_row else "Group Trip"
    organizer = members[0]["full_name"] if members else "Dilraj Singh"
    org_id = members[0]["user_id"] if members else 1
    m2 = members[1]["full_name"] if len(members) > 1 else "Arya Wadhwa"
    m2_id = members[1]["user_id"] if len(members) > 1 else 2
    m3 = members[2]["full_name"] if len(members) > 2 else "Aarush Luthra"
    m3_id = members[2]["user_id"] if len(members) > 2 else 3

    seed_messages = [
        {
            "trip_id": trip_id,
            "sender_id": org_id,
            "sender_name": organizer,
            "is_agent": False,
            "text": f"Welcome everyone to {trip_title}. Please discuss preferred places, timing, and budget targets here. Our AI Copilot will monitor the discussion and formulate the itinerary and budget splits.",
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
        {
            "trip_id": trip_id,
            "sender_id": m2_id,
            "sender_name": m2,
            "is_agent": False,
            "text": "I would like to reserve the Taj Mahal Night Viewing batch on Dec 18. Let us make sure we secure tickets before the capacity limit is reached.",
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
        {
            "trip_id": trip_id,
            "sender_id": m3_id,
            "sender_name": m3,
            "is_agent": False,
            "text": "Agreed. Let us also add Agra Fort on day 2. We should target keeping the per-person budget under ₹15,000.",
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
        {
            "trip_id": trip_id,
            "sender_id": 0,
            "sender_name": "Yatra Copilot",
            "is_agent": True,
            "agent_badge": "AI Copilot",
            "text": "Welcome to the trip planning hub. I am actively monitoring your conversation. When you are ready, select 'Synthesize Plan' and I will compute the itinerary schedule, budget breakdown with LaTeX equations, and seat allocations.",
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
    ]

    for m in seed_messages:
        mongo["trip_messages"].insert_one(m)

    return [_format_msg(m) for m in seed_messages]


@router.get("/trip/{trip_id}")
def get_trip_messages(trip_id: int):
    mongo = get_mongo_db()
    cursor = mongo["trip_messages"].find({"trip_id": trip_id}).sort("created_at", 1)
    messages = [_format_msg(doc) for doc in cursor]
    if not messages:
        messages = _seed_initial_trip_messages(trip_id)
    return messages


@router.post("/trip/{trip_id}/messages", status_code=201)
def post_trip_message(
    trip_id: int,
    payload: ChatMessageIn,
    token_creds=Depends(bearer_scheme),
):
    user = _get_optional_user(token_creds)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required to send chat messages. Please sign in.")

    mongo = get_mongo_db()

    sender_name = user.get("full_name") or payload.sender_name or "Traveler"
    sender_id = int(user["sub"]) if "sub" in user else (payload.sender_id or 1)

    msg_doc = {
        "trip_id": trip_id,
        "sender_id": sender_id,
        "sender_name": sender_name,
        "is_agent": False,
        "text": payload.text,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    res = mongo["trip_messages"].insert_one(msg_doc)
    msg_doc["id"] = str(res.inserted_id)
    return _format_msg(msg_doc)


@router.delete("/trip/{trip_id}/messages")
def reset_trip_messages(trip_id: int):
    mongo = get_mongo_db()
    mongo["trip_messages"].delete_many({"trip_id": trip_id})
    return {"status": "ok", "message": f"Chat reset for trip {trip_id}"}


@router.post("/trip/{trip_id}/analyze")
def analyze_and_update_plan(
    trip_id: int,
    payload: Optional[ChatAnalyzeRequest] = None,
    token_creds=Depends(bearer_scheme),
):
    user = _get_optional_user(token_creds)
    user_id = int(user["sub"]) if user else 1

    mongo = get_mongo_db()
    cursor = mongo["trip_messages"].find({"trip_id": trip_id}).sort("created_at", 1)
    all_msgs = list(cursor)

    chat_transcript = " ".join([m.get("text", "") for m in all_msgs if not m.get("is_agent")])
    if payload and payload.custom_instruction:
        chat_transcript += f" Additional instruction: {payload.custom_instruction}"

    # Extract target budget from chat discussion or default to 15000
    budget_match = re.search(r"(\d{4,6})", chat_transcript.replace(",", ""))
    target_budget = float(budget_match.group(1)) if budget_match else 15000.0

    # Extract destination
    lower_chat = chat_transcript.lower()
    city = "Hampi" if "hampi" in lower_chat else "Agra"

    synth_prompt = f"Plan a group trip to {city} based on group chat discussion: {chat_transcript} with budget under {int(target_budget)} INR"

    # Draft itinerary through AI planner with self-correction
    draft_result = ai_planner.draft_itinerary_with_self_correction(
        trip_id=trip_id,
        user_id=user_id,
        prompt=synth_prompt,
        inject_overlap_test=False,
    )

    itinerary = draft_result.get("itinerary", {})
    legs = draft_result.get("legs", [])
    total_cost = sum(float(l.get("est_cost_inr", 0)) for l in legs)

    # Fetch trip members to calculate per-person budget
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS member_count FROM trip_member WHERE trip_id = %s", (trip_id,))
            m_count = cur.fetchone()["member_count"] or 1
            cur.execute("SELECT * FROM slot_availability WHERE city = %s ORDER BY window_start ASC LIMIT 4", (city,))
            sample_slots = cur.fetchall()

    per_person_est = round(total_cost / max(m_count, 1), 2)
    budget_delta = round(target_budget - per_person_est, 2)
    is_under = budget_delta >= 0

    # Build agent response message with clean LaTeX mathematical formatting
    agent_text = (
        f"**Trip Consensus Synthesized**\n\n"
        f"**Destination:** {city}\n"
        f"**Generated Itinerary:** Version #{itinerary.get('version', 1)} with {len(legs)} scheduled legs\n"
        f"**Travelers:** {m_count} registered group members\n\n"
        f"**Budget & Cost Analysis:**\n"
        f"$$\\text{{Total Group Cost}} = \\sum_{{i=1}}^{{{len(legs)}}} c_i = ₹{total_cost:,.2f}$$\n"
        f"$$\\text{{Per-Person Share}} = \\frac{{\\text{{Total Group Cost}}}}{{\\text{{Travelers}}}} = \\frac{{₹{total_cost:,.2f}}}{{{m_count}}} = ₹{per_person_est:,.2f}$$\n"
        f"$$\\Delta_{{\\text{{Budget}}}} = \\text{{Ceiling}} - \\text{{Per-Person}} = ₹{target_budget:,.2f} - ₹{per_person_est:,.2f} = {'+' if is_under else ''}₹{budget_delta:,.2f} \\quad \\text{{({'Within Budget' if is_under else 'Exceeds Ceiling'})}}$$\n\n"
        f"**Capacity Allocations:** Mapped high-priority ASI slots to itinerary legs for your dates."
    )

    agent_plan_card = {
        "itinerary_id": itinerary.get("itinerary_id"),
        "version": itinerary.get("version"),
        "destination": city,
        "total_cost": total_cost,
        "per_person_est": per_person_est,
        "target_budget": target_budget,
        "leg_count": len(legs),
        "legs": legs,
        "slots": sample_slots,
    }

    ai_doc = {
        "trip_id": trip_id,
        "sender_id": 0,
        "sender_name": "Yatra Copilot",
        "is_agent": True,
        "agent_badge": "AI Copilot",
        "text": agent_text,
        "plan_summary": _clean_for_mongo(agent_plan_card),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    mongo["trip_messages"].insert_one(ai_doc)

    # Return refreshed messages and the new plan
    updated_cursor = mongo["trip_messages"].find({"trip_id": trip_id}).sort("created_at", 1)
    messages = [_format_msg(doc) for doc in updated_cursor]

    return {
        "status": "success",
        "draft_result": _clean_for_mongo(draft_result),
        "agent_plan_card": _clean_for_mongo(agent_plan_card),
        "messages": messages,
    }
