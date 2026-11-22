from fastapi import APIRouter, Depends

from app.core.security import get_current_user
from app.schemas.expense import ExpenseCreate
from app.services import expense_service

router = APIRouter(prefix="/api/expenses", tags=["6.0 Expenses & Double-Entry Ledger"])


@router.get("/trip/{trip_id}")
def get_trip_finances(trip_id: int):
    return expense_service.get_trip_finances(trip_id)


@router.post("", status_code=201)
def record_expense(payload: ExpenseCreate, _user: dict = Depends(get_current_user)):
    return expense_service.record_expense(payload)
