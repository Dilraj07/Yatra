# System Architecture & Layering Guide

## 1. Core Design Philosophy

Yatra enforces a strict separation between **proposal** and **commitment**:

- **Untrusted Layer (Frontend + AI Planner)**: Collects group requests, drafts itineraries, and triggers workflows.
- **Trusted Application Layer (FastAPI Backend)**: Cleanly separated into `routers` -> `services` -> `repositories` -> `core`. Orchestrates multi-step workflows (such as the Booking Saga) and translates PostgreSQL SQLSTATE errors into structured HTTP responses.
- **Authoritative Persistence Layer (PostgreSQL 16 + MongoDB 7)**:
  - **PostgreSQL 16** is the single source of truth for money, votes, timed-entry capacity, and schedules. Every critical invariant is enforced by database triggers, `CHECK` constraints, row locks, and GiST exclusion constraints.
  - **MongoDB 7** stores semi-structured, evolving documents (`llm_conversations`, `itinerary_drafts`, `supplier_snapshots`) linked back to relational `trip_id` and `saga_id`.

---

## 2. Backend Layered Structure (`backend/app/`)

```text
backend/app/
├── core/
│   ├── config.py        # Pydantic Settings (.env loader)
│   ├── db.py            # PostgreSQL ConnectionPool + MongoDB client
│   ├── exceptions.py    # Domain exceptions + PostgreSQL SQLSTATE -> HTTP mapper
│   └── security.py      # PBKDF2-SHA256 password hashing + HMAC-SHA256 JWT auth
├── schemas/             # Pydantic v2 DTOs (strict request validation)
│   ├── auth.py
│   ├── trip.py
│   ├── inventory.py
│   ├── itinerary.py
│   ├── voting.py
│   ├── saga.py
│   └── expense.py
├── repositories/        # Pure SQL data-access layer (zero HTTP / FastAPI coupling)
│   ├── user_repo.py
│   ├── trip_repo.py
│   ├── inventory_repo.py
│   ├── itinerary_repo.py
│   ├── voting_repo.py
│   ├── expense_repo.py
│   └── audit_repo.py
├── services/            # Business logic, transactions, Saga, AI loop, external adapters
│   ├── auth_service.py
│   ├── trip_service.py
│   ├── inventory_service.py
│   ├── itinerary_service.py
│   ├── voting_service.py
│   ├── expense_service.py
│   ├── ai_planner.py
│   ├── saga_engine.py
│   └── suppliers.py
├── routers/             # Thin FastAPI HTTP controllers delegating to services
│   ├── auth.py
│   ├── trips.py
│   ├── inventory.py
│   ├── itineraries.py
│   ├── voting.py
│   ├── saga.py
│   ├── expenses.py
│   └── audit.py
└── main.py              # App lifecycle, CORS, middleware, global exception handlers
```

---

## 3. DFD Process Mapping

| DFD Process | Backend Router | Service | Primary PostgreSQL Tables |
|---|---|---|---|
| **1.0 Manage trips & members** | `routers/trips.py` | `trip_service.py` | `app_user`, `trip`, `trip_member`, `member_constraint` |
| **2.0 Update attraction slots** | `routers/inventory.py` | `inventory_service.py` | `supplier`, `poi`, `capacity_slot`, `slot_hold` |
| **3.0 Plan itinerary** | `routers/itineraries.py` | `itinerary_service.py`, `ai_planner.py` | `itinerary`, `itinerary_leg`, `leg_participant` (+ MongoDB) |
| **4.0 Conduct group vote** | `routers/voting.py` | `voting_service.py` | `proposal`, `vote`, `itinerary` |
| **5.0 Book trip (5.1 - 5.5)** | `routers/saga.py` | `saga_engine.py`, `suppliers.py` | `booking_saga`, `saga_step`, `slot_hold`, `payment` (+ MongoDB) |
| **6.0 Split expenses** | `routers/expenses.py` | `expense_service.py` | `expense`, `ledger_entry`, `member_balance` view |
| **Audit & NoSQL** | `routers/audit.py` | `audit_repo.py` | `audit_log` (partitioned) + MongoDB collections |
