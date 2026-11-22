from typing import Literal, Optional

from pydantic import BaseModel, Field


class ProposalCreate(BaseModel):
    trip_id: int = Field(gt=0)
    itinerary_id: int = Field(gt=0)


class VoteCast(BaseModel):
    choice: Literal["APPROVE", "REJECT", "ABSTAIN"]
    user_id: Optional[int] = None
