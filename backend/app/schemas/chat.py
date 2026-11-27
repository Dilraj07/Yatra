from datetime import datetime
from typing import Any, Literal, Optional
from pydantic import BaseModel, Field


class ChatMessageIn(BaseModel):
    text: str = Field(..., min_length=1)
    sender_name: Optional[str] = None
    sender_id: Optional[int] = None
    reply_to_message_id: Optional[int] = None
    mentions: list[int] = Field(default_factory=list)
    attachments: list[dict[str, Any]] = Field(default_factory=list)


class ChatAnalyzeRequest(BaseModel):
    custom_instruction: Optional[str] = None


class ConversationCreate(BaseModel):
    kind: Literal["GROUP", "DIRECT"] = "GROUP"
    title: Optional[str] = Field(default=None, max_length=160)
    description: str = Field(default="", max_length=500)
    avatar_url: str = Field(default="", max_length=500)
    trip_id: Optional[int] = Field(default=None, gt=0)
    member_ids: list[int] = Field(default_factory=list)
    target_user_id: Optional[int] = Field(default=None, gt=0)
    agent_enabled: bool = True
    agent_mode: Literal["ACTIVE", "OBSERVE", "OFF"] = "ACTIVE"


class ConversationUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=160)
    description: Optional[str] = Field(default=None, max_length=500)
    avatar_url: Optional[str] = Field(default=None, max_length=500)
    retention_days: Optional[int] = Field(default=None, ge=1, le=3650)


class AgentConfigUpdate(BaseModel):
    agent_enabled: bool = True
    agent_mode: Literal["ACTIVE", "OBSERVE", "OFF"] = "ACTIVE"


class ChatMemberAdd(BaseModel):
    user_id: int = Field(gt=0)
    role: Literal["ADMIN", "MODERATOR", "MEMBER"] = "MEMBER"


class ChatMemberRoleUpdate(BaseModel):
    role: Optional[Literal["ADMIN", "MODERATOR", "MEMBER"]] = None
    can_send: Optional[bool] = None
    can_manage_members: Optional[bool] = None
    can_configure_agent: Optional[bool] = None
    muted: Optional[bool] = None


class InvitationCreate(BaseModel):
    invited_user_id: Optional[int] = Field(default=None, gt=0)
    role: Literal["ADMIN", "MODERATOR", "MEMBER"] = "MEMBER"
    max_uses: int = Field(default=1, ge=1, le=100)
    expires_hours: int = Field(default=72, ge=1, le=720)


class InvitationRespond(BaseModel):
    action: Literal["ACCEPT", "REJECT"]


class MessageCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=8000)
    reply_to_message_id: Optional[int] = Field(default=None, gt=0)
    forwarded_from_message_id: Optional[int] = Field(default=None, gt=0)
    mentions: list[int] = Field(default_factory=list)
    attachments: list[dict[str, Any]] = Field(default_factory=list)
    message_type: Literal["TEXT", "ATTACHMENT"] = "TEXT"


class MessageUpdate(BaseModel):
    body: str = Field(..., min_length=1, max_length=8000)


class ReadReceiptUpdate(BaseModel):
    up_to_message_id: int = Field(gt=0)


class TaskCreate(BaseModel):
    title: str = Field(..., min_length=2, max_length=200)
    description: str = Field(default="", max_length=2000)
    assigned_to_user_id: Optional[int] = Field(default=None, gt=0)
    assigned_to_agent: bool = False
    priority: Literal["LOW", "MEDIUM", "HIGH", "URGENT"] = "MEDIUM"
    due_at: Optional[datetime] = None
    schedule_start: Optional[datetime] = None
    schedule_end: Optional[datetime] = None
    leg_kind: Optional[Literal["FLIGHT", "HOTEL", "ATTRACTION", "TRANSFER", "ACTIVITY"]] = None
    est_cost_inr: float = Field(default=0.0, ge=0)
    dependencies: list[int] = Field(default_factory=list)
    reminder_at: Optional[datetime] = None
    source_message_id: Optional[int] = Field(default=None, gt=0)
    itinerary_id: Optional[int] = Field(default=None, gt=0)
    linked_proposal_id: Optional[int] = Field(default=None, gt=0)


class TaskUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=2, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    assigned_to_user_id: Optional[int] = Field(default=None, gt=0)
    assigned_to_agent: Optional[bool] = None
    priority: Optional[Literal["LOW", "MEDIUM", "HIGH", "URGENT"]] = None
    status: Optional[Literal["PROPOSED", "TODO", "IN_PROGRESS", "BLOCKED", "DONE", "REJECTED"]] = None
    due_at: Optional[datetime] = None
    schedule_start: Optional[datetime] = None
    schedule_end: Optional[datetime] = None
    leg_kind: Optional[Literal["FLIGHT", "HOTEL", "ATTRACTION", "TRANSFER", "ACTIVITY"]] = None
    est_cost_inr: Optional[float] = Field(default=None, ge=0)
    dependencies: Optional[list[int]] = None
    reminder_at: Optional[datetime] = None


class TaskAuthorizeRequest(BaseModel):
    action: Literal["CONFIRM", "REJECT"]
    schedule_into_itinerary: bool = False
    itinerary_id: Optional[int] = Field(default=None, gt=0)
    assigned_to_user_id: Optional[int] = Field(default=None, gt=0)
    schedule_start: Optional[datetime] = None
    schedule_end: Optional[datetime] = None
    leg_kind: Optional[Literal["FLIGHT", "HOTEL", "ATTRACTION", "TRANSFER", "ACTIVITY"]] = None
    est_cost_inr: Optional[float] = Field(default=None, ge=0)
