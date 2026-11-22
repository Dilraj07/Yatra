# REST API Reference

Interactive OpenAPI documentation is always available at `http://localhost:8000/docs`.

## Authentication

Protected write endpoints require a Bearer JWT token obtained from `/api/auth/login` or `/api/auth/register`:

```http
Authorization: Bearer <access_token>
```

## Error Format for Database Invariant Violations

When PostgreSQL rejects a transaction, `app/core/exceptions.py` translates the SQLSTATE into a structured JSON response:

```json
{
  "detail": {
    "error_code": "QUORUM_NOT_MET",
    "sqlstate": "P0001",
    "enforced_by": "Rule #1 (Deferred Quorum Trigger)",
    "constraint": null,
    "message": "QUORUM_NOT_MET: Itinerary 1 requires 2 approve votes (67 pct of 3 members), found 1"
  }
}
```

## Endpoints by DFD Process

### Auth (`/api/auth`)
- `POST /api/auth/register` — Create user account and return JWT.
- `POST /api/auth/login` — Authenticate and return JWT.
- `GET /api/auth/users` — List registered users.

### 1.0 Trips & Members (`/api/trips`)
- `GET /api/trips` — List all trips with member counts.
- `POST /api/trips` — Create trip and register organizer in `trip_member`.
- `GET /api/trips/{trip_id}` — Fetch trip metadata, members, and declared constraints.
- `POST /api/trips/{trip_id}/members` — Add member to trip.
- `POST /api/trips/{trip_id}/constraints` — Add JSONB member constraint.

### 2.0 Site Operator Inventory (`/api/inventory`)
- `GET /api/inventory/suppliers` — List suppliers.
- `GET /api/inventory/pois` — List Points of Interest.
- `POST /api/inventory/pois` — Register a new POI.
- `GET /api/inventory/slots` — List timed-entry slots (`slot_availability` view).
- `POST /api/inventory/slots` — Publish a new capacity slot (GiST prevents overlapping circuits).
- `GET /api/inventory/holds` — List recent slot holds.
- `POST /api/inventory/holds` — Hold seats (row-locked `CHECK` rejects overselling with `23514`).
- `POST /api/inventory/holds/{hold_id}/release` — Release hold and decrement `seats_taken`.
- `POST /api/inventory/holds/expire-stale` — Expire past-due holds.

### 3.0 Itinerary Planning & AI Agent (`/api/itineraries`)
- `GET /api/itineraries/trip/{trip_id}` — List versioned itineraries and legs with participants.
- `POST /api/itineraries` — Create empty draft itinerary version.
- `POST /api/itineraries/{itinerary_id}/legs` — Add leg + participants (`23P01` on overlap).
- `POST /api/itineraries/legs/{leg_id}/participants` — Assign traveller to leg (`23P01` on overlap).
- `POST /api/itineraries/ai-draft` — Run untrusted AI planner with SAVEPOINT self-correction loop.

### 4.0 Proposals & Quorum Voting (`/api/voting`)
- `GET /api/voting/trip/{trip_id}` — List proposals, cast votes, and quorum progress.
- `POST /api/voting/proposals` — Open voting proposal for an itinerary.
- `POST /api/voting/proposals/{proposal_id}/vote` — Cast or update vote (`APPROVE`, `REJECT`, `ABSTAIN`).
- `POST /api/voting/itineraries/{itinerary_id}/approve` — Attempt to commit `APPROVED` (`P0001` if quorum unmet).

### 5.0 Booking Saga (`/api/saga`)
- `POST /api/saga/execute` — Run Level 2 Saga (5.1 -> 5.5) with optional failure injection (`FLIGHT`, `HOTEL`, `PAYMENT`).
- `GET /api/saga/trip/{trip_id}` — List sagas, steps, idempotency keys, and payments.

### 6.0 Expenses & Double-Entry Ledger (`/api/expenses`)
- `GET /api/expenses/trip/{trip_id}` — List expenses, `member_balance` view, and greedy minimum-transfer settlements.
- `POST /api/expenses` — Post balanced double-entry expense (`P0002` if unbalanced).

### Audit & NoSQL (`/api/audit`)
- `GET /api/audit/postgres-log` — Query month-partitioned `audit_log` with resolved partition names.
- `GET /api/audit/nosql-documents` — Inspect MongoDB `llm_conversations`, `supplier_snapshots`, and `itinerary_drafts`.
- `GET /api/audit/system-status` — Live PostgreSQL & MongoDB health + table counts.
