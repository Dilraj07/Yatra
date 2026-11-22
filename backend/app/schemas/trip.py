from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field


class TripCreate(BaseModel):
    title: str = Field(min_length=3, max_length=160)
    start_date: date
    end_date: date
    quorum_pct: int = Field(default=67, ge=1, le=100)
    organizer_budget_ceiling: float = Field(default=15000.0, ge=0)
    organizer_joining_city: str = Field(default="Bengaluru", min_length=2)


class MemberAdd(BaseModel):
    user_id: int = Field(gt=0)
    role: Literal["ORGANIZER", "MEMBER"] = "MEMBER"
    budget_ceiling: float = Field(ge=0)
    joining_city: str = Field(min_length=2)


class ConstraintAdd(BaseModel):
    user_id: int = Field(gt=0)
    kind: Literal["DIET", "MOBILITY", "DEPARTURE_TIME", "PACE", "BUDGET", "OTHER"]
    value: dict[str, Any]
    is_hard: bool = True
