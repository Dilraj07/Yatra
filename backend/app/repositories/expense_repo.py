from decimal import Decimal
from typing import Any

from app.core.db import get_pg_conn


def list_trip_expenses_and_balances(trip_id: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
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


def list_trip_member_ids(trip_id: int) -> list[int]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT user_id FROM trip_member WHERE trip_id = %s ORDER BY user_id ASC", (trip_id,))
            return [r["user_id"] for r in cur.fetchall()]


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
            conn.commit()  # Triggers deferred zero-sum ledger check
            return expense
