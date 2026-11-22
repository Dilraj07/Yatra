from typing import Any

from app.core.exceptions import DomainError, NotFoundError
from app.repositories import inventory_repo
from app.schemas.inventory import HoldCreate, PoiCreate, SlotCreate


def create_poi(payload: PoiCreate) -> dict[str, Any]:
    return inventory_repo.create_poi(
        supplier_id=payload.supplier_id,
        name=payload.name.strip(),
        city=payload.city.strip(),
        lat=payload.lat,
        lon=payload.lon,
        capacity_managed=payload.capacity_managed,
        description=payload.description.strip(),
    )


def create_slot(payload: SlotCreate) -> dict[str, Any]:
    if payload.window_end <= payload.window_start:
        raise DomainError("window_end must be after window_start")
    return inventory_repo.create_slot(
        poi_id=payload.poi_id,
        circuit=payload.circuit.strip(),
        window_start=payload.window_start,
        window_end=payload.window_end,
        capacity_total=payload.capacity_total,
        price_inr=payload.price_inr,
    )


def create_hold(payload: HoldCreate) -> dict[str, Any]:
    return inventory_repo.create_hold(payload.slot_id, payload.seats, payload.leg_id)


def release_hold(hold_id: int) -> dict[str, Any]:
    row = inventory_repo.release_hold(hold_id)
    if not row:
        raise NotFoundError(f"Slot hold {hold_id} not found")
    return row
