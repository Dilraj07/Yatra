# Database Design Reference (PostgreSQL 16 + MongoDB 7)

## 1. Normalization (3NF & BCNF)

All 18 relations in `database/schema.sql` satisfy Third Normal Form (3NF) and Boyce-Codd Normal Form (BCNF):

- `trip_member(trip_id, user_id)` -> `role, budget_ceiling, joining_city`
- `capacity_slot(slot_id)` -> `poi_id, circuit, entry_window, capacity_total, price_inr`
- `vote(proposal_id, user_id)` -> `choice, cast_at`
- `itinerary_leg(itinerary_id, seq)` -> `leg_id, poi_id, slot_id, kind, title, span, est_cost_inr`

### Documented Controlled Redundancies

1. **`capacity_slot.seats_taken`**: Duplicates `SUM(slot_hold.seats)` for active holds so that capacity is enforced by a declarative `CHECK (seats_taken <= capacity_total)` and competing buyers serialize via `SELECT ... FOR UPDATE` inside `trg_sync_capacity_slot_seats`.
2. **`leg_participant.span` (and `itinerary_id`, `trip_id`)**: Copied from `itinerary_leg` by `trg_sync_leg_participant` because PostgreSQL `EXCLUDE USING gist` cannot join to another table. Updates to `itinerary_leg.span` are propagated by `trg_propagate_leg_span`.

---

## 2. The Four Enforced Database Rules

| Rule | Mechanism | Trigger / Constraint Name | SQLSTATE |
|---|---|---|---|
| **1. Quorum** | `DEFERRABLE INITIALLY DEFERRED` constraint trigger on `itinerary` | `trg_enforce_itinerary_quorum` | `P0001` |
| **2. No Overselling** | `FOR UPDATE` row lock trigger + declarative `CHECK` | `trg_sync_capacity_slot_seats` + `chk_capacity_no_oversell` | `23514` |
| **3. Balanced Ledger** | `DEFERRABLE INITIALLY DEFERRED` constraint triggers on `ledger_entry` & `expense` | `trg_enforce_balanced_ledger_*` | `P0002` |
| **4. No Double-Booking** | GiST exclusion constraint (`btree_gist`) on `leg_participant` | `excl_leg_participant_no_overlap` | `23P01` |

---

## 3. Month-Partitioned Audit Log Maintenance

`audit_log` is partitioned by `RANGE (changed_at)` and populated automatically by `trg_audit_slot_hold` and `trg_audit_saga_step`.

To add a new monthly partition in the future:

```sql
CREATE TABLE audit_log_2027_02 PARTITION OF audit_log
    FOR VALUES FROM ('2027-02-01 00:00:00+00') TO ('2027-03-01 00:00:00+00');
```

Any timestamp outside explicit partitions routes safely into `audit_log_default`.

---

## 4. MongoDB Collections (`yatra_nosql`)

- `llm_conversations`: Stores user prompt, selected engine (`gemini_api` or `local_constraint_nlp`), and full SAVEPOINT self-correction trace linked to `trip_id` and `itinerary_id`.
- `itinerary_drafts`: Stores pre-validation AI drafts and group constraints snapshot.
- `supplier_snapshots`: Stores verbatim request/response payloads from Duffel, LiteAPI, and Razorpay linked to `trip_id` and `saga_id`.
