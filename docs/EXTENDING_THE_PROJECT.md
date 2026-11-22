# Developer Cookbook: Extending Yatra in the Future

## 1. Connecting Live Sandbox API Keys

All external integrations are isolated in `backend/app/services/suppliers.py` and `backend/app/services/ai_planner.py`.

Set any of these keys in `.env` and restart `docker compose up`:

- `GEMINI_API_KEY`: Switches `ai_planner.py` from deterministic local NLP extraction to live Google Gemini JSON structured output.
- `DUFFEL_API_KEY`: Enables live Duffel v2 sandbox requests in `book_flight_duffel()`.
- `LITEAPI_KEY`: Enables live LiteAPI v3.0 sandbox requests in `book_hotel_liteapi()`.
- `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET`: Creates real Razorpay Test Mode orders in `charge_payment_razorpay()`.

When keys are omitted, the backend runs deterministic local sandbox adapters and still writes full request/response snapshots to MongoDB so every workflow functions end-to-end offline.

## 2. Adding a New Backend Feature (Clean Layering Checklist)

1. **Schema**: Add table/constraint to `database/schema.sql`.
2. **DTO**: Add Pydantic models in `backend/app/schemas/<domain>.py`.
3. **Repository**: Add SQL queries in `backend/app/repositories/<domain>_repo.py` (never import FastAPI inside repositories).
4. **Service**: Put transaction orchestration and business rules in `backend/app/services/<domain>_service.py`.
5. **Router**: Expose thin endpoints in `backend/app/routers/<domain>.py` and register in `backend/app/main.py`.
6. **Tests**: Add unit/integration tests in `backend/tests/`.

## 3. Adding a New Frontend Workspace Tab

The frontend (`frontend/src/App.jsx`) uses a clean single-workspace tab architecture:

1. Create a focused component in `frontend/src/components/<Feature>Tab.jsx`.
2. Choose one pastel color-block surface from `tailwind.config.js` (`bg-block-lime`, `bg-block-lilac`, `bg-block-cream`, `bg-block-mint`, `bg-block-coral`, `bg-block-pink`, or `bg-block-navy`).
3. Register the tab entry in the `WORKSPACE_TABS` array in `App.jsx`.

## 4. Viva / Evaluation Walkthrough Checklist

1. **Rule #1 (Quorum `P0001`)**: Go to **3. Quorum Vote** -> click **Commit Approval** while only 1/2 votes exist -> PostgreSQL rejects with `SQLSTATE P0001`. Switch voter to Arya -> click **Approve** -> click **Commit Approval** -> succeeds.
2. **Rule #2 (No Overselling `23514`)**: Go to **6. Site Operator** -> try holding `5` seats on **Batch 3 (capacity 4)** -> PostgreSQL rejects with `SQLSTATE 23514`.
3. **Rule #3 (Zero-Sum Ledger `P0002`)**: Go to **5. Expenses** -> check the "+1.00 INR corrupt test" box and submit -> PostgreSQL rejects with `SQLSTATE P0002`. Uncheck and submit -> commits cleanly and updates settlements.
4. **Rule #4 (GiST Overlap `23P01`)**: Go to **2. AI Planner** -> run AI Agent with overlap test enabled (watch SAVEPOINT self-correction trace) OR manually insert a leg overlapping `07:30-10:15` -> PostgreSQL rejects with `SQLSTATE 23P01`.
5. **Level 2 Saga Compensation**: Go to **4. Booking Saga** -> run with failure injected at `PAYMENT` -> observe `HOLD_SLOT`, `BOOK_FLIGHT`, and `BOOK_HOTEL` automatically transition to `COMPENSATED` and slot holds return to `RELEASED`. Then run in Normal mode to confirm the trip.
