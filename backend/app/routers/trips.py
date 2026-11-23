from fastapi import APIRouter, Depends

from app.core.security import bearer_scheme, decode_access_token, get_current_user
from app.repositories import trip_repo
from app.schemas.trip import ConstraintAdd, MemberAdd, TripCreate
from app.services import trip_service

router = APIRouter(prefix="/api/trips", tags=["1.0 Trips & Members"])


def _get_optional_user(token_header):
    if not token_header:
        return None
    try:
        return decode_access_token(token_header.credentials)
    except Exception:
        return None


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
def add_member(trip_id: int, payload: MemberAdd, token_creds=Depends(bearer_scheme)):
    return trip_service.add_member(trip_id, payload)


@router.delete("/{trip_id}/members/{user_id}")
def remove_member(trip_id: int, user_id: int, token_creds=Depends(bearer_scheme)):
    return trip_service.remove_member(trip_id, user_id)


@router.post("/{trip_id}/constraints", status_code=201)
def add_constraint(trip_id: int, payload: ConstraintAdd, token_creds=Depends(bearer_scheme)):
    return trip_service.add_constraint(trip_id, payload)

