from typing import Literal, Optional

from pydantic import BaseModel, Field


class SagaRunRequest(BaseModel):
    itinerary_id: int = Field(gt=0)
    simulate_failure_at: Optional[Literal["FLIGHT", "HOTEL", "PAYMENT"]] = None
