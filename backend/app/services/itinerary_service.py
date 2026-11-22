from typing import Any

from app.core.exceptions import DomainError
from app.repositories import itinerary_repo
from app.schemas.itinerary import ItineraryCreate, LegCreate, ParticipantAdd


def create_itinerary(payload: ItineraryCreate) -> dict[str, Any]:
    return itinerary_repo.create_itinerary(payload.trip_id, payload.summary.strip())


def add_leg(itinerary_id: int, payload: LegCreate) -> dict[str, Any]:
    if payload.span_end <= payload.span_start:
        raise DomainError("span_end must be after span_start")
    return itinerary_repo.add_leg_with_participants(
        itinerary_id=itinerary_id,
        poi_id=payload.poi_id,
        slot_id=payload.slot_id,
        kind=payload.kind,
        title=payload.title.strip(),
        span_start=payload.span_start,
        span_end=payload.span_end,
        est_cost_inr=payload.est_cost_inr,
        supplier_meta=payload.supplier_meta,
        participant_ids=payload.participant_ids,
    )


def add_participant(leg_id: int, payload: ParticipantAdd) -> dict[str, Any]:
    return itinerary_repo.add_leg_participant(leg_id, payload.user_id)
