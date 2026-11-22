from fastapi import APIRouter, Depends

from app.core.security import get_current_user
from app.schemas.voting import ProposalCreate, VoteCast
from app.services import voting_service

router = APIRouter(prefix="/api/voting", tags=["4.0 Proposals & Quorum Voting"])


@router.get("/trip/{trip_id}")
def list_proposals(trip_id: int):
    return voting_service.list_proposals(trip_id)


@router.post("/proposals", status_code=201)
def create_proposal(payload: ProposalCreate, current_user: dict = Depends(get_current_user)):
    return voting_service.create_proposal(int(current_user["sub"]), payload)


@router.post("/proposals/{proposal_id}/vote")
def cast_vote(proposal_id: int, payload: VoteCast, current_user: dict = Depends(get_current_user)):
    return voting_service.cast_vote(proposal_id, int(current_user["sub"]), payload)


@router.post("/itineraries/{itinerary_id}/approve")
def approve_itinerary(itinerary_id: int, _user: dict = Depends(get_current_user)):
    return voting_service.approve_itinerary(itinerary_id)
