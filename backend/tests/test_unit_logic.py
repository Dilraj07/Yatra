from fastapi import HTTPException
import pytest

from app.core.config import settings
from app.core.security import create_access_token, decode_access_token, hash_password, verify_password
from app.services.expense_service import compute_settlements


def test_dev_bypass_blocked_when_disabled(monkeypatch):
    monkeypatch.setattr(settings, "dev_auth_bypass", False)
    with pytest.raises(HTTPException) as exc:
        decode_access_token("demo_token")
    assert exc.value.status_code == 401
    with pytest.raises(HTTPException) as exc_clerk:
        decode_access_token("clerk_tok_fake123")
    assert exc_clerk.value.status_code == 401


def test_password_hashing_and_verification():
    pw_hash = hash_password("secure_pass_2026")
    assert verify_password("secure_pass_2026", pw_hash) is True
    assert verify_password("wrong_password", pw_hash) is False


def test_jwt_roundtrip():
    token = create_access_token(42, "dilraj@yatra.local", "Dilraj Singh")
    payload = decode_access_token(token)
    assert payload["sub"] == 42
    assert payload["email"] == "dilraj@yatra.local"


def test_greedy_settlement_balances_to_zero():
    balances = [
        {"user_id": 1, "full_name": "Dilraj", "net_balance_inr": 2000.00},
        {"user_id": 2, "full_name": "Arya", "net_balance_inr": -1200.00},
        {"user_id": 3, "full_name": "Aarush", "net_balance_inr": -800.00},
    ]
    transfers = compute_settlements(balances)
    assert len(transfers) == 2
    assert sum(t["amount_inr"] for t in transfers) == 2000.00
    assert all(t["to_name"] == "Dilraj" for t in transfers)
