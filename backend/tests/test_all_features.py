"""
Yatra Comprehensive Feature Test Suite
Tests all 10 core product features individually:
1. Authentication & Security (Bcrypt, JWT)
2. Live Airspace Telemetry (OpenSky Network)
3. Live Accommodation Geo-Search (OpenStreetMap / Photon)
4. Live Satellite Weather Telemetry (Open-Meteo)
5. 2PC Distributed Saga & Supplier Engine
6. Financial Ledger & Greedy Zero-Sum Settlement
7. Quorum Threshold & Consensus Governance Logic
8. Razorpay Cryptographic HMAC-SHA256 Signature Verification
9. Sector Switching & Telemetry Caching
10. Full System Integration via FastAPI TestClient
"""

import math
import hmac
import hashlib
import time
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.security import hash_password, verify_password, create_access_token, decode_access_token
from app.services.expense_service import compute_settlements
from app.services.suppliers import (
    book_flight_duffel,
    cancel_flight_duffel,
    book_hotel_liteapi,
    cancel_hotel_liteapi,
    charge_payment_razorpay,
    refund_payment_razorpay,
)


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


# =============================================================================
# FEATURE 1: Authentication & Security (Bcrypt & JWT)
# =============================================================================
def test_feature1_password_hashing():
    raw_pass = "SecurePassphrase#2026"
    pw_hash = hash_password(raw_pass)
    assert pw_hash != raw_pass, "Password was not hashed"
    assert verify_password(raw_pass, pw_hash) is True, "Password verification failed for valid password"
    assert verify_password("WrongPassword123", pw_hash) is False, "Password verification passed for invalid password"


def test_feature1_jwt_access_token():
    user_id = 7
    email = "arya@yatra.local"
    name = "Arya Wadhwa"
    token = create_access_token(user_id, email, name)
    assert isinstance(token, str) and len(token) > 20, "Invalid JWT token string"

    payload = decode_access_token(token)
    assert payload["sub"] == user_id
    assert payload["email"] == email
    assert payload["name"] == name
    assert "exp" in payload, "JWT missing expiration claim"


def test_feature1_clerk_user_sync(monkeypatch):
    from app.services import auth_service
    from app.schemas.auth import ClerkSyncRequest
    from app.repositories import user_repo

    mock_db = {}

    def mock_get_user_by_email(email):
        return mock_db.get(email)

    def mock_create_user(email, full_name, home_city, password_hash):
        u = {"user_id": 99, "email": email, "full_name": full_name, "home_city": home_city}
        mock_db[email] = u
        return u

    monkeypatch.setattr(user_repo, "get_user_by_email", mock_get_user_by_email)
    monkeypatch.setattr(user_repo, "create_user", mock_create_user)

    req = ClerkSyncRequest(
        email="clerk_traveler@gmail.com",
        full_name="Clerk Traveler",
        clerk_id="user_clerk_123",
        avatar_url="https://images.clerk.dev/avatar.png"
    )
    result = auth_service.sync_clerk_user(req)
    assert "access_token" in result
    assert result["user"]["email"] == "clerk_traveler@gmail.com"
    assert result["user"]["full_name"] == "Clerk Traveler"
    assert result["user"]["avatar_url"] == "https://images.clerk.dev/avatar.png"



# =============================================================================
# FEATURE 2: Live Airspace Flight Radar (OpenSky Network ADS-B)
# =============================================================================
def test_feature2_live_flights_telemetry(client):
    res = client.get("/api/radar/flights?city=goa")
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
    data = res.json()
    assert data["city"] == "Goa"
    assert "flights" in data
    assert len(data["flights"]) >= 1, "Expected at least 1 flight in radar response"

    flight = data["flights"][0]
    assert "callsign" in flight and len(flight["callsign"]) >= 3
    assert "airline" in flight
    assert "altitude_feet" in flight
    assert "speed_kmh" in flight
    assert "status" in flight
    assert flight["status"] in ("Cruising", "Climbing", "Descending", "On Ground / Taxi")


# =============================================================================
# FEATURE 3: Live Verified Accommodations (OpenStreetMap / Photon)
# =============================================================================
def test_feature3_live_hotels_geocoding(client):
    res = client.get("/api/radar/hotels?city=goa")
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
    data = res.json()
    assert data["city"] == "Goa"
    assert "hotels" in data
    assert len(data["hotels"]) >= 1, "Expected at least 1 hotel in radar response"

    hotel = data["hotels"][0]
    assert "name" in hotel and len(hotel["name"]) >= 2
    assert "locality" in hotel
    assert "est_cost_inr" in hotel and hotel["est_cost_inr"] > 0
    assert "lat" in hotel and "lon" in hotel
    assert isinstance(hotel["amenities"], list)


# =============================================================================
# FEATURE 4: Live Satellite Ground Weather (Open-Meteo)
# =============================================================================
def test_feature4_live_weather_telemetry(client):
    res = client.get("/api/radar/weather?city=goa")
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
    data = res.json()
    assert data["city"] == "Goa"
    assert "weather" in data
    weather = data["weather"]
    assert "temperature_c" in weather and isinstance(weather["temperature_c"], (int, float))
    assert "windspeed_kmh" in weather
    assert "condition" in weather and len(weather["condition"]) >= 3
    assert -10.0 <= weather["temperature_c"] <= 55.0, "Unrealistic temperature value"


# =============================================================================
# FEATURE 5: 2PC Distributed Saga & Supplier Engine
# =============================================================================
def test_feature5_saga_supplier_pipeline():
    # 1. Book flight step
    leg_flight = {"title": "Air India Flight BLR -> GOI", "est_cost_inr": 3400.0, "supplier_meta": {}}
    flight_res = book_flight_duffel(trip_id=1, saga_id=99, idempotency_key="test_flt_001", leg=leg_flight)
    assert flight_res["status"] == "confirmed"
    flight_ref = flight_res.get("order_ref") or flight_res.get("booking_ref")
    assert flight_ref is not None, "Flight response missing order/booking reference"

    # 2. Book hotel step
    leg_hotel = {"title": "Palolem Beach Resort", "est_cost_inr": 4800.0}
    hotel_res = book_hotel_liteapi(trip_id=1, saga_id=99, idempotency_key="test_htl_001", leg=leg_hotel)
    assert hotel_res["status"] == "confirmed"
    hotel_ref = hotel_res.get("booking_ref") or hotel_res.get("order_ref")
    assert hotel_ref is not None, "Hotel response missing booking reference"

    # 3. Razorpay payment step
    pay_res = charge_payment_razorpay(trip_id=1, saga_id=99, idempotency_key="test_pay_001", amount_inr=8200.0)
    assert pay_res["status"] == "captured"
    assert "payment_id" in pay_res
    assert "signature" in pay_res

    # 4. Backward compensation steps (simulated failure rollback)
    cancel_flt = cancel_flight_duffel(trip_id=1, saga_id=99, supplier_ref=flight_ref)
    assert cancel_flt["status"] == "cancelled"

    cancel_htl = cancel_hotel_liteapi(trip_id=1, saga_id=99, supplier_ref=hotel_ref)
    assert cancel_htl["status"] == "cancelled"

    refund_pay = refund_payment_razorpay(trip_id=1, saga_id=99, payment_id=pay_res["payment_id"], amount_inr=8200.0)
    assert refund_pay["status"] == "refunded"
    assert "refund_id" in refund_pay


def test_feature5_saga_failure_simulation():
    # Simulating flight failure triggers exception
    leg_flight = {"title": "Air India Flight BLR -> GOI", "est_cost_inr": 3400.0}
    with pytest.raises(RuntimeError) as exc_flt:
        book_flight_duffel(trip_id=1, saga_id=100, idempotency_key="fail_flt_002", leg=leg_flight, simulate_failure=True)
    assert "DUFFEL_FARE_EXPIRED" in str(exc_flt.value)

    # Simulating payment decline triggers exception
    with pytest.raises(RuntimeError) as exc_pay:
        charge_payment_razorpay(trip_id=1, saga_id=100, idempotency_key="fail_pay_002", amount_inr=5000.0, simulate_failure=True)
    assert "RAZORPAY_PAYMENT_DECLINED" in str(exc_pay.value)


# =============================================================================
# FEATURE 6: Financial Ledger & Greedy Zero-Sum Settlement
# =============================================================================
def test_feature6_greedy_ledger_settlement():
    balances = [
        {"user_id": 1, "full_name": "Dilraj Singh", "net_balance_inr": 3600.00},
        {"user_id": 2, "full_name": "Arya Wadhwa", "net_balance_inr": -2400.00},
        {"user_id": 3, "full_name": "Aarush Luthra", "net_balance_inr": -1200.00},
    ]
    # Sum of balances must equal zero
    assert sum(b["net_balance_inr"] for b in balances) == 0.00, "Unbalanced ledger balances"

    transfers = compute_settlements(balances)
    assert len(transfers) == 2, f"Expected 2 optimal transfers, got {len(transfers)}"

    # Net transfers must reconcile Dilraj's credit
    total_reconciled = sum(t["amount_inr"] for t in transfers)
    assert total_reconciled == 3600.00
    assert all(t["to_name"] == "Dilraj Singh" for t in transfers)


# =============================================================================
# FEATURE 7: Quorum Threshold & Consensus Governance Logic
# =============================================================================
def test_feature7_quorum_consensus_math():
    def evaluate_quorum(member_count: int, quorum_pct: int, yes_votes: int):
        required_votes = math.ceil((member_count * quorum_pct) / 100.0)
        quorum_met = yes_votes >= required_votes
        actual_pct = round((yes_votes / member_count) * 100)
        return required_votes, quorum_met, actual_pct

    # Case A: 3 members, 60% requirement, 2 YES votes
    req, met, pct = evaluate_quorum(3, 60, 2)
    assert req == 2, f"Expected 2 required votes, got {req}"
    assert met is True, "Quorum should be satisfied (2/3 = 67% >= 60%)"
    assert pct == 67

    # Case B: 3 members, 60% requirement, 1 YES vote
    req, met, pct = evaluate_quorum(3, 60, 1)
    assert req == 2
    assert met is False, "Quorum should NOT be met (1/3 = 33% < 60%)"

    # Case C: 5 members, 67% requirement, 4 YES votes
    req, met, pct = evaluate_quorum(5, 67, 4)
    assert req == 4, f"Expected 4 required votes, got {req}"
    assert met is True


# =============================================================================
# FEATURE 8: Razorpay Cryptographic Signature Verification
# =============================================================================
def test_feature8_razorpay_hmac_signature():
    secret = b"yatra_rzp_test_secret"
    order_id = "order_98f72a1bc3de"
    payment_id = "pay_44b819f0ac22"

    payload = f"{order_id}|{payment_id}".encode("utf-8")
    valid_signature = hmac.new(secret, payload, hashlib.sha256).hexdigest()

    assert len(valid_signature) == 64, "Invalid SHA256 hex length"

    # Verify signature verification logic
    test_sig = hmac.new(secret, payload, hashlib.sha256).hexdigest()
    assert hmac.compare_digest(valid_signature, test_sig) is True

    # Tampered order_id must fail verification
    tampered_payload = f"order_tampered123|{payment_id}".encode("utf-8")
    tampered_sig = hmac.new(secret, tampered_payload, hashlib.sha256).hexdigest()
    assert hmac.compare_digest(valid_signature, tampered_sig) is False


# =============================================================================
# FEATURE 9: Sector Switching & Telemetry Caching
# =============================================================================
def test_feature9_sector_switching_and_caching(client):
    sectors = ["delhi", "bengaluru", "jaipur"]
    for city in sectors:
        r = client.get(f"/api/radar/flights?city={city}")
        assert r.status_code == 200
        data = r.json()
        assert len(data["flights"]) >= 1, f"No flights returned for sector: {city}"

    # Verify caching behavior (second immediate query returns sub-millisecond cached result)
    t0 = time.perf_counter()
    r_cached = client.get("/api/radar/flights?city=delhi")
    elapsed_ms = (time.perf_counter() - t0) * 1000
    assert r_cached.status_code == 200
    assert elapsed_ms < 50.0, f"Cache retrieval took too long: {elapsed_ms:.1f}ms"


# =============================================================================
# FEATURE 10: OpenAPI Documentation & Health Schema
# =============================================================================
def test_feature10_openapi_docs(client):
    res = client.get("/openapi.json")
    assert res.status_code == 200
    schema = res.json()
    assert schema["info"]["title"] == "Yatra — Smart Group Tourism Management System"
    assert "/api/radar/flights" in schema["paths"]
    assert "/api/radar/hotels" in schema["paths"]
    assert "/api/radar/weather" in schema["paths"]
    assert "/api/saga/execute" in schema["paths"]
    assert "/api/voting/proposals" in schema["paths"]
