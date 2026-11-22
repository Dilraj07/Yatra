from fastapi import APIRouter, Depends

from app.core.security import get_current_user
from app.repositories import itinerary_repo
from app.schemas.itinerary import AIDraftRequest, ItineraryCreate, LegCreate, ParticipantAdd
from app.services import ai_planner, itinerary_service

router = APIRouter(prefix="/api/itineraries", tags=["3.0 Itinerary Planning & AI Agent"])


@router.get("/trip/{trip_id}")
def list_trip_itineraries(trip_id: int):
    return itinerary_repo.list_trip_itineraries(trip_id)


@router.post("", status_code=201)
def create_itinerary(payload: ItineraryCreate, _user: dict = Depends(get_current_user)):
    return itinerary_service.create_itinerary(payload)


@router.post("/{itinerary_id}/legs", status_code=201)
def add_leg(itinerary_id: int, payload: LegCreate, _user: dict = Depends(get_current_user)):
    return itinerary_service.add_leg(itinerary_id, payload)


@router.post("/legs/{leg_id}/participants", status_code=201)
def add_leg_participant(leg_id: int, payload: ParticipantAdd, _user: dict = Depends(get_current_user)):
    return itinerary_service.add_participant(leg_id, payload)


@router.post("/ai-draft", status_code=201)
def ai_draft_itinerary(payload: AIDraftRequest, current_user: dict = Depends(get_current_user)):
    return ai_planner.draft_itinerary_with_self_correction(
        trip_id=payload.trip_id,
        user_id=int(current_user["sub"]),
        prompt=payload.prompt,
        inject_overlap_test=payload.inject_overlap_test,
    )
