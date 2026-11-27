import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from app.core.db import get_pg_conn


def _json_dumps(value: Any) -> str:
    return json.dumps(value, default=str)


def update_user_last_seen(user_id: int) -> None:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE app_user SET last_seen_at = NOW() WHERE user_id = %s", (user_id,))
            conn.commit()


def list_user_conversations(user_id: int) -> list[dict[str, Any]]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    c.*,
                    cm.role AS my_role,
                    cm.can_send,
                    cm.can_manage_members,
                    cm.can_configure_agent,
                    cm.last_read_message_id,
                    cm.muted,
                    (SELECT COUNT(*) FROM chat_member m2 WHERE m2.conversation_id = c.conversation_id) AS member_count,
                    (SELECT COUNT(*) FROM chat_task ct
                      WHERE ct.conversation_id = c.conversation_id
                        AND ct.status IN ('PROPOSED', 'TODO', 'IN_PROGRESS', 'BLOCKED')) AS open_task_count,
                    (SELECT COUNT(*) FROM chat_message msg
                      WHERE msg.conversation_id = c.conversation_id
                        AND msg.is_deleted = FALSE
                        AND (msg.sender_id IS NULL OR msg.sender_id <> %s)
                        AND msg.message_id > COALESCE(cm.last_read_message_id, 0)) AS unread_count,
                    lm.message_id AS last_message_id,
                    lm.body AS last_message_body,
                    lm.sender_name AS last_message_sender,
                    lm.sender_type AS last_message_sender_type,
                    lm.created_at AS last_message_at,
                    CASE WHEN c.kind = 'DIRECT' THEN (
                        SELECT u.full_name FROM chat_member om
                        JOIN app_user u ON u.user_id = om.user_id
                        WHERE om.conversation_id = c.conversation_id AND om.user_id <> %s
                        LIMIT 1
                    ) ELSE c.title END AS display_title
                FROM chat_conversation c
                JOIN chat_member cm ON cm.conversation_id = c.conversation_id AND cm.user_id = %s
                LEFT JOIN LATERAL (
                    SELECT m.message_id, m.body, m.sender_name, m.sender_type, m.created_at
                    FROM chat_message m
                    WHERE m.conversation_id = c.conversation_id AND m.is_deleted = FALSE
                    ORDER BY m.message_id DESC
                    LIMIT 1
                ) lm ON TRUE
                ORDER BY COALESCE(lm.created_at, c.updated_at, c.created_at) DESC, c.conversation_id ASC
                """,
                (user_id, user_id, user_id),
            )
            return cur.fetchall()


def get_conversation(conversation_id: int) -> dict[str, Any] | None:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM chat_conversation WHERE conversation_id = %s", (conversation_id,))
            return cur.fetchone()


def get_trip_conversation(trip_id: int) -> dict[str, Any] | None:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM chat_conversation WHERE trip_id = %s AND kind = 'TRIP_GROUP'",
                (trip_id,),
            )
            conv = cur.fetchone()
            if conv:
                return conv
            # Ensure conversation exists if trip was just created
            cur.execute("SELECT trip_id, title, organizer_id FROM trip WHERE trip_id = %s", (trip_id,))
            trip = cur.fetchone()
            if not trip:
                return None
            cur.execute(
                "INSERT INTO chat_conversation (trip_id, kind, title, description, created_by) "
                "VALUES (%s, 'TRIP_GROUP', %s, 'Trip collaboration group & AI operations channel', %s) "
                "ON CONFLICT DO NOTHING RETURNING *",
                (trip["trip_id"], trip["title"], trip["organizer_id"]),
            )
            row = cur.fetchone()
            cur.execute(
                "INSERT INTO chat_member (conversation_id, user_id, role, can_send, can_manage_members, can_configure_agent) "
                "SELECT c.conversation_id, tm.user_id, CASE WHEN tm.role = 'ORGANIZER' THEN 'OWNER' ELSE 'MEMBER' END, "
                "TRUE, tm.role = 'ORGANIZER', tm.role = 'ORGANIZER' "
                "FROM trip_member tm JOIN chat_conversation c ON c.trip_id = tm.trip_id AND c.kind = 'TRIP_GROUP' "
                "WHERE tm.trip_id = %s ON CONFLICT DO NOTHING",
                (trip_id,),
            )
            conn.commit()
            if row:
                return row
            cur.execute("SELECT * FROM chat_conversation WHERE trip_id = %s AND kind = 'TRIP_GROUP'", (trip_id,))
            return cur.fetchone()


def create_group_conversation(
    *,
    creator_id: int,
    title: str,
    description: str = "",
    avatar_url: str = "",
    trip_id: Optional[int] = None,
    member_ids: list[int] | None = None,
    agent_enabled: bool = True,
    agent_mode: str = "ACTIVE",
) -> dict[str, Any]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO chat_conversation
                    (trip_id, kind, title, description, avatar_url, created_by, agent_enabled, agent_mode)
                VALUES (%s, 'GROUP', %s, %s, %s, %s, %s, %s)
                RETURNING *
                """,
                (trip_id, title.strip(), description.strip(), avatar_url.strip(), creator_id, agent_enabled, agent_mode),
            )
            conv = cur.fetchone()
            cid = conv["conversation_id"]
            cur.execute(
                """
                INSERT INTO chat_member
                    (conversation_id, user_id, role, can_send, can_manage_members, can_configure_agent)
                VALUES (%s, %s, 'OWNER', TRUE, TRUE, TRUE)
                """,
                (cid, creator_id),
            )
            for uid in set(member_ids or []):
                if int(uid) != int(creator_id):
                    cur.execute(
                        "INSERT INTO chat_member (conversation_id, user_id, role) VALUES (%s, %s, 'MEMBER') ON CONFLICT DO NOTHING",
                        (cid, int(uid)),
                    )
            cur.execute(
                "INSERT INTO chat_membership_event (conversation_id, actor_user_id, event_type, details) "
                "VALUES (%s, %s, 'GROUP_CREATED', %s::jsonb)",
                (cid, creator_id, _json_dumps({"title": conv["title"]})),
            )
            cur.execute(
                "INSERT INTO chat_message (conversation_id, sender_id, sender_name, sender_type, message_type, body) "
                "VALUES (%s, NULL, 'System', 'SYSTEM', 'SYSTEM', %s)",
                (cid, f"Group '{conv['title']}' created."),
            )
            conn.commit()
            return conv


def get_or_create_direct_conversation(user_a: int, user_b: int) -> dict[str, Any]:
    low, high = sorted((int(user_a), int(user_b)))
    pair_key = f"direct:{low}:{high}"
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM chat_conversation WHERE direct_pair_key = %s", (pair_key,))
            existing = cur.fetchone()
            if existing:
                return existing
            cur.execute("SELECT user_id, full_name FROM app_user WHERE user_id IN (%s, %s)", (low, high))
            users = {r["user_id"]: r["full_name"] for r in cur.fetchall()}
            title = f"{users.get(low, 'User')} & {users.get(high, 'User')}"
            cur.execute(
                """
                INSERT INTO chat_conversation (kind, direct_pair_key, title, description, created_by, agent_enabled, agent_mode)
                VALUES ('DIRECT', %s, %s, 'Direct conversation', %s, TRUE, 'OBSERVE')
                ON CONFLICT (direct_pair_key) DO UPDATE SET updated_at = NOW()
                RETURNING *
                """,
                (pair_key, title, user_a),
            )
            conv = cur.fetchone()
            cid = conv["conversation_id"]
            for uid in (low, high):
                cur.execute(
                    "INSERT INTO chat_member (conversation_id, user_id, role, can_send, can_configure_agent) "
                    "VALUES (%s, %s, 'MEMBER', TRUE, TRUE) ON CONFLICT DO NOTHING",
                    (cid, uid),
                )
            conn.commit()
            return conv


def update_conversation(
    conversation_id: int,
    actor_user_id: int,
    *,
    title: Optional[str] = None,
    description: Optional[str] = None,
    avatar_url: Optional[str] = None,
    retention_days: Optional[int] = None,
) -> dict[str, Any]:
    fields: list[str] = []
    params: list[Any] = []
    changes: dict[str, Any] = {}
    if title is not None:
        fields.append("title = %s")
        params.append(title.strip())
        changes["title"] = title.strip()
    if description is not None:
        fields.append("description = %s")
        params.append(description.strip())
        changes["description"] = description.strip()
    if avatar_url is not None:
        fields.append("avatar_url = %s")
        params.append(avatar_url.strip())
        changes["avatar_url"] = avatar_url.strip()
    if retention_days is not None:
        fields.append("retention_days = %s")
        params.append(retention_days)
        changes["retention_days"] = retention_days

    if not fields:
        return get_conversation(conversation_id) or {}

    fields.append("updated_at = NOW()")
    params.append(conversation_id)
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE chat_conversation SET {', '.join(fields)} WHERE conversation_id = %s RETURNING *",
                tuple(params),
            )
            updated = cur.fetchone()
            cur.execute(
                "INSERT INTO chat_membership_event (conversation_id, actor_user_id, event_type, details) "
                "VALUES (%s, %s, 'GROUP_UPDATED', %s::jsonb)",
                (conversation_id, actor_user_id, _json_dumps(changes)),
            )
            conn.commit()
            return updated


def update_agent_config(
    conversation_id: int,
    actor_user_id: int,
    agent_enabled: bool,
    agent_mode: str,
) -> dict[str, Any]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE chat_conversation
                   SET agent_enabled = %s, agent_mode = %s, updated_at = NOW()
                 WHERE conversation_id = %s
                RETURNING *
                """,
                (agent_enabled, agent_mode, conversation_id),
            )
            conv = cur.fetchone()
            cur.execute(
                "INSERT INTO chat_membership_event (conversation_id, actor_user_id, event_type, details) "
                "VALUES (%s, %s, 'AGENT_CONFIG_UPDATED', %s::jsonb)",
                (conversation_id, actor_user_id, _json_dumps({"agent_enabled": agent_enabled, "agent_mode": agent_mode})),
            )
            conn.commit()
            return conv


def list_members(conversation_id: int) -> list[dict[str, Any]]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT cm.*, u.full_name, u.email, u.home_city, u.avatar_url, u.last_seen_at
                FROM chat_member cm
                JOIN app_user u ON u.user_id = cm.user_id
                WHERE cm.conversation_id = %s
                ORDER BY CASE cm.role WHEN 'OWNER' THEN 1 WHEN 'ADMIN' THEN 2 WHEN 'MODERATOR' THEN 3 ELSE 4 END, cm.joined_at ASC
                """,
                (conversation_id,),
            )
            return cur.fetchall()


def get_member(conversation_id: int, user_id: int) -> dict[str, Any] | None:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT cm.*, u.full_name, u.email
                FROM chat_member cm
                JOIN app_user u ON u.user_id = cm.user_id
                WHERE cm.conversation_id = %s AND cm.user_id = %s
                """,
                (conversation_id, user_id),
            )
            return cur.fetchone()


def get_member_user_ids(conversation_id: int) -> list[int]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT user_id FROM chat_member WHERE conversation_id = %s", (conversation_id,))
            return [int(r["user_id"]) for r in cur.fetchall()]


def add_member(conversation_id: int, user_id: int, role: str, actor_user_id: int) -> dict[str, Any]:
    can_manage = role in ("OWNER", "ADMIN")
    can_agent = role in ("OWNER", "ADMIN")
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT trip_id, kind FROM chat_conversation WHERE conversation_id = %s", (conversation_id,))
            conv = cur.fetchone()
            cur.execute(
                """
                INSERT INTO chat_member (conversation_id, user_id, role, can_send, can_manage_members, can_configure_agent)
                VALUES (%s, %s, %s, TRUE, %s, %s)
                ON CONFLICT (conversation_id, user_id) DO UPDATE
                    SET role = EXCLUDED.role,
                        can_manage_members = EXCLUDED.can_manage_members,
                        can_configure_agent = EXCLUDED.can_configure_agent
                RETURNING *
                """,
                (conversation_id, user_id, role, can_manage, can_agent),
            )
            member = cur.fetchone()
            if conv and conv["kind"] == "TRIP_GROUP" and conv["trip_id"]:
                cur.execute("SELECT home_city FROM app_user WHERE user_id = %s", (user_id,))
                u = cur.fetchone()
                cur.execute(
                    "INSERT INTO trip_member (trip_id, user_id, role, budget_ceiling, joining_city) "
                    "VALUES (%s, %s, 'MEMBER', 25000.00, %s) ON CONFLICT DO NOTHING",
                    (conv["trip_id"], user_id, (u or {}).get("home_city") or "Bengaluru"),
                )
            cur.execute("SELECT full_name FROM app_user WHERE user_id = %s", (user_id,))
            target = cur.fetchone()
            cur.execute(
                "INSERT INTO chat_membership_event (conversation_id, actor_user_id, target_user_id, event_type, details) "
                "VALUES (%s, %s, %s, 'MEMBER_ADDED', %s::jsonb)",
                (conversation_id, actor_user_id, user_id, _json_dumps({"role": role})),
            )
            cur.execute(
                "INSERT INTO chat_message (conversation_id, sender_id, sender_name, sender_type, message_type, body) "
                "VALUES (%s, NULL, 'System', 'SYSTEM', 'SYSTEM', %s)",
                (conversation_id, f"{(target or {}).get('full_name', 'Member')} joined as {role.title()}."),
            )
            conn.commit()
            return get_member(conversation_id, user_id) or member


def update_member_role(
    conversation_id: int,
    target_user_id: int,
    actor_user_id: int,
    *,
    role: Optional[str] = None,
    can_send: Optional[bool] = None,
    can_manage_members: Optional[bool] = None,
    can_configure_agent: Optional[bool] = None,
    muted: Optional[bool] = None,
) -> dict[str, Any]:
    updates: list[str] = []
    params: list[Any] = []
    details: dict[str, Any] = {}
    if role is not None:
        updates.append("role = %s")
        params.append(role)
        details["role"] = role
        if can_manage_members is None:
            can_manage_members = role == "ADMIN"
        if can_configure_agent is None:
            can_configure_agent = role == "ADMIN"
    if can_send is not None:
        updates.append("can_send = %s")
        params.append(can_send)
        details["can_send"] = can_send
    if can_manage_members is not None:
        updates.append("can_manage_members = %s")
        params.append(can_manage_members)
        details["can_manage_members"] = can_manage_members
    if can_configure_agent is not None:
        updates.append("can_configure_agent = %s")
        params.append(can_configure_agent)
        details["can_configure_agent"] = can_configure_agent
    if muted is not None:
        updates.append("muted = %s")
        params.append(muted)
        details["muted"] = muted

    if not updates:
        return get_member(conversation_id, target_user_id) or {}

    params.extend([conversation_id, target_user_id])
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE chat_member SET {', '.join(updates)} WHERE conversation_id = %s AND user_id = %s",
                tuple(params),
            )
            cur.execute(
                "INSERT INTO chat_membership_event (conversation_id, actor_user_id, target_user_id, event_type, details) "
                "VALUES (%s, %s, %s, 'ROLE_CHANGED', %s::jsonb)",
                (conversation_id, actor_user_id, target_user_id, _json_dumps(details)),
            )
            conn.commit()
    return get_member(conversation_id, target_user_id) or {}


def remove_member(conversation_id: int, target_user_id: int, actor_user_id: int) -> None:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT trip_id, kind FROM chat_conversation WHERE conversation_id = %s", (conversation_id,))
            conv = cur.fetchone()
            cur.execute("SELECT full_name FROM app_user WHERE user_id = %s", (target_user_id,))
            target = cur.fetchone()
            cur.execute("DELETE FROM chat_member WHERE conversation_id = %s AND user_id = %s", (conversation_id, target_user_id))
            if conv and conv["kind"] == "TRIP_GROUP" and conv["trip_id"]:
                cur.execute("DELETE FROM trip_member WHERE trip_id = %s AND user_id = %s", (conv["trip_id"], target_user_id))
            event_type = "MEMBER_LEFT" if int(actor_user_id) == int(target_user_id) else "MEMBER_REMOVED"
            cur.execute(
                "INSERT INTO chat_membership_event (conversation_id, actor_user_id, target_user_id, event_type, details) "
                "VALUES (%s, %s, %s, %s, '{}'::jsonb)",
                (conversation_id, actor_user_id, target_user_id, event_type),
            )
            cur.execute(
                "INSERT INTO chat_message (conversation_id, sender_id, sender_name, sender_type, message_type, body) "
                "VALUES (%s, NULL, 'System', 'SYSTEM', 'SYSTEM', %s)",
                (conversation_id, f"{(target or {}).get('full_name', 'Member')} left the group."),
            )
            conn.commit()


def list_membership_events(conversation_id: int, limit: int = 50) -> list[dict[str, Any]]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT e.*, a.full_name AS actor_name, t.full_name AS target_name
                FROM chat_membership_event e
                LEFT JOIN app_user a ON a.user_id = e.actor_user_id
                LEFT JOIN app_user t ON t.user_id = e.target_user_id
                WHERE e.conversation_id = %s
                ORDER BY e.created_at DESC
                LIMIT %s
                """,
                (conversation_id, limit),
            )
            return cur.fetchall()


# -----------------------------------------------------------------------------
# Invitations
# -----------------------------------------------------------------------------
def create_invitation(
    conversation_id: int,
    invited_by: int,
    *,
    invited_user_id: Optional[int] = None,
    role: str = "MEMBER",
    max_uses: int = 1,
    expires_hours: int = 72,
) -> dict[str, Any]:
    code = f"YATRA-{secrets.token_hex(4).upper()}"
    expires_at = datetime.now(timezone.utc) + timedelta(hours=expires_hours)
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO chat_invitation
                    (conversation_id, invited_by, invited_user_id, invite_code, role, status, max_uses, expires_at)
                VALUES (%s, %s, %s, %s, %s, 'PENDING', %s, %s)
                RETURNING *
                """,
                (conversation_id, invited_by, invited_user_id, code, role, max_uses, expires_at),
            )
            inv = cur.fetchone()
            cur.execute(
                "INSERT INTO chat_membership_event (conversation_id, actor_user_id, target_user_id, event_type, details) "
                "VALUES (%s, %s, %s, 'INVITE_CREATED', %s::jsonb)",
                (conversation_id, invited_by, invited_user_id, _json_dumps({"invite_code": code, "role": role})),
            )
            conn.commit()
            return inv


def list_conversation_invitations(conversation_id: int) -> list[dict[str, Any]]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT i.*, ib.full_name AS invited_by_name, iu.full_name AS invited_user_name, iu.email AS invited_user_email
                FROM chat_invitation i
                JOIN app_user ib ON ib.user_id = i.invited_by
                LEFT JOIN app_user iu ON iu.user_id = i.invited_user_id
                WHERE i.conversation_id = %s
                ORDER BY i.created_at DESC
                """,
                (conversation_id,),
            )
            return cur.fetchall()


def list_user_invitations(user_id: int) -> list[dict[str, Any]]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT i.*, c.title AS conversation_title, c.description AS conversation_description,
                       ib.full_name AS invited_by_name
                FROM chat_invitation i
                JOIN chat_conversation c ON c.conversation_id = i.conversation_id
                JOIN app_user ib ON ib.user_id = i.invited_by
                WHERE i.invited_user_id = %s AND i.status = 'PENDING'
                  AND (i.expires_at IS NULL OR i.expires_at > NOW())
                ORDER BY i.created_at DESC
                """,
                (user_id,),
            )
            return cur.fetchall()


def get_invitation(invitation_id: int) -> dict[str, Any] | None:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM chat_invitation WHERE invitation_id = %s", (invitation_id,))
            return cur.fetchone()


def get_invitation_by_code(invite_code: str) -> dict[str, Any] | None:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM chat_invitation WHERE invite_code = %s", (invite_code.strip(),))
            return cur.fetchone()


def respond_invitation(invitation_id: int, user_id: int, action: str) -> dict[str, Any]:
    new_status = "ACCEPTED" if action == "ACCEPT" else "REJECTED"
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM chat_invitation WHERE invitation_id = %s FOR UPDATE", (invitation_id,))
            inv = cur.fetchone()
            if not inv:
                raise ValueError("Invitation not found")
            if inv["status"] != "PENDING":
                raise ValueError(f"Invitation is already {inv['status']}")
            if inv["expires_at"] and inv["expires_at"] < datetime.now(timezone.utc):
                cur.execute("UPDATE chat_invitation SET status = 'EXPIRED' WHERE invitation_id = %s", (invitation_id,))
                conn.commit()
                raise ValueError("Invitation has expired")
            if inv["invited_user_id"] is not None and int(inv["invited_user_id"]) != int(user_id):
                raise PermissionError("This invitation is addressed to another user.")

            cur.execute(
                """
                UPDATE chat_invitation
                   SET status = CASE WHEN max_uses = 1 OR %s = 'REJECTED' OR (uses_count + 1) >= max_uses THEN %s ELSE status END,
                       uses_count = uses_count + CASE WHEN %s = 'ACCEPTED' THEN 1 ELSE 0 END,
                       responded_by = %s,
                       responded_at = NOW()
                 WHERE invitation_id = %s
                   AND status = 'PENDING'
                   AND (%s = 'REJECTED' OR uses_count < max_uses)
                RETURNING *
                """,
                (new_status, new_status, new_status, user_id, invitation_id, new_status),
            )
            updated = cur.fetchone()
            if not updated:
                raise ValueError("Invitation was already used or is no longer active.")

            ev_type = "INVITE_ACCEPTED" if action == "ACCEPT" else "INVITE_REJECTED"
            cur.execute(
                "INSERT INTO chat_membership_event (conversation_id, actor_user_id, target_user_id, event_type, details) "
                "VALUES (%s, %s, %s, %s, %s::jsonb)",
                (inv["conversation_id"], user_id, user_id, ev_type, _json_dumps({"invitation_id": invitation_id})),
            )
            if action == "ACCEPT":
                role = inv["role"]
                can_manage = role in ("OWNER", "ADMIN")
                can_agent = role in ("OWNER", "ADMIN")
                cur.execute(
                    """
                    INSERT INTO chat_member (conversation_id, user_id, role, can_send, can_manage_members, can_configure_agent)
                    VALUES (%s, %s, %s, TRUE, %s, %s)
                    ON CONFLICT (conversation_id, user_id) DO UPDATE
                        SET role = EXCLUDED.role,
                            can_manage_members = EXCLUDED.can_manage_members,
                            can_configure_agent = EXCLUDED.can_configure_agent
                    """,
                    (inv["conversation_id"], user_id, role, can_manage, can_agent),
                )
                cur.execute("SELECT trip_id, kind FROM chat_conversation WHERE conversation_id = %s", (inv["conversation_id"],))
                conv = cur.fetchone()
                if conv and conv.get("trip_id") and conv.get("kind") == "TRIP_GROUP":
                    cur.execute(
                        "INSERT INTO trip_member (trip_id, user_id, role) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                        (conv["trip_id"], user_id, "MEMBER"),
                    )
            conn.commit()
            return updated


def revoke_invitation(invitation_id: int, actor_user_id: int) -> dict[str, Any] | None:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE chat_invitation SET status = 'REVOKED', responded_by = %s, responded_at = NOW() "
                "WHERE invitation_id = %s RETURNING *",
                (actor_user_id, invitation_id),
            )
            row = cur.fetchone()
            conn.commit()
            return row


# -----------------------------------------------------------------------------
# Messages, Threading, Receipts, Pins, Bookmarks & Attachments
# -----------------------------------------------------------------------------
def _enrich_messages(cur, rows: list[dict[str, Any]], viewer_user_id: int) -> list[dict[str, Any]]:
    if not rows:
        return []
    msg_ids = [r["message_id"] for r in rows]

    # Receipt stats per message
    cur.execute(
        """
        SELECT r.message_id,
               COUNT(*) AS recipient_count,
               COUNT(r.delivered_at) AS delivered_count,
               COUNT(r.read_at) AS read_count,
               COALESCE(
                   json_agg(json_build_object('user_id', u.user_id, 'full_name', u.full_name, 'read_at', r.read_at))
                   FILTER (WHERE r.read_at IS NOT NULL),
                   '[]'
               ) AS read_by
        FROM chat_message_receipt r
        JOIN app_user u ON u.user_id = r.user_id
        WHERE r.message_id = ANY(%s)
        GROUP BY r.message_id
        """,
        (msg_ids,),
    )
    receipts_map = {r["message_id"]: r for r in cur.fetchall()}

    # Reply previews
    reply_ids = list({r["reply_to_message_id"] for r in rows if r.get("reply_to_message_id")})
    reply_map: dict[int, dict[str, Any]] = {}
    if reply_ids:
        cur.execute(
            "SELECT message_id, sender_name, sender_type, body, is_deleted FROM chat_message WHERE message_id = ANY(%s)",
            (reply_ids,),
        )
        reply_map = {r["message_id"]: r for r in cur.fetchall()}

    # Pinned & bookmarked flags
    cur.execute("SELECT message_id, pinned_by, pinned_at FROM chat_message_pin WHERE message_id = ANY(%s)", (msg_ids,))
    pin_map = {r["message_id"]: r for r in cur.fetchall()}

    cur.execute(
        "SELECT message_id FROM chat_message_bookmark WHERE user_id = %s AND message_id = ANY(%s)",
        (viewer_user_id, msg_ids),
    )
    bookmark_set = {r["message_id"] for r in cur.fetchall()}

    # Thread reply counts
    cur.execute(
        "SELECT thread_root_id, COUNT(*) AS reply_count FROM chat_message "
        "WHERE thread_root_id = ANY(%s) AND is_deleted = FALSE GROUP BY thread_root_id",
        (msg_ids,),
    )
    thread_counts = {r["thread_root_id"]: r["reply_count"] for r in cur.fetchall()}

    # Linked tasks
    cur.execute(
        "SELECT task_id, source_message_id, title, status, priority, assigned_to_user_id, due_at, linked_leg_id "
        "FROM chat_task WHERE source_message_id = ANY(%s)",
        (msg_ids,),
    )
    tasks_by_msg: dict[int, list[dict[str, Any]]] = {}
    for t in cur.fetchall():
        tasks_by_msg.setdefault(t["source_message_id"], []).append(t)

    for row in rows:
        mid = row["message_id"]
        row["id"] = str(mid)
        row["text"] = "[Message deleted]" if row.get("is_deleted") else row["body"]
        row["is_agent"] = row.get("sender_type") == "AGENT"
        rec = receipts_map.get(mid) or {}
        row["delivery_stats"] = {
            "recipient_count": rec.get("recipient_count", 0),
            "delivered_count": rec.get("delivered_count", 0),
            "read_count": rec.get("read_count", 0),
            "read_by": rec.get("read_by", []),
        }
        rid = row.get("reply_to_message_id")
        if rid and rid in reply_map:
            rep = reply_map[rid]
            row["reply_preview"] = {
                "message_id": rep["message_id"],
                "sender_name": rep["sender_name"],
                "body": "[Message deleted]" if rep["is_deleted"] else rep["body"],
            }
        else:
            row["reply_preview"] = None
        pin = pin_map.get(mid)
        row["is_pinned"] = pin is not None
        row["pinned_at"] = pin["pinned_at"] if pin else None
        row["is_bookmarked"] = mid in bookmark_set
        row["thread_reply_count"] = thread_counts.get(mid, 0)
        row["linked_tasks"] = tasks_by_msg.get(mid, [])
        if row.get("agent_metadata_json") and isinstance(row["agent_metadata_json"], dict):
            if "plan_summary" in row["agent_metadata_json"]:
                row["plan_summary"] = row["agent_metadata_json"]["plan_summary"]
    return rows


def list_messages(
    conversation_id: int,
    viewer_user_id: int,
    *,
    after_id: Optional[int] = None,
    before_id: Optional[int] = None,
    search: Optional[str] = None,
    thread_root_id: Optional[int] = None,
    only_pinned: bool = False,
    only_bookmarked: bool = False,
    limit: int = 100,
) -> list[dict[str, Any]]:
    conds = ["m.conversation_id = %s"]
    params: list[Any] = [conversation_id]
    if after_id is not None:
        conds.append("m.message_id > %s")
        params.append(after_id)
    if before_id is not None:
        conds.append("m.message_id < %s")
        params.append(before_id)
    if search:
        conds.append("(m.body ILIKE %s OR m.sender_name ILIKE %s)")
        like = f"%{search.strip()}%"
        params.extend([like, like])
    if thread_root_id is not None:
        conds.append("(m.thread_root_id = %s OR m.message_id = %s)")
        params.extend([thread_root_id, thread_root_id])
    if only_pinned:
        conds.append("EXISTS (SELECT 1 FROM chat_message_pin p WHERE p.message_id = m.message_id)")
    if only_bookmarked:
        conds.append("EXISTS (SELECT 1 FROM chat_message_bookmark b WHERE b.message_id = m.message_id AND b.user_id = %s)")
        params.append(viewer_user_id)

    params.append(limit)
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT m.* FROM chat_message m
                WHERE {' AND '.join(conds)}
                ORDER BY m.message_id ASC
                LIMIT %s
                """,
                tuple(params),
            )
            rows = cur.fetchall()
            return _enrich_messages(cur, rows, viewer_user_id)


def get_message(message_id: int, viewer_user_id: int = 0) -> dict[str, Any] | None:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM chat_message WHERE message_id = %s", (message_id,))
            row = cur.fetchone()
            if not row:
                return None
            return _enrich_messages(cur, [row], viewer_user_id)[0]


def create_message(
    *,
    conversation_id: int,
    sender_id: Optional[int],
    sender_name: str,
    sender_type: str = "USER",
    message_type: str = "TEXT",
    body: str,
    reply_to_message_id: Optional[int] = None,
    forwarded_from_message_id: Optional[int] = None,
    mentions: list[int] | None = None,
    attachments: list[dict[str, Any]] | None = None,
    agent_metadata: dict[str, Any] | None = None,
    viewer_user_id: int = 0,
) -> dict[str, Any]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            thread_root_id = None
            if reply_to_message_id:
                cur.execute(
                    "SELECT message_id, thread_root_id FROM chat_message WHERE message_id = %s AND conversation_id = %s",
                    (reply_to_message_id, conversation_id),
                )
                parent = cur.fetchone()
                if parent:
                    thread_root_id = parent["thread_root_id"] or parent["message_id"]

            cur.execute(
                """
                INSERT INTO chat_message (
                    conversation_id, sender_id, sender_name, sender_type, message_type,
                    body, reply_to_message_id, thread_root_id, forwarded_from_message_id,
                    mentions_json, attachments_json, agent_metadata_json
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb)
                RETURNING *
                """,
                (
                    conversation_id,
                    sender_id,
                    sender_name,
                    sender_type,
                    message_type,
                    body,
                    reply_to_message_id,
                    thread_root_id,
                    forwarded_from_message_id,
                    _json_dumps(mentions or []),
                    _json_dumps(attachments or []),
                    _json_dumps(agent_metadata or {}),
                ),
            )
            msg = cur.fetchone()
            mid = msg["message_id"]

            # Create delivery receipts for all other members
            cur.execute(
                """
                INSERT INTO chat_message_receipt (message_id, user_id, delivered_at, read_at)
                SELECT %s, cm.user_id, NOW(), CASE WHEN cm.user_id = %s THEN NOW() ELSE NULL END
                FROM chat_member cm
                WHERE cm.conversation_id = %s AND (%s::bigint IS NULL OR cm.user_id <> %s::bigint)
                ON CONFLICT DO NOTHING
                """,
                (mid, sender_id or 0, conversation_id, sender_id, sender_id),
            )
            if sender_id:
                cur.execute(
                    "UPDATE chat_member SET last_read_message_id = GREATEST(COALESCE(last_read_message_id, 0), %s) "
                    "WHERE conversation_id = %s AND user_id = %s",
                    (mid, conversation_id, sender_id),
                )
            cur.execute("UPDATE chat_conversation SET updated_at = NOW() WHERE conversation_id = %s", (conversation_id,))
            conn.commit()
            return _enrich_messages(cur, [msg], viewer_user_id or (sender_id or 0))[0]


def edit_message(message_id: int, new_body: str, viewer_user_id: int) -> dict[str, Any]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE chat_message SET body = %s, is_edited = TRUE, edited_at = NOW() "
                "WHERE message_id = %s RETURNING *",
                (new_body, message_id),
            )
            row = cur.fetchone()
            conn.commit()
            return _enrich_messages(cur, [row], viewer_user_id)[0]


def soft_delete_message(message_id: int, deleted_by: int, viewer_user_id: int) -> dict[str, Any]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE chat_message SET is_deleted = TRUE, deleted_at = NOW(), deleted_by = %s, body = '[Message deleted]' "
                "WHERE message_id = %s RETURNING *",
                (deleted_by, message_id),
            )
            row = cur.fetchone()
            conn.commit()
            return _enrich_messages(cur, [row], viewer_user_id)[0]


def mark_read_up_to(conversation_id: int, user_id: int, up_to_message_id: int) -> list[int]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO chat_message_receipt (message_id, user_id, delivered_at, read_at)
                SELECT m.message_id, %s, NOW(), NOW()
                FROM chat_message m
                WHERE m.conversation_id = %s
                  AND m.message_id <= %s
                  AND (m.sender_id IS NULL OR m.sender_id <> %s)
                ON CONFLICT (message_id, user_id) DO UPDATE
                    SET read_at = COALESCE(chat_message_receipt.read_at, NOW())
                RETURNING message_id
                """,
                (user_id, conversation_id, up_to_message_id, user_id),
            )
            updated_ids = [r["message_id"] for r in cur.fetchall()]
            cur.execute(
                "UPDATE chat_member SET last_read_message_id = GREATEST(COALESCE(last_read_message_id, 0), %s) "
                "WHERE conversation_id = %s AND user_id = %s",
                (up_to_message_id, conversation_id, user_id),
            )
            conn.commit()
            return updated_ids


def set_pin(conversation_id: int, message_id: int, user_id: int, pin: bool) -> bool:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            if pin:
                cur.execute(
                    "INSERT INTO chat_message_pin (conversation_id, message_id, pinned_by) "
                    "VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                    (conversation_id, message_id, user_id),
                )
            else:
                cur.execute(
                    "DELETE FROM chat_message_pin WHERE conversation_id = %s AND message_id = %s",
                    (conversation_id, message_id),
                )
            conn.commit()
            return pin


def toggle_bookmark(user_id: int, message_id: int) -> bool:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM chat_message_bookmark WHERE user_id = %s AND message_id = %s", (user_id, message_id))
            exists = cur.fetchone() is not None
            if exists:
                cur.execute("DELETE FROM chat_message_bookmark WHERE user_id = %s AND message_id = %s", (user_id, message_id))
                conn.commit()
                return False
            cur.execute("INSERT INTO chat_message_bookmark (user_id, message_id) VALUES (%s, %s)", (user_id, message_id))
            conn.commit()
            return True


def create_attachment(
    conversation_id: int,
    uploaded_by: int,
    file_name: str,
    content_type: str,
    size_bytes: int,
    storage_path: str,
) -> dict[str, Any]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO chat_attachment (conversation_id, uploaded_by, file_name, content_type, size_bytes, storage_path)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING *
                """,
                (conversation_id, uploaded_by, file_name, content_type, size_bytes, storage_path),
            )
            row = cur.fetchone()
            conn.commit()
            return row


def get_attachment(attachment_id: int) -> dict[str, Any] | None:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM chat_attachment WHERE attachment_id = %s", (attachment_id,))
            return cur.fetchone()
