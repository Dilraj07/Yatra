from typing import Any

import psycopg
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse


class DomainError(Exception):
    def __init__(self, message: str, status_code: int = 400, error_code: str = "DOMAIN_ERROR"):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.error_code = error_code


class NotFoundError(DomainError):
    def __init__(self, message: str):
        super().__init__(message, status_code=404, error_code="NOT_FOUND")


class ConflictError(DomainError):
    def __init__(self, message: str):
        super().__init__(message, status_code=409, error_code="CONFLICT")


class UnauthorizedError(DomainError):
    def __init__(self, message: str):
        super().__init__(message, status_code=401, error_code="UNAUTHORIZED")


PG_RULE_MAP: dict[str, tuple[str, int, str]] = {
    "P0001": ("QUORUM_NOT_MET", 409, "Rule #1 (Deferred Quorum Trigger)"),
    "P0002": ("LEDGER_UNBALANCED", 422, "Rule #3 (Deferred Zero-Sum Ledger Trigger)"),
    "23514": ("CAPACITY_OR_CHECK_VIOLATION", 409, "Rule #2 (No Overselling CHECK Constraint)"),
    "23P01": ("EXCLUSION_OVERLAP_VIOLATION", 409, "Rule #4 (GiST Exclusion Overlap Constraint)"),
    "23505": ("UNIQUE_VIOLATION", 409, "Unique / Idempotency Constraint"),
    "23503": ("FOREIGN_KEY_VIOLATION", 400, "Referential Integrity Constraint"),
}


def build_pg_error_payload(exc: psycopg.Error) -> tuple[int, dict[str, Any]]:
    sqlstate = getattr(exc, "sqlstate", None)
    diag = getattr(exc, "diag", None)
    constraint = getattr(diag, "constraint_name", None) if diag else None
    message = getattr(diag, "message_primary", None) if diag else str(exc)

    code, status_code, rule_name = PG_RULE_MAP.get(
        sqlstate or "", ("DATABASE_ERROR", 400, "PostgreSQL Constraint")
    )
    return status_code, {
        "detail": {
            "error_code": code,
            "sqlstate": sqlstate,
            "enforced_by": rule_name,
            "constraint": constraint,
            "message": message or str(exc),
        }
    }


def translate_pg_error(exc: psycopg.Error) -> HTTPException:
    status_code, payload = build_pg_error_payload(exc)
    return HTTPException(status_code=status_code, detail=payload["detail"])


async def domain_error_handler(_request: Request, exc: DomainError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": {"error_code": exc.error_code, "message": exc.message}},
    )


async def psycopg_error_handler(_request: Request, exc: psycopg.Error) -> JSONResponse:
    status_code, payload = build_pg_error_payload(exc)
    return JSONResponse(status_code=status_code, content=payload)
