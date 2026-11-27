import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx

from app.core.config import settings
from app.core.exceptions import ConflictError, DomainError, NotFoundError
from app.repositories import chat_repo, chat_task_repo, itinerary_repo
from app.services import chat_permission_service

logger = logging.getLogger("yatra.chat_agent")

_WEEKDAYS = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}

_MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3,
    "apr": 4, "april": 4, "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7,
    "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10, "nov": 11, "november": 11, "dec": 12, "december": 12,
}


def _strip_emojis(text: str) -> str:
    return re.sub(r"[\U00010000-\U0010ffff\u2600-\u27BF]", "", text or "").strip()


def _parse_deadline(text: str, now: datetime | None = None) -> tuple[Optional[datetime], Optional[str]]:
    now = now or datetime.now(timezone.utc)
    lower = text.lower()

    if "today" in lower or "tonight" in lower:
        due = now.replace(hour=18, minute=0, second=0, microsecond=0)
        if due <= now:
            due = due + timedelta(days=1)
        return due, "Today"

    if "tomorrow" in lower:
        due = (now + timedelta(days=1)).replace(hour=17, minute=0, second=0, microsecond=0)
        return due, "Tomorrow"

    if "next week" in lower:
        days_ahead = (7 - now.weekday()) + 2  # Wednesday next week
        due = (now + timedelta(days=days_ahead)).replace(hour=12, minute=0, second=0, microsecond=0)
        return due, "Next week"

    for day_name, wd in _WEEKDAYS.items():
        if re.search(rf"\b{day_name}\b", lower):
            delta = (wd - now.weekday()) % 7
            if delta == 0:
                delta = 7
            due = (now + timedelta(days=delta)).replace(hour=17, minute=0, second=0, microsecond=0)
            return due, day_name.title()

    m = re.search(r"\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+(\d{1,2})\b", lower)
    if m:
        month = _MONTHS[m.group(1)]
        day = int(m.group(2))
        year = now.year if month >= now.month else now.year + 1
        try:
            due = datetime(year, month, day, 18, 0, tzinfo=timezone.utc)
            return due, f"{m.group(1).title()} {day}"
        except ValueError:
            pass

    return None, None


def _match_assignee(text: str, members: list[dict[str, Any]], mentions: list[int] | None = None) -> Optional[dict[str, Any]]:
    lower = text.lower()
    # Direct mention IDs first
    if mentions:
        for uid in mentions:
            for m in members:
                if int(m["user_id"]) == int(uid):
                    return m

    # Explicit "assign ... to <Name>" or "<Name>, please ..."
    for m in members:
        full = (m.get("full_name") or "").strip()
        if not full:
            continue
        first = full.split()[0].lower()
        full_l = full.lower()
        patterns = [
            rf"\b(?:to|for|assign(?:ed)?\s+to)\s+{re.escape(first)}\b",
            rf"\b(?:to|for|assign(?:ed)?\s+to)\s+{re.escape(full_l)}\b",
            rf"@{re.escape(first)}\b",
            rf"@{re.escape(full_l)}\b",
            rf"^\s*{re.escape(first)}[,:\s]+(?:please|kindly|can you|take care|handle|check|book|prepare|send|complete)",
            rf"\b{re.escape(first)}\s+(?:will|should|needs to|please|can)\b",
        ]
        if any(re.search(p, lower) for p in patterns):
            return m
    return None


def _infer_leg_kind(text: str) -> Optional[str]:
    lower = text.lower()
    if any(k in lower for k in ["flight", "air ", "indigo", "akasa", "airport", "boarding"]):
        return "FLIGHT"
    if any(k in lower for k in ["hotel", "resort", "stay", "check-in", "room", "accommodation"]):
        return "HOTEL"
    if any(k in lower for k in ["taj", "fort", "temple", "heritage", "museum", "ticket", "monument", "viewing"]):
        return "ATTRACTION"
    if any(k in lower for k in ["cab", "taxi", "train", "bus", "transfer", "pickup", "shuttle"]):
        return "TRANSFER"
    if any(k in lower for k in ["schedule", "tour", "dinner", "activity", "kayak", "walk", "plan"]):
        return "ACTIVITY"
    return None


def _extract_task_title(text: str, assignee: Optional[dict[str, Any]]) -> str:
    cleaned = text.strip()
    cleaned = re.sub(r"@copilot|@agent", "", cleaned, flags=re.IGNORECASE).strip()
    if assignee:
        first = (assignee.get("full_name") or "").split()[0]
        cleaned = re.sub(rf"^{re.escape(first)}[,:\s]+", "", cleaned, flags=re.IGNORECASE).strip()
    cleaned = re.sub(r"^(?:please|kindly|let's|lets|we need to|need to|can you)\s+", "", cleaned, flags=re.IGNORECASE).strip()
    cleaned = re.sub(r"^(?:assign this task to \w+(?:\s+to)?|assign to \w+)\s*", "", cleaned, flags=re.IGNORECASE).strip()
    if not cleaned or len(cleaned) < 4:
        cleaned = text.strip()
    return cleaned[:140].rstrip(".")


def _heuristic_analyze(
    *,
    text: str,
    sender_name: str,
    members: list[dict[str, Any]],
    mentions: list[int],
    existing_tasks: list[dict[str, Any]],
    explicit_invoke: bool,
) -> dict[str, Any]:
    lower = text.lower().strip()
    assignee = _match_assignee(text, members, mentions)
    due_at, due_label = _parse_deadline(text)
    leg_kind = _infer_leg_kind(text)

    is_assignment = assignee is not None or any(
        k in lower for k in ["assign ", "take care of", "responsible for", "owner for", "handle this", "follow up"]
    )
    is_schedule = any(k in lower for k in ["schedule", "book ", "reserve ", "complete ", "before ", "deadline", "by ", "next week"])
    is_risk = any(k in lower for k in ["delay", "delayed", "sold out", "blocked", "risk", "urgent", "asap", "issue", "running out", "only "])
    is_decision = any(k in lower for k in ["agreed", "confirmed", "decided", "finalized", "approved", "let's go with"])
    is_question = "?" in text or any(lower.startswith(q) for q in ["what ", "when ", "where ", "who ", "how ", "should we", "can we", "is there"])

    if is_risk:
        classification = "DEADLINE_RISK"
    elif is_assignment:
        classification = "ASSIGNMENT"
    elif is_schedule:
        classification = "INSTRUCTION"
    elif is_decision:
        classification = "DECISION"
    elif is_question:
        classification = "QUESTION"
    else:
        classification = "GENERAL"

    priority = "URGENT" if any(k in lower for k in ["urgent", "asap", "immediately", "sold out"]) else (
        "HIGH" if (due_at is not None or is_risk or is_assignment) else "MEDIUM"
    )

    # Check dependencies against existing open tasks
    deps: list[int] = []
    if any(k in lower for k in ["after ", "depends on", "blocked by", "once ", "follow up"]):
        for t in existing_tasks[:3]:
            if t["status"] in ("PROPOSED", "TODO", "IN_PROGRESS", "BLOCKED"):
                deps.append(int(t["task_id"]))
                break

    proposed_task = None
    if is_assignment or is_schedule or (is_risk and leg_kind):
        title = _extract_task_title(text, assignee)
        if not title or title.lower().startswith("this task"):
            title = f"Follow up on {sender_name}'s request"
        sched_start = due_at - timedelta(hours=2) if (due_at and leg_kind) else None
        sched_end = due_at if (due_at and leg_kind) else None
        cost_match = re.search(r"(?:₹|rs\.?|inr)\s*([\d,]+)", lower)
        est_cost = float(cost_match.group(1).replace(",", "")) if cost_match else 0.0
        proposed_task = {
            "title": title,
            "description": f"Identified from message by {sender_name}: \"{text}\"",
            "assigned_to_user_id": int(assignee["user_id"]) if assignee else None,
            "assigned_to_agent": False,
            "priority": priority,
            "due_at": due_at,
            "due_label": due_label,
            "schedule_start": sched_start,
            "schedule_end": sched_end,
            "leg_kind": leg_kind,
            "est_cost_inr": est_cost,
            "dependencies": deps,
            "reminder_at": (due_at - timedelta(hours=12)) if due_at else None,
        }

    # Build concise, helpful reply when appropriate
    should_reply = explicit_invoke or proposed_task is not None or is_risk or is_decision or is_question
    if classification == "GENERAL" and not explicit_invoke and len(text.split()) <= 5:
        should_reply = False

    reply_text = None
    if should_reply:
        if proposed_task:
            who = assignee["full_name"] if assignee else "Unassigned"
            due_part = f" | Due: {due_label}" if due_label else ""
            kind_part = f" | Plan link: {leg_kind}" if leg_kind else ""
            reply_text = (
                f"**Proposed Task Ready for Confirmation**\n"
                f"I identified an actionable item from {sender_name}: **{proposed_task['title']}** "
                f"(Assignee: {who} | Priority: {priority}{due_part}{kind_part}). "
                f"Use **Confirm & Assign** to activate this task without altering confirmed plans automatically."
            )
        elif is_risk:
            reply_text = (
                f"**Schedule & Risk Alert**\n"
                f"Flagged potential delay or capacity constraint mentioned by {sender_name}. "
                f"Recommend reviewing open tasks and confirming timed reservations early."
            )
        elif is_decision:
            reply_text = (
                f"**Decision Logged**\n"
                f"Noted the group consensus update from {sender_name}. "
                f"You can convert this into a formal itinerary vote or confirmed task whenever ready."
            )
        elif explicit_invoke or is_question:
            if any(k in lower for k in ["budget", "cost", "split", "₹", "inr"]):
                reply_text = (
                    f"**Budget & Split Check**\n"
                    f"Tracking group expenses and per-person budget limits. Mention an assignee or deadline to create a follow-up task, or check the Budget view for exact settlement splits."
                )
            elif any(k in lower for k in ["summary", "summarize", "status", "pending", "tasks"]):
                open_cnt = len([t for t in existing_tasks if t["status"] in ("PROPOSED", "TODO", "IN_PROGRESS", "BLOCKED")])
                reply_text = (
                    f"**Operations Status**\n"
                    f"There are currently {open_cnt} active or proposed tasks in this conversation. "
                    f"Click **Summarize Thread** for a full breakdown of decisions, owners, and deadlines."
                )
            else:
                reply_text = (
                    f"**Yatra Copilot**\n"
                    f"Noted from {sender_name}. Mention a teammate and deadline (for example, \"Assign hotel booking to Arya before Friday\") and I will draft a structured task linked to your trip plan."
                )

    summary = f"{classification}: {text[:120]}"
    return {
        "classification": classification,
        "should_reply": bool(should_reply and reply_text),
        "reply_text": reply_text,
        "summary": summary,
        "proposed_task": proposed_task,
        "recommendations": [
            {
                "type": classification,
                "title": proposed_task["title"] if proposed_task else summary,
                "priority": priority,
            }
        ],
    }


def _llm_analyze(
    *,
    text: str,
    sender_name: str,
    transcript: str,
    members: list[dict[str, Any]],
    existing_tasks: list[dict[str, Any]],
    itinerary_brief: str,
) -> Optional[dict[str, Any]]:
    member_brief = [{"user_id": m["user_id"], "full_name": m["full_name"], "role": m["role"]} for m in members]
    task_brief = [
        {"task_id": t["task_id"], "title": t["title"], "status": t["status"], "assignee": t.get("assignee_name")}
        for t in existing_tasks[:8]
    ]
    sys_prompt = (
        "You are Yatra Copilot, an AI Operations Agent inside a group travel messaging workspace. "
        "Analyze the latest message in context of the conversation history, members, tasks, and itinerary. "
        "Rules: Zero emojis. Never mention internal database/software names. Do not fabricate prices or confirm sensitive mutations automatically. "
        "Return strict JSON with keys: "
        "classification ('GENERAL'|'DECISION'|'ASSIGNMENT'|'INSTRUCTION'|'QUESTION'|'DEADLINE_RISK'), "
        "should_reply (bool), "
        "reply_text (string or null, concise 1-3 sentences), "
        "summary (string, 1 sentence), "
        "proposed_task (null or object {title, description, assignee_user_id (int|null), priority ('LOW'|'MEDIUM'|'HIGH'|'URGENT'), due_iso (ISO8601|null), leg_kind ('FLIGHT'|'HOTEL'|'ATTRACTION'|'TRANSFER'|'ACTIVITY'|null), est_cost_inr (number)})."
    )
    now_utc = datetime.now(timezone.utc)
    user_prompt = (
        f"Current UTC DateTime: {now_utc.isoformat()} ({now_utc.strftime('%A')})\n"
        f"Members: {json.dumps(member_brief)}\n"
        f"Open Tasks: {json.dumps(task_brief)}\n"
        f"Itinerary: {itinerary_brief}\n"
        f"Recent Chat:\n{transcript}\n\n"
        f"New Message from {sender_name}: {text}"
    )

    try:
        if settings.openai_api_key:
            with httpx.Client(timeout=8.0) as client:
                res = client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {settings.openai_api_key}", "Content-Type": "application/json"},
                    json={
                        "model": settings.openai_model or "gpt-4o-mini",
                        "messages": [{"role": "system", "content": sys_prompt}, {"role": "user", "content": user_prompt}],
                        "response_format": {"type": "json_object"},
                        "temperature": 0.2,
                    },
                )
                if res.status_code == 200:
                    return json.loads(res.json()["choices"][0]["message"]["content"])

        if settings.gemini_api_key:
            candidates: list[str] = []
            for m in (settings.gemini_model, "gemini-2.5-flash", "gemini-flash-lite-latest", "gemini-flash-latest"):
                if m and m not in candidates:
                    candidates.append(m)
            with httpx.Client(timeout=6.0) as client:
                for model_name in candidates:
                    url = (
                        f"https://generativelanguage.googleapis.com/v1beta/models/"
                        f"{model_name}:generateContent?key={settings.gemini_api_key}"
                    )
                    res = client.post(
                        url,
                        json={
                            "contents": [{"parts": [{"text": f"{sys_prompt}\n\n{user_prompt}"}]}],
                            "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2},
                        },
                    )
                    if res.status_code == 200:
                        txt = res.json()["candidates"][0]["content"]["parts"][0]["text"]
                        return json.loads(txt)
                    logger.warning("Gemini model %s returned HTTP %s: %s", model_name, res.status_code, res.text[:200])
    except Exception as exc:
        logger.warning("LLM analysis fallback to deterministic parser: %s", exc)
    return None


def _parse_iso_dt(val: Optional[str]) -> Optional[datetime]:
    if not val:
        return None
    try:
        return datetime.fromisoformat(val.replace("Z", "+00:00"))
    except Exception:
        return None


def process_incoming_message(
    *,
    conversation: dict[str, Any],
    message: dict[str, Any],
    sender_user_id: int,
    sender_name: str,
) -> dict[str, Any]:
    """
    Monitors a newly posted user message, respects agent_enabled & agent_mode,
    extracts tasks/risks/decisions, creates audit trail & notifications, and
    returns any agent message / proposed task created.
    """
    conv_id = int(conversation["conversation_id"])
    if not conversation.get("agent_enabled", True) or conversation.get("agent_mode") == "OFF":
        return {"agent_message": None, "proposed_task": None, "audit": None}

    mode = conversation.get("agent_mode", "ACTIVE")
    body = message.get("body") or ""
    lower = body.lower()
    explicit_invoke = any(tok in lower for tok in ["@copilot", "@agent", "yatra copilot"])

    members = chat_repo.list_members(conv_id)
    existing_tasks = chat_task_repo.list_tasks(conv_id)
    recent = chat_repo.list_messages(conv_id, sender_user_id, limit=12)
    transcript = "\n".join(f"{m['sender_name']}: {m['body']}" for m in recent[-10:])

    itinerary_brief = "None"
    active_itin_id = None
    if conversation.get("trip_id"):
        itins = itinerary_repo.list_trip_itineraries(int(conversation["trip_id"]))
        if itins:
            active_itin_id = int(itins[0]["itinerary_id"])
            leg_titles = [f"{l['kind']}: {l['title']}" for l in (itins[0].get("legs") or [])[:6]]
            itinerary_brief = f"Itinerary #{active_itin_id} ({itins[0]['status']}): {', '.join(leg_titles)}"

    mentions = message.get("mentions_json") or []
    heuristic = _heuristic_analyze(
        text=body,
        sender_name=sender_name,
        members=members,
        mentions=mentions,
        existing_tasks=existing_tasks,
        explicit_invoke=explicit_invoke,
    )

    analysis = heuristic
    if not os.environ.get("PYTEST_CURRENT_TEST") and (settings.openai_api_key or settings.gemini_api_key):
        llm_res = _llm_analyze(
            text=body,
            sender_name=sender_name,
            transcript=transcript,
            members=members,
            existing_tasks=existing_tasks,
            itinerary_brief=itinerary_brief,
        )
        if isinstance(llm_res, dict) and llm_res.get("classification"):
            pt = llm_res.get("proposed_task")
            parsed_pt = None
            if isinstance(pt, dict) and pt.get("title"):
                raw_due = _parse_iso_dt(pt.get("due_iso"))
                if raw_due and raw_due < datetime.now(timezone.utc) - timedelta(hours=1):
                    raw_due = None
                due_dt = raw_due or (heuristic.get("proposed_task") or {}).get("due_at")
                lk = pt.get("leg_kind")
                if lk not in ("FLIGHT", "HOTEL", "ATTRACTION", "TRANSFER", "ACTIVITY"):
                    lk = (heuristic.get("proposed_task") or {}).get("leg_kind")
                aid = pt.get("assignee_user_id")
                valid_ids = {int(m["user_id"]) for m in members}
                if aid not in valid_ids:
                    aid = (heuristic.get("proposed_task") or {}).get("assigned_to_user_id")
                parsed_pt = {
                    "title": _strip_emojis(str(pt["title"]))[:180],
                    "description": _strip_emojis(str(pt.get("description") or f"From message by {sender_name}: {body}")),
                    "assigned_to_user_id": aid,
                    "assigned_to_agent": False,
                    "priority": pt.get("priority") if pt.get("priority") in ("LOW", "MEDIUM", "HIGH", "URGENT") else "MEDIUM",
                    "due_at": due_dt,
                    "schedule_start": (due_dt - timedelta(hours=2)) if (due_dt and lk) else None,
                    "schedule_end": due_dt if (due_dt and lk) else None,
                    "leg_kind": lk,
                    "est_cost_inr": float(pt.get("est_cost_inr") or 0),
                    "dependencies": (heuristic.get("proposed_task") or {}).get("dependencies", []),
                    "reminder_at": (due_dt - timedelta(hours=12)) if due_dt else None,
                }
            elif heuristic.get("proposed_task"):
                parsed_pt = heuristic["proposed_task"]

            analysis = {
                "classification": llm_res["classification"],
                "should_reply": bool(llm_res.get("should_reply")) or explicit_invoke,
                "reply_text": _strip_emojis(llm_res.get("reply_text") or "") or heuristic.get("reply_text"),
                "summary": _strip_emojis(llm_res.get("summary") or heuristic["summary"]),
                "proposed_task": parsed_pt,
                "recommendations": [{"type": llm_res["classification"], "title": llm_res.get("summary", ""), "priority": "MEDIUM"}],
            }

    created_task = None
    pt_data = analysis.get("proposed_task")
    if pt_data:
        created_task = chat_task_repo.create_task(
            conversation_id=conv_id,
            source_message_id=int(message["message_id"]),
            trip_id=conversation.get("trip_id"),
            itinerary_id=active_itin_id,
            title=pt_data["title"],
            description=pt_data.get("description", ""),
            assigned_to_user_id=pt_data.get("assigned_to_user_id"),
            assigned_to_agent=pt_data.get("assigned_to_agent", False),
            created_by_user_id=sender_user_id,
            proposed_by_agent=True,
            priority=pt_data.get("priority", "MEDIUM"),
            status="PROPOSED",
            due_at=pt_data.get("due_at"),
            schedule_start=pt_data.get("schedule_start"),
            schedule_end=pt_data.get("schedule_end"),
            leg_kind=pt_data.get("leg_kind"),
            est_cost_inr=pt_data.get("est_cost_inr", 0.0),
            dependencies=pt_data.get("dependencies", []),
            reminder_at=pt_data.get("reminder_at"),
        )
        # Notify assignee or conversation owner about proposed task
        target_uid = created_task.get("assigned_to_user_id")
        if target_uid and int(target_uid) != int(sender_user_id):
            chat_task_repo.create_notification(
                user_id=int(target_uid),
                conversation_id=conv_id,
                message_id=int(message["message_id"]),
                task_id=int(created_task["task_id"]),
                kind="TASK_PROPOSED",
                title=f"Proposed task for you in {conversation['title']}",
                body=f"{created_task['title']} (awaiting confirmation)",
            )

    action_taken = "PROPOSED_TASK" if created_task else "LOGGED"
    audit = chat_task_repo.create_agent_audit(
        conversation_id=conv_id,
        trigger_message_id=int(message["message_id"]),
        agent_mode=mode,
        classification=analysis["classification"],
        summary=analysis["summary"],
        recommendations=analysis.get("recommendations", []),
        action_taken=action_taken,
    )

    # In OBSERVE mode, stay silent unless explicitly invoked with @copilot / @agent
    agent_msg = None
    should_post = (mode == "ACTIVE" and analysis.get("should_reply")) or explicit_invoke
    if should_post and analysis.get("reply_text"):
        agent_meta = {
            "classification": analysis["classification"],
            "proposed_task_id": created_task["task_id"] if created_task else None,
            "audit_id": audit["audit_id"],
        }
        agent_msg = chat_repo.create_message(
            conversation_id=conv_id,
            sender_id=None,
            sender_name="Yatra Copilot",
            sender_type="AGENT",
            message_type="AGENT_PROPOSAL" if created_task else "TEXT",
            body=analysis["reply_text"],
            reply_to_message_id=int(message["message_id"]),
            agent_metadata=agent_meta,
            viewer_user_id=sender_user_id,
        )

    return {"agent_message": agent_msg, "proposed_task": created_task, "audit": audit}


def summarize_conversation(conversation_id: int, actor_user_id: int, post_to_chat: bool = True) -> dict[str, Any]:
    conv = chat_repo.get_conversation(conversation_id)
    if not conv:
        raise NotFoundError("Conversation not found")
    member = chat_repo.get_member(conversation_id, actor_user_id)
    chat_permission_service.require_membership(member)

    messages = chat_repo.list_messages(conversation_id, actor_user_id, limit=40)
    tasks = chat_task_repo.list_tasks(conversation_id)
    user_msgs = [m for m in messages if not m.get("is_deleted") and m.get("sender_type") == "USER"]

    open_questions = [m["body"] for m in user_msgs if "?" in m["body"]][-3:]
    proposed = [t for t in tasks if t["status"] == "PROPOSED"]
    active = [t for t in tasks if t["status"] in ("TODO", "IN_PROGRESS", "BLOCKED")]
    done = [t for t in tasks if t["status"] == "DONE"]

    lines = [
        f"**Conversation Summary ({conv['title']})**",
        f"- **Messages analyzed:** {len(user_msgs)} traveler messages",
        f"- **Tasks:** {len(proposed)} awaiting approval, {len(active)} active, {len(done)} completed",
    ]
    if active or proposed:
        lines.append("- **Key Action Items:** " + "; ".join(f"{t['title']} ({t.get('assignee_name') or 'Unassigned'}, {t['status']})" for t in (proposed + active)[:4]))
    if open_questions:
        lines.append("- **Open Questions:** " + " | ".join(q[:90] for q in open_questions))

    summary_text = "\n".join(lines)
    if not os.environ.get("PYTEST_CURRENT_TEST") and settings.gemini_api_key and user_msgs:
        try:
            transcript = "\n".join(f"{m['sender_name']}: {m['body']}" for m in user_msgs[-25:])
            prompt = (
                "Summarize this group travel discussion concisely in plain text/markdown bullets (zero emojis): "
                "include Key Decisions, Pending Tasks/Owners, and Open Questions.\n\n"
                f"Group: {conv['title']}\n"
                f"Tasks: {json.dumps([{'title': t['title'], 'status': t['status'], 'assignee': t.get('assignee_name')} for t in tasks[:12]])}\n\n"
                f"Messages:\n{transcript}"
            )
            for model_name in [m for m in (settings.gemini_model, "gemini-2.5-flash", "gemini-flash-lite-latest", "gemini-flash-latest") if m]:
                url = (
                    f"https://generativelanguage.googleapis.com/v1beta/models/"
                    f"{model_name}:generateContent?key={settings.gemini_api_key}"
                )
                with httpx.Client(timeout=6.0) as client:
                    res = client.post(
                        url,
                        json={
                            "contents": [{"parts": [{"text": prompt}]}],
                            "generationConfig": {"temperature": 0.2},
                        },
                    )
                    if res.status_code == 200:
                        ai_sum = _strip_emojis(res.json()["candidates"][0]["content"]["parts"][0]["text"])
                        if ai_sum:
                            summary_text = ai_sum
                        break
        except Exception as exc:
            logger.warning("Gemini summary fallback to deterministic summary: %s", exc)
    audit = chat_task_repo.create_agent_audit(
        conversation_id=conversation_id,
        trigger_message_id=messages[-1]["message_id"] if messages else None,
        agent_mode=conv.get("agent_mode", "ACTIVE"),
        classification="SUMMARY",
        summary=f"Generated summary across {len(user_msgs)} messages and {len(tasks)} tasks.",
        action_taken="SUMMARY_GENERATED",
        authorized_by_user_id=actor_user_id,
    )
    msg = None
    if post_to_chat:
        msg = chat_repo.create_message(
            conversation_id=conversation_id,
            sender_id=None,
            sender_name="Yatra Copilot",
            sender_type="AGENT",
            message_type="TEXT",
            body=summary_text,
            agent_metadata={"classification": "SUMMARY", "audit_id": audit["audit_id"]},
            viewer_user_id=actor_user_id,
        )
    return {"summary": summary_text, "message": msg, "audit": audit}


def authorize_and_sync_task(
    *,
    task_id: int,
    actor_user_id: int,
    action: str,
    schedule_into_itinerary: bool = False,
    itinerary_id: Optional[int] = None,
    assigned_to_user_id: Optional[int] = None,
    schedule_start: Optional[datetime] = None,
    schedule_end: Optional[datetime] = None,
    leg_kind: Optional[str] = None,
    est_cost_inr: Optional[float] = None,
) -> dict[str, Any]:
    task = chat_task_repo.get_task(task_id)
    if not task:
        raise NotFoundError(f"Task {task_id} not found")

    conv = chat_repo.get_conversation(int(task["conversation_id"]))
    if not conv:
        raise NotFoundError("Conversation not found")

    member = chat_repo.get_member(int(conv["conversation_id"]), actor_user_id)
    chat_permission_service.require_membership(member)

    # Authorization check: Owner/Admin/Moderator OR the assigned user OR task creator can confirm/reject
    is_privileged = chat_permission_service.get_role_rank(member.get("role")) >= chat_permission_service.ROLE_RANK["MODERATOR"]
    is_assignee = task.get("assigned_to_user_id") and int(task["assigned_to_user_id"]) == int(actor_user_id)
    is_creator = task.get("created_by_user_id") and int(task["created_by_user_id"]) == int(actor_user_id)
    if not (is_privileged or is_assignee or is_creator):
        raise DomainError("Only group Owners/Admins/Moderators, the creator, or the assignee can authorize this task.")

    was_proposed = task.get("status") == "PROPOSED"
    if action == "REJECT":
        if was_proposed:
            updated = chat_task_repo.claim_task_decision(task_id, actor_user_id, "REJECTED")
            if not updated:
                raise ConflictError("Task was already confirmed or rejected.")
        else:
            updated = chat_task_repo.update_task(
                task_id,
                {
                    "status": "REJECTED",
                    "confirmed_by_user_id": actor_user_id,
                    "confirmed_at": datetime.now(timezone.utc),
                },
            )
        chat_task_repo.create_agent_audit(
            conversation_id=int(conv["conversation_id"]),
            trigger_message_id=task.get("source_message_id"),
            agent_mode=conv.get("agent_mode", "ACTIVE"),
            classification="ASSIGNMENT",
            summary=f"Task '{task['title']}' rejected.",
            action_taken="TASK_REJECTED",
            authorized_by_user_id=actor_user_id,
        )
        return {"task": updated, "created_leg": None}

    # Re-assigning to someone else requires Moderator+ if actor wasn't already privileged
    if assigned_to_user_id and int(assigned_to_user_id) != int(task.get("assigned_to_user_id") or 0) and not is_privileged:
        chat_permission_service.require_can_moderate(member)

    if was_proposed:
        claimed = chat_task_repo.claim_task_decision(task_id, actor_user_id, "TODO")
        if not claimed:
            raise ConflictError("Task was already confirmed or rejected.")

    update_fields: dict[str, Any] = {
        "status": "TODO",
        "confirmed_by_user_id": actor_user_id,
        "confirmed_at": datetime.now(timezone.utc),
    }
    if assigned_to_user_id is not None:
        update_fields["assigned_to_user_id"] = assigned_to_user_id
    if schedule_start is not None:
        update_fields["schedule_start"] = schedule_start
    if schedule_end is not None:
        update_fields["schedule_end"] = schedule_end
    if leg_kind is not None:
        update_fields["leg_kind"] = leg_kind
    if est_cost_inr is not None:
        update_fields["est_cost_inr"] = est_cost_inr

    created_leg = None
    if schedule_into_itinerary and conv.get("trip_id"):
        trip_id = int(conv["trip_id"])
        target_itin_id = itinerary_id or task.get("itinerary_id")
        if not target_itin_id:
            itins = itinerary_repo.list_trip_itineraries(trip_id)
            if itins:
                target_itin_id = int(itins[0]["itinerary_id"])
            else:
                new_itin = itinerary_repo.create_itinerary(trip_id, f"Plan for {conv['title']}")
                target_itin_id = int(new_itin["itinerary_id"])

        start_dt = schedule_start or task.get("schedule_start") or (datetime.now(timezone.utc) + timedelta(days=2)).replace(hour=10, minute=0, second=0, microsecond=0)
        end_dt = schedule_end or task.get("schedule_end") or (start_dt + timedelta(hours=2))
        if end_dt <= start_dt:
            end_dt = start_dt + timedelta(hours=2)

        kind = leg_kind or task.get("leg_kind") or "ACTIVITY"
        cost = est_cost_inr if est_cost_inr is not None else float(task.get("est_cost_inr") or 0.0)
        p_ids = [int(assigned_to_user_id or task["assigned_to_user_id"])] if (assigned_to_user_id or task.get("assigned_to_user_id")) else [
            int(m["user_id"]) for m in chat_repo.list_members(int(conv["conversation_id"]))
        ]
        try:
            created_leg = itinerary_repo.add_leg_with_participants(
                itinerary_id=int(target_itin_id),
                poi_id=None,
                slot_id=None,
                kind=kind,
                title=task["title"],
                span_start=start_dt,
                span_end=end_dt,
                est_cost_inr=cost,
                supplier_meta={"source_task_id": task_id, "source_message_id": task.get("source_message_id")},
                participant_ids=p_ids,
            )
        except Exception:
            if was_proposed:
                chat_task_repo.update_task(
                    task_id,
                    {"status": "PROPOSED", "confirmed_by_user_id": None, "confirmed_at": None},
                )
            raise
        update_fields["itinerary_id"] = int(target_itin_id)
        update_fields["linked_leg_id"] = int(created_leg["leg_id"])

    updated = chat_task_repo.update_task(task_id, update_fields)
    if updated and updated.get("assigned_to_user_id"):
        chat_task_repo.create_notification(
            user_id=int(updated["assigned_to_user_id"]),
            conversation_id=int(conv["conversation_id"]),
            message_id=updated.get("source_message_id"),
            task_id=task_id,
            kind="TASK_ASSIGNED",
            title=f"Task confirmed: {updated['title']}",
            body=f"Priority: {updated['priority']}" + (" · Scheduled into itinerary" if created_leg else ""),
        )
    chat_task_repo.create_agent_audit(
        conversation_id=int(conv["conversation_id"]),
        trigger_message_id=task.get("source_message_id"),
        agent_mode=conv.get("agent_mode", "ACTIVE"),
        classification="ASSIGNMENT",
        summary=f"Task '{task['title']}' confirmed" + (" and added to trip itinerary." if created_leg else "."),
        action_taken="TASK_CONFIRMED_AND_SCHEDULED" if created_leg else "TASK_CONFIRMED",
        authorized_by_user_id=actor_user_id,
    )
    return {"task": updated, "created_leg": created_leg}
