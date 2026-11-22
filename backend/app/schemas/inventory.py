from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class PoiCreate(BaseModel):
    supplier_id: Optional[int] = None
    name: str = Field(min_length=2, max_length=160)
    city: str = Field(min_length=2, max_length=80)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    capacity_managed: bool = True
    description: str = ""


class SlotCreate(BaseModel):
    poi_id: int = Field(gt=0)
    circuit: str = Field(min_length=2, max_length=120)
    window_start: datetime
    window_end: datetime
    capacity_total: int = Field(gt=0)
    price_inr: float = Field(ge=0)


class HoldCreate(BaseModel):
    slot_id: int = Field(gt=0)
    seats: int = Field(gt=0)
    leg_id: Optional[int] = None
