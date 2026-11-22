from typing import Literal, Optional

from pydantic import BaseModel, Field


class ExpenseCreate(BaseModel):
    trip_id: int = Field(gt=0)
    payer_id: int = Field(gt=0)
    leg_id: Optional[int] = None
    description: str = Field(min_length=2, max_length=200)
    amount: float = Field(gt=0)
    currency: str = Field(default="INR", min_length=3, max_length=3)
    fx_to_inr: float = Field(default=1.0, gt=0)
    rule: Literal["EQUAL", "EXACT", "SHARES", "PERCENTAGE"] = "EQUAL"
    exact_shares: Optional[dict[int, float]] = None
    test_unbalanced_ledger: bool = False
