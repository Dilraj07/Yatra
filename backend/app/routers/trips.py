from fastapi import APIRouter, Depends

from app.core.security import get_current_user
from app.repositories import trip_repo
from app.schemas.trip import ConstraintAdd, MemberAdd, TripCreate
from app.services import trip_service

router = APIRouter(prefix="/api/trips", tags=["1.0 Trips & Members"])


@router.get("")
def list_trips():
    return trip_repo.list_trips()


@router.post("", status_code=201)
def create_trip(payload: TripCreate, current_user: dict = Depends(get_current_user)):
    return trip_service.create_trip(int(current_user["sub"]), payload)


@router.get("/{trip_id}")
def get_trip_detail(trip_id: int):
    return trip_service.get_trip(trip_id)


@router.post("/{trip_id}/members", status_code=201)
def add_member(trip_id: int, payload: MemberAdd, _user: dict = Depends(get_current_user)):
    return trip_service.add_member(trip_id, payload)


@router.post("/{trip_id}/constraints", status_code=201)
def add_constraint(trip_id: int, payload: ConstraintAdd, _user: dict = Depends(get_current_user)):
    return trip_service.add_constraint(trip_id, payload)
