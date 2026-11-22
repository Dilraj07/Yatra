from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from app.core.exceptions import DomainError
from app.repositories import expense_repo
from app.schemas.expense import ExpenseCreate


def compute_settlements(balances: list[dict[str, Any]]) -> list[dict[str, Any]]:
    debtors = []
    creditors = []
    for b in balances:
        amt = Decimal(str(b["net_balance_inr"])).quantize(Decimal("0.01"))
        if amt < 0:
            debtors.append({"user_id": b["user_id"], "full_name": b["full_name"], "amount": -amt})
        elif amt > 0:
            creditors.append({"user_id": b["user_id"], "full_name": b["full_name"], "amount": amt})

    debtors.sort(key=lambda x: x["amount"], reverse=True)
    creditors.sort(key=lambda x: x["amount"], reverse=True)

    transfers = []
    i = j = 0
    while i < len(debtors) and j < len(creditors):
        d = debtors[i]
        c = creditors[j]
        transfer = min(d["amount"], c["amount"])
        if transfer > Decimal("0.00"):
            transfers.append(
                {
                    "from_user_id": d["user_id"],
                    "from_name": d["full_name"],
                    "to_user_id": c["user_id"],
                    "to_name": c["full_name"],
                    "amount_inr": float(transfer),
                }
            )
        d["amount"] -= transfer
        c["amount"] -= transfer
        if d["amount"] == Decimal("0.00"):
            i += 1
        if c["amount"] == Decimal("0.00"):
            j += 1
    return transfers


def get_trip_finances(trip_id: int) -> dict[str, Any]:
    expenses, balances = expense_repo.list_trip_expenses_and_balances(trip_id)
    return {
        "expenses": expenses,
        "balances": balances,
        "settlements": compute_settlements(balances),
    }


def record_expense(payload: ExpenseCreate) -> dict[str, Any]:
    member_ids = expense_repo.list_trip_member_ids(payload.trip_id)
    if not member_ids:
        raise DomainError("Trip has no members")
    if payload.payer_id not in member_ids:
        raise DomainError("Payer must be a verified member of the trip")

    total_inr = (Decimal(str(payload.amount)) * Decimal(str(payload.fx_to_inr))).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
    entries: dict[int, Decimal] = {uid: Decimal("0.00") for uid in member_ids}
    entries[payload.payer_id] += total_inr

    if payload.rule == "EXACT" and payload.exact_shares:
        for uid, share in payload.exact_shares.items():
            entries[int(uid)] -= Decimal(str(share)).quantize(Decimal("0.01"))
    else:
        n = len(member_ids)
        base_share = (total_inr / Decimal(n)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        remainder = total_inr - (base_share * n)
        for idx, uid in enumerate(member_ids):
            share = base_share + (remainder if idx == 0 else Decimal("0.00"))
            entries[uid] -= share

    if payload.test_unbalanced_ledger:
        entries[payload.payer_id] += Decimal("1.00")

    return expense_repo.create_expense_with_ledger(
        trip_id=payload.trip_id,
        payer_id=payload.payer_id,
        leg_id=payload.leg_id,
        description=payload.description.strip(),
        amount=payload.amount,
        currency=payload.currency.upper(),
        fx_to_inr=payload.fx_to_inr,
        rule=payload.rule,
        ledger_map=entries,
    )
