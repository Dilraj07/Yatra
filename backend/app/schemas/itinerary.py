from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class ItineraryCreate(BaseModel):
    trip_id: int = Field(gt=0)
    summary: str = ""


class LegCreate(BaseModel):
    poi_id: Optional[int] = None
    slot_id: Optional[int] = None
    kind: Literal["FLIGHT", "HOTEL", "ATTRACTION", "TRANSFER", "ACTIVITY"]
    title: str = Field(min_length=2, max_length=180)
    span_start: datetime
    span_end: datetime
    est_cost_inr: float = Field(default=0, ge=0)
    participant_ids: list[int] = Field(default_factory=list)
    supplier_meta: dict[str, Any] = Field(default_factory=dict)


class ParticipantAdd(BaseModel):
    user_id: int = Field(gt=0)


class AIDraftRequest(BaseModel):
    trip_id: int = Field(gt=0)
    prompt: str = Field(min_length=5)
    inject_overlap_test: bool = False
