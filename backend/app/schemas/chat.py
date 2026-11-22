from typing import Any, Optional
from pydantic import BaseModel, Field


class ChatMessageIn(BaseModel):
    text: str = Field(..., min_length=1)
    sender_name: Optional[str] = None
    sender_id: Optional[int] = None


class ChatAnalyzeRequest(BaseModel):
    custom_instruction: Optional[str] = None

