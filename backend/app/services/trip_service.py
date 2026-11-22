from typing import Any

from app.core.exceptions import DomainError, NotFoundError
from app.repositories import trip_repo
from app.schemas.trip import ConstraintAdd, MemberAdd, TripCreate


def create_trip(organizer_id: int, payload: TripCreate) -> dict[str, Any]:
    if payload.end_date < payload.start_date:
        raise DomainError("end_date must be on or after start_date")
    return trip_repo.create_trip_with_organizer(
        organizer_id=organizer_id,
        title=payload.title.strip(),
        start_date=payload.start_date,
        end_date=payload.end_date,
        quorum_pct=payload.quorum_pct,
        budget_ceiling=payload.organizer_budget_ceiling,
        joining_city=payload.organizer_joining_city.strip(),
    )


def get_trip(trip_id: int) -> dict[str, Any]:
    detail = trip_repo.get_trip_detail(trip_id)
    if not detail:
        raise NotFoundError(f"Trip {trip_id} not found")
    return detail


def add_member(trip_id: int, payload: MemberAdd) -> dict[str, Any]:
    return trip_repo.add_member(
        trip_id=trip_id,
        user_id=payload.user_id,
        role=payload.role,
        budget_ceiling=payload.budget_ceiling,
        joining_city=payload.joining_city.strip(),
    )


def add_constraint(trip_id: int, payload: ConstraintAdd) -> dict[str, Any]:
    return trip_repo.add_constraint(
        trip_id=trip_id,
        user_id=payload.user_id,
        kind=payload.kind,
        value=payload.value,
        is_hard=payload.is_hard,
    )
