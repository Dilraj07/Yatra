from typing import Any

from app.core.db import get_pg_conn
from app.core.exceptions import ConflictError, DomainError, NotFoundError
from app.services.suppliers import (
    book_flight_duffel,
    book_hotel_liteapi,
    cancel_flight_duffel,
    cancel_hotel_liteapi,
    charge_payment_razorpay,
    refund_payment_razorpay,
)


def list_trip_sagas(trip_id: int) -> list[dict[str, Any]]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT bs.*, i.version AS itinerary_version, i.summary "
                "FROM booking_saga bs "
                "JOIN itinerary i ON i.itinerary_id = bs.itinerary_id "
                "WHERE i.trip_id = %s ORDER BY bs.saga_id DESC",
                (trip_id,),
            )
            sagas = cur.fetchall()
            for s in sagas:
                cur.execute("SELECT * FROM saga_step WHERE saga_id = %s ORDER BY seq ASC", (s["saga_id"],))
                s["steps"] = cur.fetchall()
                cur.execute("SELECT * FROM payment WHERE saga_id = %s ORDER BY payment_id DESC", (s["saga_id"],))
                s["payments"] = cur.fetchall()
            return sagas


def execute_booking_saga(
    itinerary_id: int,
    payer_user_id: int,
    simulate_failure_at: str | None = None,
) -> dict[str, Any]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT i.*, t.trip_id, t.title AS trip_title "
                "FROM itinerary i JOIN trip t ON t.trip_id = i.trip_id "
                "WHERE i.itinerary_id = %s",
                (itinerary_id,),
            )
            itin = cur.fetchone()
            if not itin:
                raise NotFoundError(f"Itinerary {itinerary_id} not found")
            if itin["status"] not in ("APPROVED", "CONFIRMED"):
                raise ConflictError(
                    f"Itinerary {itinerary_id} is '{itin['status']}'. "
                    "It must reach 'APPROVED' via group quorum voting before booking."
                )

            trip_id = itin["trip_id"]
            cur.execute("SELECT * FROM itinerary_leg WHERE itinerary_id = %s ORDER BY seq ASC", (itinerary_id,))
            legs = cur.fetchall()
            if not legs:
                raise DomainError("Itinerary has no legs to book")

            cur.execute("SELECT COUNT(*) AS cnt FROM trip_member WHERE trip_id = %s", (trip_id,))
            member_count = cur.fetchone()["cnt"]

            cur.execute("SELECT * FROM booking_saga WHERE itinerary_id = %s", (itinerary_id,))
            existing = cur.fetchone()
            if existing and existing["state"] == "CONFIRMED":
                raise ConflictError(f"Itinerary {itinerary_id} already has a CONFIRMED booking saga #{existing['saga_id']}")
            if existing:
                cur.execute("DELETE FROM booking_saga WHERE saga_id = %s", (existing["saga_id"],))

            cur.execute(
                "INSERT INTO booking_saga (itinerary_id, state) VALUES (%s, 'INITIATED') RETURNING *",
                (itinerary_id,),
            )
            saga_id = cur.fetchone()["saga_id"]
            conn.commit()

    completed_holds: list[int] = []
    completed_steps: list[dict[str, Any]] = []
    payment_record: dict[str, Any] | None = None
    step_seq = 1
    total_cost_inr = sum(float(l["est_cost_inr"]) for l in legs) or 1000.0

    try:
        # 5.2 Hold attraction seats
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("UPDATE booking_saga SET state = 'HOLDING_SLOTS' WHERE saga_id = %s", (saga_id,))
                for leg in legs:
                    if leg["slot_id"] is not None:
                        idem_key = f"saga:{saga_id}:hold:leg:{leg['leg_id']}"
                        cur.execute(
                            "INSERT INTO saga_step (saga_id, leg_id, seq, step_type, state, attempts, idempotency_key) "
                            "VALUES (%s, %s, %s, 'HOLD_SLOT', 'PENDING', 1, %s) RETURNING *",
                            (saga_id, leg["leg_id"], step_seq, idem_key),
                        )
                        step = cur.fetchone()
                        step_seq += 1

                        seats_needed = int((leg.get("supplier_meta") or {}).get("seats", member_count))
                        cur.execute(
                            "INSERT INTO slot_hold (slot_id, leg_id, seats, state) "
                            "VALUES (%s, %s, %s, 'HELD') RETURNING hold_id",
                            (leg["slot_id"], leg["leg_id"], seats_needed),
                        )
                        hold_id = cur.fetchone()["hold_id"]
                        completed_holds.append(hold_id)

                        cur.execute(
                            "UPDATE saga_step SET state = 'COMPLETED', supplier_ref = %s, updated_at = NOW() "
                            "WHERE step_id = %s",
                            (f"hold:{hold_id}", step["step_id"]),
                        )
                        completed_steps.append(
                            {"step_id": step["step_id"], "step_type": "HOLD_SLOT", "supplier_ref": f"hold:{hold_id}", "hold_id": hold_id}
                        )
                conn.commit()

        # 5.3 Book flights and hotels
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("UPDATE booking_saga SET state = 'BOOKING_SUPPLIERS' WHERE saga_id = %s", (saga_id,))
                conn.commit()

        for leg in legs:
            if leg["kind"] not in ("FLIGHT", "HOTEL"):
                continue
            step_type = "BOOK_FLIGHT" if leg["kind"] == "FLIGHT" else "BOOK_HOTEL"
            idem_key = f"saga:{saga_id}:{step_type.lower()}:leg:{leg['leg_id']}"

            with get_pg_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "INSERT INTO saga_step (saga_id, leg_id, seq, step_type, state, attempts, idempotency_key) "
                        "VALUES (%s, %s, %s, %s, 'PENDING', 1, %s) RETURNING *",
                        (saga_id, leg["leg_id"], step_seq, step_type, idem_key),
                    )
                    step = cur.fetchone()
                    step_seq += 1
                    conn.commit()

            try:
                if step_type == "BOOK_FLIGHT":
                    ref = book_flight_duffel(trip_id, saga_id, idem_key, leg, simulate_failure=(simulate_failure_at == "FLIGHT"))["order_ref"]
                else:
                    ref = book_hotel_liteapi(trip_id, saga_id, idem_key, leg, simulate_failure=(simulate_failure_at == "HOTEL"))["booking_ref"]

                with get_pg_conn() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            "UPDATE saga_step SET state = 'COMPLETED', supplier_ref = %s, updated_at = NOW() WHERE step_id = %s",
                            (ref, step["step_id"]),
                        )
                        conn.commit()
                completed_steps.append({"step_id": step["step_id"], "step_type": step_type, "supplier_ref": ref})
            except Exception as step_exc:
                with get_pg_conn() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            "UPDATE saga_step SET state = 'FAILED', error_message = %s, updated_at = NOW() WHERE step_id = %s",
                            (str(step_exc), step["step_id"]),
                        )
                        conn.commit()
                raise

        # 5.4 Collect payment
        pay_idem = f"saga:{saga_id}:payment:trip:{trip_id}"
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("UPDATE booking_saga SET state = 'AWAITING_PAYMENT' WHERE saga_id = %s", (saga_id,))
                cur.execute("UPDATE trip SET status = 'PENDING_PAYMENT' WHERE trip_id = %s", (trip_id,))
                cur.execute(
                    "INSERT INTO saga_step (saga_id, leg_id, seq, step_type, state, attempts, idempotency_key) "
                    "VALUES (%s, NULL, %s, 'COLLECT_PAYMENT', 'PENDING', 1, %s) RETURNING *",
                    (saga_id, step_seq, pay_idem),
                )
                pay_step = cur.fetchone()
                conn.commit()

        try:
            pay_res = charge_payment_razorpay(
                trip_id, saga_id, pay_idem, total_cost_inr, simulate_failure=(simulate_failure_at == "PAYMENT")
            )
            with get_pg_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "INSERT INTO payment (trip_id, user_id, saga_id, razorpay_order_id, razorpay_payment_id, amount_inr, status) "
                        "VALUES (%s, %s, %s, %s, %s, %s, 'CAPTURED') RETURNING *",
                        (trip_id, payer_user_id, saga_id, pay_res["order_id"], pay_res["payment_id"], total_cost_inr),
                    )
                    payment_record = cur.fetchone()
                    cur.execute(
                        "UPDATE saga_step SET state = 'COMPLETED', supplier_ref = %s, updated_at = NOW() WHERE step_id = %s",
                        (pay_res["payment_id"], pay_step["step_id"]),
                    )
                    conn.commit()
            completed_steps.append(
                {"step_id": pay_step["step_id"], "step_type": "COLLECT_PAYMENT", "supplier_ref": pay_res["payment_id"]}
            )
        except Exception as pay_exc:
            with get_pg_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE saga_step SET state = 'FAILED', error_message = %s, updated_at = NOW() WHERE step_id = %s",
                        (str(pay_exc), pay_step["step_id"]),
                    )
                    conn.commit()
            raise

        # 5.5 Confirm
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                for hid in completed_holds:
                    cur.execute("UPDATE slot_hold SET state = 'CONFIRMED' WHERE hold_id = %s", (hid,))
                cur.execute("UPDATE booking_saga SET state = 'CONFIRMED', finished_at = NOW() WHERE saga_id = %s", (saga_id,))
                cur.execute("UPDATE itinerary SET status = 'CONFIRMED' WHERE itinerary_id = %s", (itinerary_id,))
                cur.execute("UPDATE trip SET status = 'CONFIRMED' WHERE trip_id = %s", (trip_id,))
                conn.commit()

        return _fetch_saga_detail(saga_id, rolled_back=False, failure_reason=None)

    except Exception as exc:
        _compensate_saga(saga_id, trip_id, completed_steps, payment_record, str(exc))
        return _fetch_saga_detail(saga_id, rolled_back=True, failure_reason=str(exc))


def _compensate_saga(
    saga_id: int,
    trip_id: int,
    completed_steps: list[dict[str, Any]],
    payment_record: dict[str, Any] | None,
    reason: str,
) -> None:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE booking_saga SET state = 'COMPENSATING' WHERE saga_id = %s", (saga_id,))
            conn.commit()

    for step in reversed(completed_steps):
        st = step["step_type"]
        ref = step["supplier_ref"]
        if st == "COLLECT_PAYMENT" and payment_record:
            refund_payment_razorpay(trip_id, saga_id, ref, float(payment_record["amount_inr"]))
            with get_pg_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute("UPDATE payment SET status = 'REFUNDED' WHERE payment_id = %s", (payment_record["payment_id"],))
                    conn.commit()
        elif st == "BOOK_HOTEL":
            cancel_hotel_liteapi(trip_id, saga_id, ref)
        elif st == "BOOK_FLIGHT":
            cancel_flight_duffel(trip_id, saga_id, ref)
        elif st == "HOLD_SLOT":
            with get_pg_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute("UPDATE slot_hold SET state = 'RELEASED' WHERE hold_id = %s", (step["hold_id"],))
                    conn.commit()

        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE saga_step SET state = 'COMPENSATED', error_message = %s, updated_at = NOW() WHERE step_id = %s",
                    (f"Compensated due to: {reason}", step["step_id"]),
                )
                conn.commit()

    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE booking_saga SET state = 'ROLLED_BACK', finished_at = NOW() WHERE saga_id = %s", (saga_id,))
            cur.execute("UPDATE trip SET status = 'APPROVED' WHERE trip_id = %s", (trip_id,))
            conn.commit()


def _fetch_saga_detail(saga_id: int, rolled_back: bool, failure_reason: str | None) -> dict[str, Any]:
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM booking_saga WHERE saga_id = %s", (saga_id,))
            saga = cur.fetchone()
            cur.execute("SELECT * FROM saga_step WHERE saga_id = %s ORDER BY seq ASC", (saga_id,))
            steps = cur.fetchall()
            cur.execute("SELECT * FROM payment WHERE saga_id = %s ORDER BY created_at DESC", (saga_id,))
            payments = cur.fetchall()
    return {"saga": saga, "steps": steps, "payments": payments, "rolled_back": rolled_back, "failure_reason": failure_reason}
