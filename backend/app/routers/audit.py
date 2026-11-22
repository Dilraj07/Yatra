from fastapi import APIRouter

from app.repositories import audit_repo

router = APIRouter(prefix="/api/audit", tags=["Audit Log & NoSQL Inspector"])


@router.get("/postgres-log")
def get_audit_log(limit: int = 40):
    return audit_repo.list_audit_log(limit)


@router.get("/nosql-documents")
def get_nosql_documents(limit: int = 20):
    return audit_repo.list_nosql_documents(limit)


@router.get("/system-status")
def get_system_status():
    return audit_repo.get_system_status()
