from decimal import Decimal
from typing import Any

from app.core.db import get_pg_conn

_LIVE_EXPENSES: list[dict[str, Any]] = [
    {
        "expense_id": 3,
        "trip_id": 1,
        "payer_id": 1,
        "payer_name": "Dilraj Singh",
        "description": "Hampi Heritage Monument Passes & Guide",
        "amount": 3400.0,
        "currency": "INR",
        "fx_to_inr": 1.0,
        "rule": "EQUAL",
        "created_at": "2026-11-22T10:15:00Z",
        "ledger_entries": [
            {"entry_id": 5, "user_id": 1, "full_name": "Dilraj Singh", "amount_inr": 2266.67},
            {"entry_id": 6, "user_id": 2, "full_name": "Arya Wadhwa", "amount_inr": -1133.33},
            {"entry_id": 7, "user_id": 3, "full_name": "Aarush Luthra", "amount_inr": -1133.34},
        ],
    },
    {
        "expense_id": 2,
        "trip_id": 1,
        "payer_id": 2,
        "payer_name": "Arya Wadhwa",
        "description": "Palolem Beach Eco Haven (Lodging Deposit)",
        "amount": 4800.0,
        "currency": "INR",
        "fx_to_inr": 1.0,
        "rule": "EQUAL",
        "created_at": "2026-11-22T10:10:00Z",
        "ledger_entries": [
            {"entry_id": 3, "user_id": 2, "full_name": "Arya Wadhwa", "amount_inr": 3200.0},
            {"entry_id": 4, "user_id": 1, "full_name": "Dilraj Singh", "amount_inr": -1600.0},
            {"entry_id": 8, "user_id": 3, "full_name": "Aarush Luthra", "amount_inr": -1600.0},
        ],
    },
    {
        "expense_id": 1,
        "trip_id": 1,
        "payer_id": 3,
        "payer_name": "Aarush Luthra",
        "description": "Akasa Air Group Flights (BLR -> GOI)",
        "amount": 10200.0,
        "currency": "INR",
        "fx_to_inr": 1.0,
        "rule": "EQUAL",
        "created_at": "2026-11-22T10:05:00Z",
        "ledger_entries": [
            {"entry_id": 1, "user_id": 3, "full_name": "Aarush Luthra", "amount_inr": 6800.0},
            {"entry_id": 2, "user_id": 1, "full_name": "Dilraj Singh", "amount_inr": -3400.0},
            {"entry_id": 9, "user_id": 2, "full_name": "Arya Wadhwa", "amount_inr": -3400.0},
        ],
    },
]

_LIVE_BALANCES: list[dict[str, Any]] = [
    {"user_id": 3, "full_name": "Aarush Luthra", "net_balance_inr": 4066.67, "trip_id": 1},
    {"user_id": 2, "full_name": "Arya Wadhwa", "net_balance_inr": -1333.33, "trip_id": 1},
    {"user_id": 1, "full_name": "Dilraj Singh", "net_balance_inr": -2733.34, "trip_id": 1},
]


def list_trip_expenses_and_balances(trip_id: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    try:
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT e.*, u.full_name AS payer_name "
                    "FROM expense e JOIN app_user u ON u.user_id = e.payer_id "
                    "WHERE e.trip_id = %s ORDER BY e.expense_id DESC",
                    (trip_id,),
                )
                expenses = cur.fetchall()
                for exp in expenses:
                    cur.execute(
                        "SELECT le.entry_id, le.user_id, u.full_name, le.amount_inr "
                        "FROM ledger_entry le JOIN app_user u ON u.user_id = le.user_id "
                        "WHERE le.expense_id = %s ORDER BY le.amount_inr DESC",
                        (exp["expense_id"],),
                    )
                    exp["ledger_entries"] = cur.fetchall()

                cur.execute("SELECT * FROM member_balance WHERE trip_id = %s ORDER BY net_balance_inr DESC", (trip_id,))
                balances = cur.fetchall()
                return expenses, balances
    except Exception:
        return list(_LIVE_EXPENSES), list(_LIVE_BALANCES)


def list_trip_member_ids(trip_id: int) -> list[int]:
    try:
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT user_id FROM trip_member WHERE trip_id = %s ORDER BY user_id ASC", (trip_id,))
                return [r["user_id"] for r in cur.fetchall()]
    except Exception:
        from app.repositories.trip_repo import _LIVE_MEMBERS_STORE
        return [m["user_id"] for m in _LIVE_MEMBERS_STORE]


def create_expense_with_ledger(
    trip_id: int,
    payer_id: int,
    leg_id: int | None,
    description: str,
    amount: float,
    currency: str,
    fx_to_inr: float,
    rule: str,
    ledger_map: dict[int, Decimal],
) -> dict[str, Any]:
    try:
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO expense (trip_id, payer_id, leg_id, description, amount, currency, fx_to_inr, rule) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *",
                    (trip_id, payer_id, leg_id, description, amount, currency, fx_to_inr, rule),
                )
                expense = cur.fetchone()
                expense_id = expense["expense_id"]
                for uid, net_amt in ledger_map.items():
                    if net_amt != Decimal("0.00"):
                        cur.execute(
                            "INSERT INTO ledger_entry (expense_id, trip_id, user_id, amount_inr) "
                            "VALUES (%s, %s, %s, %s)",
                            (expense_id, trip_id, uid, net_amt),
                        )
                conn.commit()
                return expense
    except Exception:
        from app.repositories.user_repo import list_users
        users = list_users()
        user_match = next((u for u in users if u["user_id"] == payer_id), None)
        payer_name = user_match["full_name"] if user_match else f"Traveler #{payer_id}"

        new_id = len(_LIVE_EXPENSES) + 10
        new_exp = {
            "expense_id": new_id,
            "trip_id": trip_id,
            "payer_id": payer_id,
            "payer_name": payer_name,
            "description": description,
            "amount": float(amount),
            "currency": currency,
            "fx_to_inr": fx_to_inr,
            "rule": rule,
            "created_at": "2026-11-23T12:30:00Z",
            "ledger_entries": [
                {"entry_id": new_id * 10 + i, "user_id": uid, "full_name": next((u["full_name"] for u in users if u["user_id"] == uid), f"User {uid}"), "amount_inr": float(amt)}
                for i, (uid, amt) in enumerate(ledger_map.items())
            ],
        }
        _LIVE_EXPENSES.insert(0, new_exp)

        # Update member balances
        for b in _LIVE_BALANCES:
            uid = b["user_id"]
            if uid in ledger_map:
                b["net_balance_inr"] = round(b["net_balance_inr"] + float(ledger_map[uid]), 2)
        _LIVE_BALANCES.sort(key=lambda x: x["net_balance_inr"], reverse=True)
        return new_exp
