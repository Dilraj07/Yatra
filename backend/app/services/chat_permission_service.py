from typing import Any
from fastapi import HTTPException, status

ROLE_RANK = {
    "MEMBER": 1,
    "MODERATOR": 2,
    "ADMIN": 3,
    "OWNER": 4,
}


def get_role_rank(role: str | None) -> int:
    return ROLE_RANK.get((role or "MEMBER").upper(), 1)


def require_membership(member: dict[str, Any] | None) -> dict[str, Any]:
    if not member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this conversation.",
        )
    return member


def require_can_send(member: dict[str, Any] | None) -> dict[str, Any]:
    m = require_membership(member)
    if not m.get("can_send", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your role does not have permission to send messages in this group.",
        )
    return m


def require_can_manage_members(member: dict[str, Any] | None) -> dict[str, Any]:
    m = require_membership(member)
    if get_role_rank(m.get("role")) < ROLE_RANK["ADMIN"] and not m.get("can_manage_members"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only group Owners or Admins can manage group members and settings.",
        )
    return m


def require_can_moderate(member: dict[str, Any] | None) -> dict[str, Any]:
    m = require_membership(member)
    if get_role_rank(m.get("role")) < ROLE_RANK["MODERATOR"] and not m.get("can_manage_members"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Owners, Admins, or Moderators can perform moderation actions.",
        )
    return m


def require_can_configure_agent(member: dict[str, Any] | None) -> dict[str, Any]:
    m = require_membership(member)
    if get_role_rank(m.get("role")) < ROLE_RANK["ADMIN"] and not m.get("can_configure_agent"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only group Owners or Admins can configure AI Agent monitoring or authorize agent actions.",
        )
    return m


def require_can_edit_message(member: dict[str, Any] | None, message: dict[str, Any], user_id: int) -> None:
    require_membership(member)
    if message.get("is_deleted"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Deleted messages cannot be edited.")
    if message.get("sender_type") != "USER" or int(message.get("sender_id") or 0) != int(user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only edit your own messages.",
        )


def require_can_delete_message(member: dict[str, Any] | None, message: dict[str, Any], user_id: int) -> None:
    m = require_membership(member)
    is_author = message.get("sender_type") == "USER" and int(message.get("sender_id") or 0) == int(user_id)
    is_moderator = get_role_rank(m.get("role")) >= ROLE_RANK["MODERATOR"]
    if not (is_author or is_moderator):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the message author or a group Moderator/Admin/Owner can delete this message.",
        )


def validate_target_role_change(
    actor_member: dict[str, Any],
    target_member: dict[str, Any],
    new_role: str | None = None,
) -> None:
    actor_rank = get_role_rank(actor_member.get("role"))
    target_rank = get_role_rank(target_member.get("role"))
    if target_member.get("role") == "OWNER":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The group Owner cannot be demoted or removed.",
        )
    if actor_rank < ROLE_RANK["ADMIN"] and not actor_member.get("can_manage_members"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions to modify member roles.",
        )
    if actor_rank <= target_rank and actor_member.get("role") != "OWNER":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the Owner can modify another Admin's role or membership.",
        )
    if new_role == "OWNER":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use ownership transfer to assign OWNER role.",
        )
