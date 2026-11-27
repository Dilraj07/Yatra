import asyncio
import logging
import os
import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import (
    APIRouter,
    Body,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.db import get_pg_conn
from app.core.exceptions import ConflictError, DomainError, NotFoundError
from app.core.security import decode_access_token, get_current_user
from app.repositories import chat_repo, chat_task_repo, itinerary_repo
from app.schemas.chat import (
    AgentConfigUpdate,
    ChatAnalyzeRequest,
    ChatMemberAdd,
    ChatMemberRoleUpdate,
    ChatMessageIn,
    ConversationCreate,
    ConversationUpdate,
    InvitationCreate,
    InvitationRespond,
    MessageCreate,
    MessageUpdate,
    ReadReceiptUpdate,
    TaskAuthorizeRequest,
    TaskCreate,
    TaskUpdate,
)
from app.services import chat_agent_service, chat_permission_service
from app.services.realtime_manager import realtime_manager

logger = logging.getLogger("yatra.chat_router")

router = APIRouter(prefix="/api/chat", tags=["chat"])
optional_bearer = HTTPBearer(auto_error=False)

UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads" / "chat"
MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024


def _uid(current_user: dict[str, Any]) -> int:
    return int(current_user.get("user_id") or current_user.get("sub"))


def _uname(current_user: dict[str, Any], member: dict[str, Any] | None = None) -> str:
    return (
        current_user.get("full_name")
        or current_user.get("name")
        or (member.get("full_name") if member else None)
        or "Traveler"
    )


def _require_conversation(conversation_id: int) -> dict[str, Any]:
    conv = chat_repo.get_conversation(conversation_id)
    if not conv:
        raise NotFoundError("Conversation not found.")
    return conv


def _broadcast_members(conversation_id: int, event_type: str, payload: dict[str, Any]) -> None:
    member_ids = chat_repo.get_member_user_ids(conversation_id)
    realtime_manager.broadcast_to_users_sync(member_ids, event_type, payload)


def _generate_agent_monitoring_response(trip_id: int, user_text: str, sender_name: str) -> Optional[str]:
    """
    Backwards-compatible active copilot helper tested by test_all_features.py and legacy /trip routes.
    Queries PostgreSQL itineraries and trip budgets instead of MongoDB.
    """
    lower = (user_text or "").lower()
    triggers = (
        "@copilot",
        "@agent",
        "agent",
        "budget",
        "cost",
        "ticket",
        "asi",
        "monument",
        "heritage",
        "hampi",
        "plan",
        "itinerary",
        "schedule",
        "task",
        "assign",
        "book",
        "hotel",
        "flight",
        "split",
        "expense",
        "cancel",
        "reschedule",
        "approve",
        "summary",
        "summarize",
        "?",
    )
    if not any(tok in lower for tok in triggers):
        return None

    try:
        itins = itinerary_repo.list_trip_itineraries(trip_id)
    except Exception:
        itins = []

    active = itins[0] if itins else None
    leg_count = len(active.get("legs") or []) if active else 0
    lines = ["**Yatra Copilot Active Monitor**"]

    if any(k in lower for k in ("budget", "cost", "price", "ceiling")):
        ceilings: list[float] = []
        try:
            with get_pg_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT budget_ceiling FROM trip_member WHERE trip_id = %s AND budget_ceiling IS NOT NULL",
                        (trip_id,),
                    )
                    ceilings = [float(r["budget_ceiling"]) for r in cur.fetchall()]
        except Exception:
            pass
        if ceilings:
            lines.append(
                f"- Group **budget** ceiling for Trip #{trip_id}: INR {min(ceilings):,.0f} to INR {max(ceilings):,.0f} per person across {len(ceilings)} members."
            )
        else:
            lines.append(f"- Noted **budget** question from **{sender_name}** for Trip #{trip_id}.")
    elif any(k in lower for k in ("ticket", "asi", "monument", "heritage", "hampi", "slot")):
        lines.append(
            f"- Heritage & Monument **ticket** check requested by **{sender_name}**: open Heritage Tickets (or ask to schedule a timed slot) for Trip #{trip_id}."
        )
    elif any(k in lower for k in ("assign", "task", "schedule", "plan", "book", "reschedule", "cancel")):
        lines.append(
            f"- Detected operational action request from **{sender_name}**: prepared structured task proposal for Trip #{trip_id}."
        )
    elif any(k in lower for k in ("summary", "summarize")):
        lines.append(f"- Active monitor ready for Trip #{trip_id} ({leg_count} scheduled itinerary legs).")
    else:
        lines.append(f"- Noted message from **{sender_name}** in Trip #{trip_id} context.")

    if active:
        lines.append(
            f"- Current Itinerary **#{active['itinerary_id']}** ({active['status']}): {leg_count} legs synced in PostgreSQL."
        )
    else:
        lines.append(f"- No active itinerary legs yet for Trip #{trip_id}. Open Itinerary Planner or confirm a scheduled task to add one.")
    return "\n".join(lines)


def _send_and_process_message(
    *,
    conversation: dict[str, Any],
    sender_user_id: int,
    sender_name: str,
    body: str,
    message_type: str = "TEXT",
    reply_to_message_id: Optional[int] = None,
    forwarded_from_message_id: Optional[int] = None,
    mentions: list[int] | None = None,
    attachments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    conv_id = int(conversation["conversation_id"])
    clean_mentions = [int(x) for x in (mentions or []) if x]

    if forwarded_from_message_id:
        src = chat_repo.get_message(forwarded_from_message_id, sender_user_id)
        if not src:
            raise NotFoundError("Source message to forward was not found.")
        src_member = chat_repo.get_member(int(src["conversation_id"]), sender_user_id)
        chat_permission_service.require_membership(src_member)

    if reply_to_message_id:
        parent = chat_repo.get_message(reply_to_message_id, sender_user_id)
        if not parent or int(parent["conversation_id"]) != conv_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Replied-to message must belong to the same conversation.",
            )

    msg = chat_repo.create_message(
        conversation_id=conv_id,
        sender_id=sender_user_id,
        sender_name=sender_name,
        sender_type="USER",
        message_type=message_type,
        body=body.strip(),
        reply_to_message_id=reply_to_message_id,
        forwarded_from_message_id=forwarded_from_message_id,
        mentions=clean_mentions,
        attachments=attachments or [],
        viewer_user_id=sender_user_id,
    )

    member_ids = chat_repo.get_member_user_ids(conv_id)
    realtime_manager.broadcast_to_users_sync(member_ids, "message_new", {"conversation_id": conv_id, "message": msg})

    for mentioned_uid in clean_mentions:
        if mentioned_uid != sender_user_id and mentioned_uid in member_ids:
            notif = chat_task_repo.create_notification(
                user_id=mentioned_uid,
                conversation_id=conv_id,
                message_id=int(msg["message_id"]),
                kind="MENTION",
                title=f"{sender_name} mentioned you in {conversation['title']}",
                body=msg["body"][:160],
            )
            realtime_manager.broadcast_to_users_sync([mentioned_uid], "notification_new", {"notification": notif})

    agent_res = chat_agent_service.process_incoming_message(
        conversation=conversation,
        message=msg,
        sender_user_id=sender_user_id,
        sender_name=sender_name,
    )
    if agent_res.get("proposed_task"):
        pt = agent_res["proposed_task"]
        realtime_manager.broadcast_to_users_sync(
            member_ids,
            "task_new",
            {"conversation_id": conv_id, "task": pt},
        )
        if pt.get("assigned_to_user_id") and int(pt["assigned_to_user_id"]) != sender_user_id:
            realtime_manager.broadcast_to_users_sync(
                [int(pt["assigned_to_user_id"])],
                "notification_refresh",
                {"conversation_id": conv_id, "task_id": pt["task_id"]},
            )
    if agent_res.get("agent_message"):
        realtime_manager.broadcast_to_users_sync(
            member_ids,
            "message_new",
            {"conversation_id": conv_id, "message": agent_res["agent_message"]},
        )

    return {
        "message": msg,
        "agent_message": agent_res.get("agent_message"),
        "proposed_task": agent_res.get("proposed_task"),
        "audit": agent_res.get("audit"),
    }


# ---------------------------------------------------------------------------
# Conversations & Group Creation / Settings
# ---------------------------------------------------------------------------


@router.get("/conversations")
def list_conversations(current_user: dict[str, Any] = Depends(get_current_user)):
    uid = _uid(current_user)
    chat_repo.update_user_last_seen(uid)
    return {
        "conversations": chat_repo.list_user_conversations(uid),
        "online_user_ids": realtime_manager.get_online_user_ids(),
    }


@router.post("/conversations", status_code=status.HTTP_201_CREATED)
def create_conversation(payload: ConversationCreate, current_user: dict[str, Any] = Depends(get_current_user)):
    uid = _uid(current_user)
    if payload.kind == "DIRECT":
        if not payload.target_user_id or int(payload.target_user_id) == uid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Direct conversations require a valid target_user_id different from yourself.",
            )
        conv = chat_repo.get_or_create_direct_conversation(uid, int(payload.target_user_id))
    else:
        title = (payload.title or "").strip()
        if not title:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Group title is required.")
        conv = chat_repo.create_group_conversation(
            creator_id=uid,
            title=title,
            description=payload.description,
            avatar_url=payload.avatar_url,
            trip_id=payload.trip_id,
            member_ids=payload.member_ids,
            agent_enabled=payload.agent_enabled,
            agent_mode=payload.agent_mode,
        )

    member_ids = chat_repo.get_member_user_ids(int(conv["conversation_id"]))
    realtime_manager.broadcast_to_users_sync(
        member_ids,
        "conversation_updated",
        {"conversation_id": conv["conversation_id"]},
    )
    return {
        "conversation": conv,
        "members": chat_repo.list_members(int(conv["conversation_id"])),
    }


@router.get("/conversations/{conversation_id}")
def get_conversation_detail(conversation_id: int, current_user: dict[str, Any] = Depends(get_current_user)):
    uid = _uid(current_user)
    conv = _require_conversation(conversation_id)
    member = chat_repo.get_member(conversation_id, uid)
    chat_permission_service.require_membership(member)
    return {
        "conversation": conv,
        "my_membership": member,
        "members": chat_repo.list_members(conversation_id),
        "online_user_ids": realtime_manager.get_online_user_ids(),
    }


@router.patch("/conversations/{conversation_id}")
def update_conversation(
    conversation_id: int,
    payload: ConversationUpdate,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    uid = _uid(current_user)
    conv = _require_conversation(conversation_id)
    if conv["kind"] == "DIRECT":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Direct messages do not have group settings.")
    member = chat_repo.get_member(conversation_id, uid)
    chat_permission_service.require_can_manage_members(member)

    updated = chat_repo.update_conversation(
        conversation_id,
        uid,
        title=payload.title,
        description=payload.description,
        avatar_url=payload.avatar_url,
        retention_days=payload.retention_days,
    )
    _broadcast_members(conversation_id, "conversation_updated", {"conversation_id": conversation_id, "conversation": updated})
    return {"conversation": updated}


@router.patch("/conversations/{conversation_id}/agent")
def configure_agent(
    conversation_id: int,
    payload: AgentConfigUpdate,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    uid = _uid(current_user)
    _require_conversation(conversation_id)
    member = chat_repo.get_member(conversation_id, uid)
    chat_permission_service.require_can_configure_agent(member)

    effective_mode = "OFF" if not payload.agent_enabled else payload.agent_mode
    updated = chat_repo.update_agent_config(conversation_id, uid, payload.agent_enabled, effective_mode)
    audit = chat_task_repo.create_agent_audit(
        conversation_id=conversation_id,
        trigger_message_id=None,
        agent_mode=effective_mode,
        classification="GENERAL",
        summary=f"Agent settings updated by {_uname(current_user, member)}: enabled={payload.agent_enabled}, mode={effective_mode}.",
        action_taken="AGENT_CONFIG_UPDATED",
        authorized_by_user_id=uid,
    )
    _broadcast_members(
        conversation_id,
        "agent_config_updated",
        {"conversation_id": conversation_id, "agent_enabled": payload.agent_enabled, "agent_mode": effective_mode},
    )
    return {"conversation": updated, "audit": audit}


# ---------------------------------------------------------------------------
# Members, Roles & Membership History
# ---------------------------------------------------------------------------


@router.get("/conversations/{conversation_id}/members")
def list_conversation_members(conversation_id: int, current_user: dict[str, Any] = Depends(get_current_user)):
    uid = _uid(current_user)
    _require_conversation(conversation_id)
    chat_permission_service.require_membership(chat_repo.get_member(conversation_id, uid))
    return {
        "members": chat_repo.list_members(conversation_id),
        "online_user_ids": realtime_manager.get_online_user_ids(),
    }


@router.post("/conversations/{conversation_id}/members", status_code=status.HTTP_201_CREATED)
def add_conversation_member(
    conversation_id: int,
    payload: ChatMemberAdd,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    uid = _uid(current_user)
    conv = _require_conversation(conversation_id)
    if conv["kind"] == "DIRECT":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot add members to a direct conversation.")
    actor = chat_repo.get_member(conversation_id, uid)
    chat_permission_service.require_can_manage_members(actor)

    added = chat_repo.add_member(conversation_id, payload.user_id, payload.role, uid)
    members = chat_repo.list_members(conversation_id)
    _broadcast_members(conversation_id, "membership_updated", {"conversation_id": conversation_id, "members": members})

    if int(payload.user_id) != uid:
        notif = chat_task_repo.create_notification(
            user_id=int(payload.user_id),
            conversation_id=conversation_id,
            kind="GROUP_ADDED",
            title=f"Added to {conv['title']}",
            body=f"{_uname(current_user, actor)} added you as {payload.role}.",
        )
        realtime_manager.broadcast_to_users_sync([int(payload.user_id)], "notification_new", {"notification": notif})

    return {"member": added, "members": members}


@router.patch("/conversations/{conversation_id}/members/{target_user_id}")
def update_member_role_or_permissions(
    conversation_id: int,
    target_user_id: int,
    payload: ChatMemberRoleUpdate,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    uid = _uid(current_user)
    _require_conversation(conversation_id)
    actor = chat_repo.get_member(conversation_id, uid)
    chat_permission_service.require_can_manage_members(actor)

    target = chat_repo.get_member(conversation_id, target_user_id)
    if not target:
        raise NotFoundError("Target user is not a member of this conversation.")
    chat_permission_service.validate_target_role_change(actor, target, payload.role)

    updated = chat_repo.update_member_role(
        conversation_id,
        target_user_id,
        uid,
        role=payload.role,
        can_send=payload.can_send,
        can_manage_members=payload.can_manage_members,
        can_configure_agent=payload.can_configure_agent,
        muted=payload.muted,
    )
    members = chat_repo.list_members(conversation_id)
    _broadcast_members(conversation_id, "membership_updated", {"conversation_id": conversation_id, "members": members})
    return {"member": updated, "members": members}


@router.delete("/conversations/{conversation_id}/members/{target_user_id}")
def remove_or_leave_member(
    conversation_id: int,
    target_user_id: int,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    uid = _uid(current_user)
    conv = _require_conversation(conversation_id)
    if conv["kind"] == "DIRECT":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot remove members from a direct conversation.")
    actor = chat_repo.get_member(conversation_id, uid)
    target = chat_repo.get_member(conversation_id, target_user_id)
    if not target:
        raise NotFoundError("Target member was not found in this conversation.")

    if int(target_user_id) == uid:
        chat_permission_service.require_membership(actor)
        if actor.get("role") == "OWNER":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Group Owner cannot leave without transferring ownership.",
            )
    else:
        chat_permission_service.require_can_manage_members(actor)
        chat_permission_service.validate_target_role_change(actor, target)

    notify_ids = chat_repo.get_member_user_ids(conversation_id)
    chat_repo.remove_member(conversation_id, target_user_id, uid)
    members = chat_repo.list_members(conversation_id)
    realtime_manager.broadcast_to_users_sync(
        notify_ids,
        "membership_updated",
        {"conversation_id": conversation_id, "removed_user_id": target_user_id, "members": members},
    )
    return {"removed_user_id": target_user_id, "members": members}


@router.get("/conversations/{conversation_id}/history")
def list_membership_history(conversation_id: int, current_user: dict[str, Any] = Depends(get_current_user)):
    uid = _uid(current_user)
    _require_conversation(conversation_id)
    chat_permission_service.require_membership(chat_repo.get_member(conversation_id, uid))
    return {"events": chat_repo.list_membership_events(conversation_id)}


# ---------------------------------------------------------------------------
# Invitations & Invite Codes
# ---------------------------------------------------------------------------


@router.get("/conversations/{conversation_id}/invitations")
def list_group_invitations(conversation_id: int, current_user: dict[str, Any] = Depends(get_current_user)):
    uid = _uid(current_user)
    _require_conversation(conversation_id)
    chat_permission_service.require_can_manage_members(chat_repo.get_member(conversation_id, uid))
    return {"invitations": chat_repo.list_conversation_invitations(conversation_id)}


@router.post("/conversations/{conversation_id}/invitations", status_code=status.HTTP_201_CREATED)
def create_group_invitation(
    conversation_id: int,
    payload: InvitationCreate,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    uid = _uid(current_user)
    conv = _require_conversation(conversation_id)
    if conv["kind"] == "DIRECT":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot invite users into a direct chat.")
    actor = chat_repo.get_member(conversation_id, uid)
    chat_permission_service.require_can_manage_members(actor)

    inv = chat_repo.create_invitation(
        conversation_id,
        uid,
        invited_user_id=payload.invited_user_id,
        role=payload.role,
        max_uses=payload.max_uses,
        expires_hours=payload.expires_hours,
    )
    if payload.invited_user_id and int(payload.invited_user_id) != uid:
        notif = chat_task_repo.create_notification(
            user_id=int(payload.invited_user_id),
            conversation_id=conversation_id,
            kind="GROUP_INVITE",
            title=f"Group invite: {conv['title']}",
            body=f"{_uname(current_user, actor)} invited you to join as {payload.role}. Code: {inv['invite_code']}",
        )
        realtime_manager.broadcast_to_users_sync(
            [int(payload.invited_user_id)],
            "invitation_new",
            {"invitation": inv, "notification": notif},
        )
    return {"invitation": inv}


@router.delete("/conversations/{conversation_id}/invitations/{invitation_id}")
def revoke_group_invitation(
    conversation_id: int,
    invitation_id: int,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    uid = _uid(current_user)
    _require_conversation(conversation_id)
    chat_permission_service.require_can_manage_members(chat_repo.get_member(conversation_id, uid))
    inv = chat_repo.get_invitation(invitation_id)
    if not inv or int(inv["conversation_id"]) != int(conversation_id):
        raise NotFoundError("Invitation not found in this conversation.")
    revoked = chat_repo.revoke_invitation(invitation_id, uid)
    return {"invitation": revoked}


@router.get("/invitations")
def list_my_invitations(current_user: dict[str, Any] = Depends(get_current_user)):
    return {"invitations": chat_repo.list_user_invitations(_uid(current_user))}


@router.post("/invitations/{invitation_id}/respond")
def respond_to_invitation(
    invitation_id: int,
    payload: InvitationRespond,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    uid = _uid(current_user)
    inv = chat_repo.get_invitation(invitation_id)
    if not inv:
        raise NotFoundError("Invitation not found.")
    if inv.get("invited_user_id") and int(inv["invited_user_id"]) != uid:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This invitation belongs to another user.")

    try:
        res = chat_repo.respond_invitation(invitation_id, uid, payload.action)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    if res.get("status") == "ACCEPTED":
        conv_id = int(res["conversation_id"])
        members = chat_repo.list_members(conv_id)
        _broadcast_members(conv_id, "membership_updated", {"conversation_id": conv_id, "members": members})
    return res


@router.post("/invitations/code/{invite_code}/join")
def join_by_invite_code(invite_code: str, current_user: dict[str, Any] = Depends(get_current_user)):
    uid = _uid(current_user)
    inv = chat_repo.get_invitation_by_code(invite_code.strip())
    if not inv:
        raise NotFoundError("Invalid invite code.")
    if inv.get("invited_user_id") and int(inv["invited_user_id"]) != uid:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This invite code is assigned to a different platform user.",
        )

    try:
        res = chat_repo.respond_invitation(int(inv["invitation_id"]), uid, "ACCEPT")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    conv_id = int(res["conversation_id"])
    members = chat_repo.list_members(conv_id)
    _broadcast_members(conv_id, "membership_updated", {"conversation_id": conv_id, "members": members})
    return {**res, "conversation": chat_repo.get_conversation(conv_id), "members": members}


# ---------------------------------------------------------------------------
# Messages, Threading, Receipts, Pins, Bookmarks, Attachments
# ---------------------------------------------------------------------------


@router.get("/conversations/{conversation_id}/messages")
def list_conversation_messages(
    conversation_id: int,
    after_id: Optional[int] = Query(default=None, ge=0),
    before_id: Optional[int] = Query(default=None, gt=0),
    search: Optional[str] = Query(default=None, max_length=200),
    thread_root_id: Optional[int] = Query(default=None, gt=0),
    only_pinned: bool = False,
    only_bookmarked: bool = False,
    limit: int = Query(default=100, ge=1, le=200),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    uid = _uid(current_user)
    conv = _require_conversation(conversation_id)
    member = chat_repo.get_member(conversation_id, uid)
    chat_permission_service.require_membership(member)
    chat_repo.update_user_last_seen(uid)

    msgs = chat_repo.list_messages(
        conversation_id,
        uid,
        after_id=after_id,
        before_id=before_id,
        search=search,
        thread_root_id=thread_root_id,
        only_pinned=only_pinned,
        only_bookmarked=only_bookmarked,
        limit=limit,
    )
    return {
        "conversation": conv,
        "messages": msgs,
        "members": chat_repo.list_members(conversation_id),
    }


@router.post("/conversations/{conversation_id}/messages", status_code=status.HTTP_201_CREATED)
def post_conversation_message(
    conversation_id: int,
    payload: MessageCreate,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    uid = _uid(current_user)
    conv = _require_conversation(conversation_id)
    member = chat_repo.get_member(conversation_id, uid)
    chat_permission_service.require_can_send(member)

    return _send_and_process_message(
        conversation=conv,
        sender_user_id=uid,
        sender_name=_uname(current_user, member),
        body=payload.body,
        message_type=payload.message_type,
        reply_to_message_id=payload.reply_to_message_id,
        forwarded_from_message_id=payload.forwarded_from_message_id,
        mentions=payload.mentions,
        attachments=payload.attachments,
    )


@router.patch("/messages/{message_id}")
def edit_message(
    message_id: int,
    payload: MessageUpdate,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    uid = _uid(current_user)
    msg = chat_repo.get_message(message_id, uid)
    if not msg:
        raise NotFoundError("Message not found.")
    conv_id = int(msg["conversation_id"])
    member = chat_repo.get_member(conv_id, uid)
    chat_permission_service.require_can_edit_message(member, msg, uid)

    updated = chat_repo.edit_message(message_id, payload.body.strip(), uid)
    _broadcast_members(conv_id, "message_updated", {"conversation_id": conv_id, "message": updated})
    return {"message": updated}


@router.delete("/messages/{message_id}")
def delete_message(message_id: int, current_user: dict[str, Any] = Depends(get_current_user)):
    uid = _uid(current_user)
    msg = chat_repo.get_message(message_id, uid)
    if not msg:
        raise NotFoundError("Message not found.")
    conv_id = int(msg["conversation_id"])
    member = chat_repo.get_member(conv_id, uid)
    chat_permission_service.require_can_delete_message(member, msg, uid)

    deleted = chat_repo.soft_delete_message(message_id, uid, uid)
    _broadcast_members(conv_id, "message_deleted", {"conversation_id": conv_id, "message": deleted})
    return {"message": deleted}


@router.post("/conversations/{conversation_id}/read")
def mark_conversation_read(
    conversation_id: int,
    payload: ReadReceiptUpdate,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    uid = _uid(current_user)
    _require_conversation(conversation_id)
    member = chat_repo.get_member(conversation_id, uid)
    chat_permission_service.require_membership(member)

    updated_ids = chat_repo.mark_read_up_to(conversation_id, uid, payload.up_to_message_id)
    _broadcast_members(
        conversation_id,
        "receipt_updated",
        {
            "conversation_id": conversation_id,
            "user_id": uid,
            "full_name": _uname(current_user, member),
            "up_to_message_id": payload.up_to_message_id,
            "message_ids": updated_ids,
        },
    )
    return {"updated_message_ids": updated_ids}


@router.post("/messages/{message_id}/pin")
def pin_or_unpin_message(
    message_id: int,
    pin: Optional[bool] = Query(default=None),
    body: Optional[dict[str, Any]] = Body(default=None),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    uid = _uid(current_user)
    msg = chat_repo.get_message(message_id, uid)
    if not msg:
        raise NotFoundError("Message not found.")
    conv_id = int(msg["conversation_id"])
    member = chat_repo.get_member(conv_id, uid)
    chat_permission_service.require_can_moderate(member)

    if pin is None and isinstance(body, dict) and "pin" in body:
        target_pin = bool(body["pin"])
    elif pin is not None:
        target_pin = pin
    else:
        target_pin = not bool(msg.get("is_pinned"))

    chat_repo.set_pin(conv_id, message_id, uid, target_pin)
    refreshed = chat_repo.get_message(message_id, uid)
    _broadcast_members(
        conv_id,
        "message_pinned",
        {"conversation_id": conv_id, "message_id": message_id, "is_pinned": target_pin, "message": refreshed},
    )
    return {"message_id": message_id, "is_pinned": target_pin, "message": refreshed}


@router.delete("/messages/{message_id}/pin")
def unpin_message(message_id: int, current_user: dict[str, Any] = Depends(get_current_user)):
    uid = _uid(current_user)
    msg = chat_repo.get_message(message_id, uid)
    if not msg:
        raise NotFoundError("Message not found.")
    conv_id = int(msg["conversation_id"])
    member = chat_repo.get_member(conv_id, uid)
    chat_permission_service.require_can_moderate(member)

    chat_repo.set_pin(conv_id, message_id, uid, False)
    refreshed = chat_repo.get_message(message_id, uid)
    _broadcast_members(
        conv_id,
        "message_pinned",
        {"conversation_id": conv_id, "message_id": message_id, "is_pinned": False, "message": refreshed},
    )
    return {"message_id": message_id, "is_pinned": False}


@router.post("/messages/{message_id}/bookmark")
def toggle_message_bookmark(message_id: int, current_user: dict[str, Any] = Depends(get_current_user)):
    uid = _uid(current_user)
    msg = chat_repo.get_message(message_id, uid)
    if not msg:
        raise NotFoundError("Message not found.")
    member = chat_repo.get_member(int(msg["conversation_id"]), uid)
    chat_permission_service.require_membership(member)

    bookmarked = chat_repo.toggle_bookmark(uid, message_id)
    return {"message_id": message_id, "is_bookmarked": bookmarked}


@router.post("/conversations/{conversation_id}/attachments", status_code=status.HTTP_201_CREATED)
async def upload_attachment(
    conversation_id: int,
    file: UploadFile = File(...),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    uid = _uid(current_user)
    _require_conversation(conversation_id)
    member = chat_repo.get_member(conversation_id, uid)
    chat_permission_service.require_can_send(member)

    raw = await file.read()
    if len(raw) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Attachment exceeds 15 MB limit.",
        )

    safe_name = Path(file.filename or "attachment.bin").name or "attachment.bin"
    conv_dir = UPLOAD_ROOT / str(conversation_id)
    conv_dir.mkdir(parents=True, exist_ok=True)
    disk_path = conv_dir / f"{uuid.uuid4().hex}_{safe_name}"
    await asyncio.to_thread(disk_path.write_bytes, raw)

    att = chat_repo.create_attachment(
        conversation_id=conversation_id,
        uploaded_by=uid,
        file_name=safe_name,
        content_type=file.content_type or "application/octet-stream",
        size_bytes=len(raw),
        storage_path=str(disk_path),
    )
    descriptor = {
        "attachment_id": att["attachment_id"],
        "file_name": att["file_name"],
        "content_type": att["content_type"],
        "size_bytes": att["size_bytes"],
        "url": f"/api/chat/attachments/{att['attachment_id']}",
    }
    return {"attachment": descriptor}


@router.get("/attachments/{attachment_id}")
def download_attachment(
    attachment_id: int,
    token: Optional[str] = Query(default=None),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(optional_bearer),
):
    raw_token = credentials.credentials if credentials else token
    user = decode_access_token(raw_token or "")
    uid = _uid(user)

    att = chat_repo.get_attachment(attachment_id)
    if not att:
        raise NotFoundError("Attachment not found.")
    member = chat_repo.get_member(int(att["conversation_id"]), uid)
    chat_permission_service.require_membership(member)

    path = Path(att["storage_path"])
    if not path.is_file():
        raise NotFoundError("Attachment file is no longer available on disk.")
    return FileResponse(path, media_type=att["content_type"], filename=att["file_name"])


# ---------------------------------------------------------------------------
# AI Agent Operations, Audit & Summaries
# ---------------------------------------------------------------------------


@router.post("/conversations/{conversation_id}/agent/summarize")
def summarize_conversation_endpoint(
    conversation_id: int,
    payload: Optional[ChatAnalyzeRequest] = Body(default=None),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    uid = _uid(current_user)
    res = chat_agent_service.summarize_conversation(conversation_id, uid, post_to_chat=True)
    if res.get("message"):
        _broadcast_members(
            conversation_id,
            "message_new",
            {"conversation_id": conversation_id, "message": res["message"]},
        )
    return res


@router.get("/conversations/{conversation_id}/agent/audit")
def list_agent_audit_endpoint(conversation_id: int, current_user: dict[str, Any] = Depends(get_current_user)):
    uid = _uid(current_user)
    _require_conversation(conversation_id)
    chat_permission_service.require_membership(chat_repo.get_member(conversation_id, uid))
    return {"audit": chat_task_repo.list_agent_audit(conversation_id)}


# ---------------------------------------------------------------------------
# Operational Tasks & Planning Integration
# ---------------------------------------------------------------------------


@router.get("/conversations/{conversation_id}/tasks")
def list_conversation_tasks(
    conversation_id: int,
    status_filter: Optional[str] = Query(default=None, alias="status"),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    uid = _uid(current_user)
    _require_conversation(conversation_id)
    chat_permission_service.require_membership(chat_repo.get_member(conversation_id, uid))
    return {"tasks": chat_task_repo.list_tasks(conversation_id, status=status_filter)}


@router.post("/conversations/{conversation_id}/tasks", status_code=status.HTTP_201_CREATED)
def create_conversation_task(
    conversation_id: int,
    payload: TaskCreate,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    uid = _uid(current_user)
    conv = _require_conversation(conversation_id)
    member = chat_repo.get_member(conversation_id, uid)
    chat_permission_service.require_can_send(member)

    task = chat_task_repo.create_task(
        conversation_id=conversation_id,
        title=payload.title.strip(),
        description=payload.description.strip(),
        source_message_id=payload.source_message_id,
        trip_id=conv.get("trip_id"),
        itinerary_id=payload.itinerary_id,
        linked_proposal_id=payload.linked_proposal_id,
        assigned_to_user_id=payload.assigned_to_user_id,
        assigned_to_agent=payload.assigned_to_agent,
        created_by_user_id=uid,
        proposed_by_agent=False,
        priority=payload.priority,
        status="TODO",
        due_at=payload.due_at,
        schedule_start=payload.schedule_start,
        schedule_end=payload.schedule_end,
        leg_kind=payload.leg_kind,
        est_cost_inr=payload.est_cost_inr,
        dependencies=payload.dependencies,
        reminder_at=payload.reminder_at,
        confirmed_by_user_id=uid,
    )
    _broadcast_members(conversation_id, "task_new", {"conversation_id": conversation_id, "task": task})

    if payload.assigned_to_user_id and int(payload.assigned_to_user_id) != uid:
        notif = chat_task_repo.create_notification(
            user_id=int(payload.assigned_to_user_id),
            conversation_id=conversation_id,
            message_id=payload.source_message_id,
            task_id=int(task["task_id"]),
            kind="TASK_ASSIGNED",
            title=f"New task assigned: {task['title']}",
            body=f"Assigned by {_uname(current_user, member)} in {conv['title']}",
        )
        realtime_manager.broadcast_to_users_sync([int(payload.assigned_to_user_id)], "notification_new", {"notification": notif})

    return {"task": task}


@router.patch("/tasks/{task_id}")
def update_task_endpoint(
    task_id: int,
    payload: TaskUpdate,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    uid = _uid(current_user)
    task = chat_task_repo.get_task(task_id)
    if not task:
        raise NotFoundError("Task not found.")
    conv_id = int(task["conversation_id"])
    member = chat_repo.get_member(conv_id, uid)
    chat_permission_service.require_membership(member)

    is_privileged = chat_permission_service.get_role_rank(member.get("role")) >= chat_permission_service.ROLE_RANK["MODERATOR"]
    is_owner_or_assignee = (
        int(task.get("assigned_to_user_id") or 0) == uid
        or int(task.get("created_by_user_id") or 0) == uid
    )
    if not (is_privileged or is_owner_or_assignee):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the task creator, assignee, or Moderator/Admin/Owner can update this task.",
        )

    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        return {"task": task}
    updated = chat_task_repo.update_task(task_id, fields)
    _broadcast_members(conv_id, "task_updated", {"conversation_id": conv_id, "task": updated})
    return {"task": updated}


@router.post("/tasks/{task_id}/authorize")
def authorize_proposed_task(
    task_id: int,
    payload: TaskAuthorizeRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    uid = _uid(current_user)
    try:
        res = chat_agent_service.authorize_and_sync_task(
            task_id=task_id,
            actor_user_id=uid,
            action=payload.action,
            schedule_into_itinerary=payload.schedule_into_itinerary,
            itinerary_id=payload.itinerary_id,
            assigned_to_user_id=payload.assigned_to_user_id,
            schedule_start=payload.schedule_start,
            schedule_end=payload.schedule_end,
            leg_kind=payload.leg_kind,
            est_cost_inr=payload.est_cost_inr,
        )
    except (NotFoundError, ConflictError):
        raise
    except DomainError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=exc.message) from exc

    task = res["task"]
    conv_id = int(task["conversation_id"])
    _broadcast_members(conv_id, "task_updated", {"conversation_id": conv_id, "task": task})
    if res.get("created_leg"):
        conv = chat_repo.get_conversation(conv_id)
        _broadcast_members(
            conv_id,
            "itinerary_updated",
            {
                "conversation_id": conv_id,
                "trip_id": conv.get("trip_id") if conv else None,
                "leg": res["created_leg"],
            },
        )
    return res


# ---------------------------------------------------------------------------
# Notifications Center
# ---------------------------------------------------------------------------


@router.get("/notifications")
def list_my_notifications(current_user: dict[str, Any] = Depends(get_current_user)):
    uid = _uid(current_user)
    notes = chat_task_repo.list_notifications(uid)
    unread = sum(1 for n in notes if not n.get("is_read"))
    return {"notifications": notes, "unread_count": unread}


@router.post("/notifications/{notification_id}/read")
def mark_notification_read_endpoint(notification_id: int, current_user: dict[str, Any] = Depends(get_current_user)):
    chat_task_repo.mark_notification_read(notification_id, _uid(current_user))
    return {"ok": True}


@router.post("/notifications/read-all")
def mark_all_notifications_read_endpoint(current_user: dict[str, Any] = Depends(get_current_user)):
    chat_task_repo.mark_all_notifications_read(_uid(current_user))
    return {"ok": True}


# ---------------------------------------------------------------------------
# Legacy /api/chat/trip/{trip_id}* Compatibility Endpoints (PostgreSQL-backed)
# ---------------------------------------------------------------------------


@router.get("/trip/{trip_id}")
def get_trip_chat_compat(trip_id: int, current_user: dict[str, Any] = Depends(get_current_user)):
    uid = _uid(current_user)
    conv = chat_repo.get_trip_conversation(trip_id)
    if not conv:
        raise NotFoundError(f"No conversation found for trip {trip_id}.")
    conv_id = int(conv["conversation_id"])
    member = chat_repo.get_member(conv_id, uid)
    chat_permission_service.require_membership(member)
    return {
        "trip_id": trip_id,
        "conversation_id": conv_id,
        "conversation": conv,
        "messages": chat_repo.list_messages(conv_id, uid, limit=100),
        "members": chat_repo.list_members(conv_id),
        "tasks": chat_task_repo.list_tasks(conv_id),
    }


@router.post("/trip/{trip_id}/messages", status_code=status.HTTP_201_CREATED)
def post_trip_chat_compat(
    trip_id: int,
    payload: ChatMessageIn,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    uid = _uid(current_user)
    conv = chat_repo.get_trip_conversation(trip_id)
    if not conv:
        raise NotFoundError(f"No conversation found for trip {trip_id}.")
    conv_id = int(conv["conversation_id"])
    member = chat_repo.get_member(conv_id, uid)
    chat_permission_service.require_can_send(member)

    return _send_and_process_message(
        conversation=conv,
        sender_user_id=uid,
        sender_name=payload.sender_name or _uname(current_user, member),
        body=payload.text,
        reply_to_message_id=payload.reply_to_message_id,
        mentions=payload.mentions,
        attachments=payload.attachments,
    )


@router.post("/trip/{trip_id}/analyze")
def analyze_trip_chat_compat(
    trip_id: int,
    payload: Optional[ChatAnalyzeRequest] = Body(default=None),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    uid = _uid(current_user)
    conv = chat_repo.get_trip_conversation(trip_id)
    if not conv:
        raise NotFoundError(f"No conversation found for trip {trip_id}.")
    conv_id = int(conv["conversation_id"])
    res = chat_agent_service.summarize_conversation(conv_id, uid, post_to_chat=True)
    if res.get("message"):
        _broadcast_members(conv_id, "message_new", {"conversation_id": conv_id, "message": res["message"]})
    return res
