# Yatra — Smart Group Tourism Management System (v2)

Course: Database Management Systems (CD252IA)
Department: CSE (AIML), RV College of Engineering, Bengaluru
Team: Aarush Luthra (1RV24CI004), Arya Wadhwa (1RV24CI023), Dilraj Singh (1RV24CI032)

---

## Documentation Index (`docs/`)

Full engineering documentation is included for future development and evaluation:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Clean layered backend architecture (`routers -> services -> repositories -> core`) and DFD 1.0–6.0 mapping.
- [`docs/DATABASE_DESIGN.md`](docs/DATABASE_DESIGN.md) — 18 3NF/BCNF tables, functional dependencies, controlled redundancies, all 4 enforced PostgreSQL rules, and partitioned `audit_log` maintenance.
- [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md) — Complete REST endpoint catalog and PostgreSQL SQLSTATE error contract.
- [`docs/EXTENDING_THE_PROJECT.md`](docs/EXTENDING_THE_PROJECT.md) — Developer cookbook for wiring live Gemini/Duffel/LiteAPI/Razorpay keys, adding new features, and running the viva walkthrough.
- [`docs/UI_DESIGN_SYSTEM.md`](docs/UI_DESIGN_SYSTEM.md) — Simplified tabbed workspace UI built on the monochrome + pastel color-block Figma design system.

---

## Quick Start (Docker Compose)

```bash
cp .env.example .env
docker compose up --build
```

- **Frontend Workspace**: `http://localhost:5173`
- **FastAPI OpenAPI Docs**: `http://localhost:8000/docs`

### Seeded Accounts (Password: `yatra123`)

- `dilraj@yatra.local` (Organizer)
- `arya@yatra.local` (Member)
- `aarush@yatra.local` (Member)
- `operator@asi.gov.in` (ASI Heritage Operator)

---

## Running Tests

```bash
docker compose exec backend pytest -v
```
