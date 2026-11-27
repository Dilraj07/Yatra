import json
from datetime import datetime, timezone
from typing import Any, Optional

from app.core.db import get_pg_conn


def _json_dumps(value: Any) -> str:
    return json.dumps(value, default=str)


def create_task(
    *,
    conversation_id: int,
    title: str,
    description: str = "",
    source_message_id: Optional[int] = None,
    trip_id: Optional[int] = None,
    itinerary_id: Optional[int] = None,
    linked_leg_id: Optional[int] = None,
    linked_proposal_id: Optional[int] = None,
    assigned_to_user_id: Optional[int] = None,
    assigned_to_agent: bool = False,
    created_by_user_id: Optional[int] = None,
    proposed_by_agent: bool = False,
    priority: str = "MEDIUM",
    status: str = "PROPOSED",
    due_at: Optional[datetime] = None,
    schedule_start: Optional[datetime] = None,
    schedule_end: Optional[datetime] = None,
    leg_kind: Optional[str] = None,
    est_cost_inr: float = 0.0,
    dependencies: list[int] | None = None,
    reminder_at: Optional[datetime] = None,
    confirmed_by_user_id: Optional[int] = None,
) -> dict[str, Any]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO chat_task (
                    conversation_id, source_message_id, trip_id, itinerary_id, linked_leg_id,
                    linked_proposal_id, title, description, assigned_to_user_id, assigned_to_agent,
                    created_by_user_id, proposed_by_agent, priority, status, due_at,
                    schedule_start, schedule_end, leg_kind, est_cost_inr, dependencies_json,
                    reminder_at, confirmed_by_user_id, confirmed_at
                )
                VALUES (
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s::jsonb,
                    %s, %s, %s
                )
                RETURNING task_id
                """,
                (
                    conversation_id,
                    source_message_id,
                    trip_id,
                    itinerary_id,
                    linked_leg_id,
                    linked_proposal_id,
                    title.strip(),
                    description.strip(),
                    assigned_to_user_id,
                    assigned_to_agent,
                    created_by_user_id,
                    proposed_by_agent,
                    priority,
                    status,
                    due_at,
                    schedule_start,
                    schedule_end,
                    leg_kind,
                    est_cost_inr,
                    _json_dumps(dependencies or []),
                    reminder_at,
                    confirmed_by_user_id,
                    datetime.now(timezone.utc) if confirmed_by_user_id is not None else None,
                ),
            )
            tid = cur.fetchone()["task_id"]
            conn.commit()
            return get_task(tid) or {}


def get_task(task_id: int) -> dict[str, Any] | None:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT t.*,
                       au.full_name AS assignee_name,
                       cu.full_name AS creator_name,
                       cf.full_name AS confirmed_by_name,
                       m.body AS source_message_body,
                       m.sender_name AS source_message_sender,
                       il.title AS linked_leg_title
                FROM chat_task t
                LEFT JOIN app_user au ON au.user_id = t.assigned_to_user_id
                LEFT JOIN app_user cu ON cu.user_id = t.created_by_user_id
                LEFT JOIN app_user cf ON cf.user_id = t.confirmed_by_user_id
                LEFT JOIN chat_message m ON m.message_id = t.source_message_id
                LEFT JOIN itinerary_leg il ON il.leg_id = t.linked_leg_id
                WHERE t.task_id = %s
                """,
                (task_id,),
            )
            return cur.fetchone()


def list_tasks(
    conversation_id: Optional[int] = None,
    *,
    trip_id: Optional[int] = None,
    status: Optional[str] = None,
) -> list[dict[str, Any]]:
    conds = ["1=1"]
    params: list[Any] = []
    if conversation_id is not None:
        conds.append("t.conversation_id = %s")
        params.append(conversation_id)
    if trip_id is not None:
        conds.append("t.trip_id = %s")
        params.append(trip_id)
    if status is not None:
        conds.append("t.status = %s")
        params.append(status)

    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT t.*,
                       au.full_name AS assignee_name,
                       cu.full_name AS creator_name,
                       cf.full_name AS confirmed_by_name,
                       m.body AS source_message_body,
                       m.sender_name AS source_message_sender,
                       il.title AS linked_leg_title
                FROM chat_task t
                LEFT JOIN app_user au ON au.user_id = t.assigned_to_user_id
                LEFT JOIN app_user cu ON cu.user_id = t.created_by_user_id
                LEFT JOIN app_user cf ON cf.user_id = t.confirmed_by_user_id
                LEFT JOIN chat_message m ON m.message_id = t.source_message_id
                LEFT JOIN itinerary_leg il ON il.leg_id = t.linked_leg_id
                WHERE {' AND '.join(conds)}
                ORDER BY CASE t.status WHEN 'PROPOSED' THEN 1 WHEN 'BLOCKED' THEN 2 WHEN 'IN_PROGRESS' THEN 3 WHEN 'TODO' THEN 4 ELSE 5 END,
                         t.created_at DESC
                """,
                tuple(params),
            )
            return cur.fetchall()


def update_task(task_id: int, fields: dict[str, Any]) -> dict[str, Any] | None:
    allowed = {
        "title",
        "description",
        "assigned_to_user_id",
        "assigned_to_agent",
        "priority",
        "status",
        "due_at",
        "schedule_start",
        "schedule_end",
        "leg_kind",
        "est_cost_inr",
        "reminder_at",
        "itinerary_id",
        "linked_leg_id",
        "linked_proposal_id",
        "confirmed_by_user_id",
        "confirmed_at",
    }
    sets: list[str] = []
    params: list[Any] = []
    for k, v in fields.items():
        if k == "dependencies":
            sets.append("dependencies_json = %s::jsonb")
            params.append(_json_dumps(v))
        elif k in allowed:
            sets.append(f"{k} = %s")
            params.append(v)

    if not sets:
        return get_task(task_id)

    sets.append("updated_at = NOW()")
    params.append(task_id)
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE chat_task SET {', '.join(sets)} WHERE task_id = %s", tuple(params))
            conn.commit()
    return get_task(task_id)


def claim_task_decision(task_id: int, actor_user_id: int, target_status: str) -> dict[str, Any] | None:
    """Atomically transition a PROPOSED task so concurrent approvals cannot double-schedule."""
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE chat_task
                   SET status = %s,
                       confirmed_by_user_id = %s,
                       confirmed_at = NOW(),
                       updated_at = NOW()
                 WHERE task_id = %s AND status = 'PROPOSED'
                RETURNING task_id
                """,
                (target_status, actor_user_id, task_id),
            )
            claimed = cur.fetchone()
            conn.commit()
            if not claimed:
                return None
    return get_task(task_id)


def create_agent_audit(
    *,
    conversation_id: int,
    trigger_message_id: Optional[int],
    agent_mode: str,
    classification: str,
    summary: str,
    recommendations: list[dict[str, Any]] | None = None,
    action_taken: str = "LOGGED",
    authorized_by_user_id: Optional[int] = None,
) -> dict[str, Any]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO chat_agent_audit
                    (conversation_id, trigger_message_id, agent_mode, classification, summary,
                     recommendations_json, action_taken, authorized_by_user_id)
                VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s)
                RETURNING *
                """,
                (
                    conversation_id,
                    trigger_message_id,
                    agent_mode,
                    classification,
                    summary,
                    _json_dumps(recommendations or []),
                    action_taken,
                    authorized_by_user_id,
                ),
            )
            row = cur.fetchone()
            conn.commit()
            return row


def list_agent_audit(conversation_id: int, limit: int = 50) -> list[dict[str, Any]]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT a.*, u.full_name AS authorized_by_name, m.body AS trigger_body
                FROM chat_agent_audit a
                LEFT JOIN app_user u ON u.user_id = a.authorized_by_user_id
                LEFT JOIN chat_message m ON m.message_id = a.trigger_message_id
                WHERE a.conversation_id = %s
                ORDER BY a.created_at DESC
                LIMIT %s
                """,
                (conversation_id, limit),
            )
            return cur.fetchall()


def create_notification(
    *,
    user_id: int,
    kind: str,
    title: str,
    body: str,
    conversation_id: Optional[int] = None,
    message_id: Optional[int] = None,
    task_id: Optional[int] = None,
) -> dict[str, Any]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO chat_notification (user_id, conversation_id, message_id, task_id, kind, title, body)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING *
                """,
                (user_id, conversation_id, message_id, task_id, kind, title, body),
            )
            row = cur.fetchone()
            conn.commit()
            return row


def list_notifications(user_id: int, limit: int = 40) -> list[dict[str, Any]]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT n.*, c.title AS conversation_title
                FROM chat_notification n
                LEFT JOIN chat_conversation c ON c.conversation_id = n.conversation_id
                WHERE n.user_id = %s
                ORDER BY n.is_read ASC, n.created_at DESC
                LIMIT %s
                """,
                (user_id, limit),
            )
            return cur.fetchall()


def mark_notification_read(notification_id: int, user_id: int) -> None:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE chat_notification SET is_read = TRUE WHERE notification_id = %s AND user_id = %s",
                (notification_id, user_id),
            )
            conn.commit()


def mark_all_notifications_read(user_id: int) -> None:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE chat_notification SET is_read = TRUE WHERE user_id = %s AND is_read = FALSE", (user_id,))
            conn.commit()
