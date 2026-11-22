from fastapi import APIRouter, Depends

from app.core.security import get_current_user
from app.schemas.saga import SagaRunRequest
from app.services import saga_engine

router = APIRouter(prefix="/api/saga", tags=["5.0 Booking Saga (Level 2 DFD)"])


@router.post("/execute")
def run_saga(payload: SagaRunRequest, current_user: dict = Depends(get_current_user)):
    return saga_engine.execute_booking_saga(
        itinerary_id=payload.itinerary_id,
        payer_user_id=int(current_user["sub"]),
        simulate_failure_at=payload.simulate_failure_at,
    )


@router.get("/trip/{trip_id}")
def list_trip_sagas(trip_id: int):
    return saga_engine.list_trip_sagas(trip_id)
