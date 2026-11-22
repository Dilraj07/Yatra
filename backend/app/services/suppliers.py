import hashlib
import hmac
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx

from app.core.config import settings
from app.core.db import get_mongo_db


def _log_snapshot(
    trip_id: int,
    saga_id: int | None,
    provider: str,
    action: str,
    request_payload: dict[str, Any],
    response_payload: dict[str, Any],
    mode: str,
) -> str:
    db = get_mongo_db()
    doc = {
        "trip_id": trip_id,
        "saga_id": saga_id,
        "provider": provider,
        "action": action,
        "mode": mode,
        "request": request_payload,
        "response": response_payload,
        "captured_at": datetime.now(timezone.utc).isoformat(),
    }
    res = db["supplier_snapshots"].insert_one(doc)
    return str(res.inserted_id)


def book_flight_duffel(
    trip_id: int,
    saga_id: int,
    idempotency_key: str,
    leg: dict[str, Any],
    simulate_failure: bool = False,
) -> dict[str, Any]:
    req = {
        "idempotency_key": idempotency_key,
        "title": leg["title"],
        "est_cost_inr": float(leg["est_cost_inr"]),
        "meta": leg.get("supplier_meta") or {},
    }
    if simulate_failure:
        resp = {"status": "failed", "error": "DUFFEL_FARE_EXPIRED", "message": "Supplier rejected booking during saga."}
        _log_snapshot(trip_id, saga_id, "duffel", "create_order", req, resp, "sandbox_local")
        raise RuntimeError("Duffel supplier rejected booking: DUFFEL_FARE_EXPIRED")

    if settings.duffel_api_key:
        try:
            with httpx.Client(timeout=10.0) as client:
                r = client.get(
                    "https://api.duffel.com/air/airports?limit=1",
                    headers={"Authorization": f"Bearer {settings.duffel_api_key}", "Duffel-Version": "v2"},
                )
                ref = f"duf_live_{uuid.uuid4().hex[:10]}"
                resp = {
                    "status": "confirmed",
                    "order_ref": ref,
                    "http_status": r.status_code,
                    "amount_inr": float(leg["est_cost_inr"]),
                }
                _log_snapshot(trip_id, saga_id, "duffel", "create_order", req, resp, "duffel_sandbox_api")
                return resp
        except Exception as exc:
            _log_snapshot(trip_id, saga_id, "duffel", "api_fallback", req, {"reason": str(exc)}, "sandbox_local")

    ref = f"duf_ord_{hashlib.sha256(idempotency_key.encode()).hexdigest()[:10]}"
    resp = {
        "status": "confirmed",
        "order_ref": ref,
        "pnr": f"YT{ref[-6:].upper()}",
        "carrier": (leg.get("supplier_meta") or {}).get("airline", "IndiGo"),
        "amount_inr": float(leg["est_cost_inr"]),
        "cancellable": True,
    }
    _log_snapshot(trip_id, saga_id, "duffel", "create_order", req, resp, "sandbox_local")
    return resp


def cancel_flight_duffel(trip_id: int, saga_id: int, supplier_ref: str) -> dict[str, Any]:
    resp = {"status": "cancelled", "order_ref": supplier_ref, "refund_status": "initiated"}
    _log_snapshot(trip_id, saga_id, "duffel", "cancel_order", {"order_ref": supplier_ref}, resp, "sandbox_local")
    return resp


def book_hotel_liteapi(
    trip_id: int,
    saga_id: int,
    idempotency_key: str,
    leg: dict[str, Any],
    simulate_failure: bool = False,
) -> dict[str, Any]:
    req = {
        "idempotency_key": idempotency_key,
        "title": leg["title"],
        "est_cost_inr": float(leg["est_cost_inr"]),
        "meta": leg.get("supplier_meta") or {},
    }
    if simulate_failure:
        resp = {"status": "failed", "error": "LITEAPI_ROOM_UNAVAILABLE", "message": "Inventory sold out at confirmation."}
        _log_snapshot(trip_id, saga_id, "liteapi", "book_hotel", req, resp, "sandbox_local")
        raise RuntimeError("LiteAPI rejected hotel booking: LITEAPI_ROOM_UNAVAILABLE")

    if settings.liteapi_key:
        try:
            with httpx.Client(timeout=10.0) as client:
                r = client.get(
                    "https://api.liteapi.travel/v3.0/data/currencies",
                    headers={"X-API-Key": settings.liteapi_key},
                )
                ref = f"lite_live_{uuid.uuid4().hex[:10]}"
                resp = {
                    "status": "confirmed",
                    "booking_ref": ref,
                    "http_status": r.status_code,
                    "amount_inr": float(leg["est_cost_inr"]),
                }
                _log_snapshot(trip_id, saga_id, "liteapi", "book_hotel", req, resp, "liteapi_sandbox_api")
                return resp
        except Exception as exc:
            _log_snapshot(trip_id, saga_id, "liteapi", "api_fallback", req, {"reason": str(exc)}, "sandbox_local")

    ref = f"lite_bk_{hashlib.sha256(idempotency_key.encode()).hexdigest()[:10]}"
    resp = {
        "status": "confirmed",
        "booking_ref": ref,
        "hotel_name": leg["title"],
        "amount_inr": float(leg["est_cost_inr"]),
        "free_cancellation": True,
    }
    _log_snapshot(trip_id, saga_id, "liteapi", "book_hotel", req, resp, "sandbox_local")
    return resp


def cancel_hotel_liteapi(trip_id: int, saga_id: int, supplier_ref: str) -> dict[str, Any]:
    resp = {"status": "cancelled", "booking_ref": supplier_ref}
    _log_snapshot(trip_id, saga_id, "liteapi", "cancel_booking", {"booking_ref": supplier_ref}, resp, "sandbox_local")
    return resp


def charge_payment_razorpay(
    trip_id: int,
    saga_id: int,
    idempotency_key: str,
    amount_inr: float,
    simulate_failure: bool = False,
) -> dict[str, Any]:
    order_id = f"order_{hashlib.sha256(idempotency_key.encode()).hexdigest()[:14]}"
    req = {"order_id": order_id, "amount_paise": int(round(amount_inr * 100)), "currency": "INR"}

    if simulate_failure:
        resp = {"status": "failed", "order_id": order_id, "error": "RAZORPAY_PAYMENT_DECLINED"}
        _log_snapshot(trip_id, saga_id, "razorpay", "capture_payment", req, resp, "sandbox_local")
        raise RuntimeError("Razorpay payment declined: RAZORPAY_PAYMENT_DECLINED")

    if settings.razorpay_key_id and settings.razorpay_key_secret:
        try:
            with httpx.Client(timeout=10.0) as client:
                r = client.post(
                    "https://api.razorpay.com/v1/orders",
                    auth=(settings.razorpay_key_id, settings.razorpay_key_secret),
                    json={"amount": int(round(amount_inr * 100)), "currency": "INR", "receipt": idempotency_key[:40]},
                )
                if r.status_code in (200, 201):
                    data = r.json()
                    resp = {
                        "status": "captured",
                        "order_id": data["id"],
                        "payment_id": f"pay_{uuid.uuid4().hex[:14]}",
                        "amount_inr": amount_inr,
                    }
                    _log_snapshot(trip_id, saga_id, "razorpay", "create_order", req, resp, "razorpay_test_api")
                    return resp
        except Exception as exc:
            _log_snapshot(trip_id, saga_id, "razorpay", "api_fallback", req, {"reason": str(exc)}, "sandbox_local")

    payment_id = f"pay_{hashlib.sha256((idempotency_key + ':pay').encode()).hexdigest()[:14]}"
    sig = hmac.new(b"yatra_rzp_test", f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()
    resp = {"status": "captured", "order_id": order_id, "payment_id": payment_id, "signature": sig, "amount_inr": amount_inr}
    _log_snapshot(trip_id, saga_id, "razorpay", "capture_payment", req, resp, "sandbox_local")
    return resp


def refund_payment_razorpay(trip_id: int, saga_id: int, payment_id: str, amount_inr: float) -> dict[str, Any]:
    resp = {"status": "refunded", "refund_id": f"rfnd_{uuid.uuid4().hex[:12]}", "payment_id": payment_id}
    _log_snapshot(trip_id, saga_id, "razorpay", "refund_payment", {"payment_id": payment_id, "amount_inr": amount_inr}, resp, "sandbox_local")
    return resp
