import os
import psycopg
import pytest

DB_URL = os.getenv("DATABASE_URL", "postgresql://yatra:yatra_secret@localhost:5432/yatra_db")


def get_conn():
    return psycopg.connect(DB_URL)


def test_rule1_deferred_quorum_blocks_unapproved_itinerary():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE itinerary SET status = 'APPROVED' WHERE itinerary_id = 1")
            with pytest.raises(psycopg.errors.RaiseException) as exc:
                conn.commit()
            assert exc.value.sqlstate == "P0001"
            conn.rollback()


def test_rule2_no_overselling_capacity_slot():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT slot_id, capacity_total FROM capacity_slot LIMIT 1")
            slot_id, cap = cur.fetchone()
            with pytest.raises(psycopg.errors.CheckViolation) as exc:
                cur.execute("INSERT INTO slot_hold (slot_id, seats, state) VALUES (%s, %s, 'HELD')", (slot_id, cap + 10))
            assert exc.value.sqlstate == "23514"
            conn.rollback()


def test_rule3_deferred_balanced_ledger_blocks_unbalanced_expense():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO expense (trip_id, payer_id, description, amount) "
                "VALUES (1, 1, 'Unbalanced test', 500.00) RETURNING expense_id"
            )
            exp_id = cur.fetchone()[0]
            cur.execute("INSERT INTO ledger_entry (expense_id, trip_id, user_id, amount_inr) VALUES (%s, 1, 1, 500.00)", (exp_id,))
            with pytest.raises((psycopg.errors.RaiseException, psycopg.errors.NoDataFound)) as exc:
                conn.commit()
            assert exc.value.sqlstate == "P0002"
            conn.rollback()


def test_rule4_gist_exclusion_blocks_overlapping_leg_participant():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO itinerary_leg (itinerary_id, seq, kind, title, span, est_cost_inr) "
                "VALUES (1, 99, 'ACTIVITY', 'Conflicting Overlap Activity', "
                "tstzrange('2026-12-18 08:00:00+05:30', '2026-12-18 09:30:00+05:30'), 500) RETURNING leg_id"
            )
            leg_id = cur.fetchone()[0]
            with pytest.raises(psycopg.errors.ExclusionViolation) as exc:
                cur.execute("INSERT INTO leg_participant (leg_id, user_id) VALUES (%s, 1)", (leg_id,))
            assert exc.value.sqlstate == "23P01"
            conn.rollback()
