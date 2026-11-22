from typing import Any

from app.core.exceptions import NotFoundError
from app.repositories import voting_repo
from app.schemas.voting import ProposalCreate, VoteCast


def list_proposals(trip_id: int) -> list[dict[str, Any]]:
    proposals = voting_repo.list_proposals(trip_id)
    if proposals is None:
        raise NotFoundError(f"Trip {trip_id} not found")
    return proposals


def create_proposal(raised_by: int, payload: ProposalCreate) -> dict[str, Any]:
    return voting_repo.create_proposal(payload.trip_id, payload.itinerary_id, raised_by)


def cast_vote(proposal_id: int, acting_user_id: int, payload: VoteCast) -> dict[str, Any]:
    voter_id = payload.user_id or acting_user_id
    return voting_repo.upsert_vote(proposal_id, voter_id, payload.choice)


def approve_itinerary(itinerary_id: int) -> dict[str, Any]:
    itin = voting_repo.approve_itinerary(itinerary_id)
    if not itin:
        raise NotFoundError(f"Itinerary {itinerary_id} not found")
    return itin
