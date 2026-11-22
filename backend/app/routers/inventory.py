from fastapi import APIRouter, Depends

from app.core.security import get_current_user
from app.repositories import inventory_repo
from app.schemas.inventory import HoldCreate, PoiCreate, SlotCreate
from app.services import inventory_service

router = APIRouter(prefix="/api/inventory", tags=["2.0 Site Operator & Capacity Slots"])


@router.get("/suppliers")
def list_suppliers():
    return inventory_repo.list_suppliers()


@router.get("/pois")
def list_pois():
    return inventory_repo.list_pois()


@router.post("/pois", status_code=201)
def create_poi(payload: PoiCreate, _user: dict = Depends(get_current_user)):
    return inventory_service.create_poi(payload)


@router.get("/slots")
def list_slots():
    return inventory_repo.list_slots()


@router.post("/slots", status_code=201)
def create_slot(payload: SlotCreate, _user: dict = Depends(get_current_user)):
    return inventory_service.create_slot(payload)


@router.get("/holds")
def list_holds():
    return inventory_repo.list_holds()


@router.post("/holds", status_code=201)
def create_hold(payload: HoldCreate, _user: dict = Depends(get_current_user)):
    return inventory_service.create_hold(payload)


@router.post("/holds/{hold_id}/release")
def release_hold(hold_id: int, _user: dict = Depends(get_current_user)):
    return inventory_service.release_hold(hold_id)


@router.post("/holds/expire-stale")
def expire_stale_holds(_user: dict = Depends(get_current_user)):
    ids = inventory_repo.expire_stale_holds()
    return {"expired_count": len(ids), "expired_ids": ids}
