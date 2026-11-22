# Yatra — Viva Presentation & Demonstration Guide

> **Course:** Database Management Systems (`CD252IA`)  
> **Institution:** RV College of Engineering · Dept. of CSE (AIML)  
> **Team:** Aarush Luthra (`1RV24CI004`), Arya Wadhwa (`1RV24CI023`), Dilraj Singh (`1RV24CI032`)

---

## 1. Five-Minute Presentation Script

### 🕒 Minute 0:00 – 1:00: Problem & Architecture (Aarush Luthra)
* **The Problem**: Conventional group travel planning relies on chat apps, informal consensus, and one person fronting money. AI travel agents (LLMs) can plan itineraries, but LLMs hallucinate prices, schedules, and capacity, leading to financial disputes.
* **Our Core Philosophy**: **Clear division of authority**.
  * The LLM behaves as an **untrusted creative agent** that extracts intent and drafts itineraries.
  * **PostgreSQL 16 is the final authority** enforcing human quorum, row locks, double-entry financial invariants, and atomicity.

### 🕒 Minute 1:00 – 2:30: Relational Schema & 4 Database Invariants (Arya Wadhwa)
* **3NF / BCNF Normalization**: 18 relations completely normalized across Trips, Members, Itineraries, Votes, Ledger, Bookings, and Capacity Slots.
* **4 Database-Enforced Invariants**:
  1. **DEFERRABLE Quorum Trigger (`trg_enforce_trip_approval_quorum`)**: Ensures a trip cannot transition to `APPROVED` or `PENDING_PAYMENT` until $\ge 50\%$ (or $60\%$) of members vote YES. Deferred to `COMMIT`.
  2. **Row-Level Capacity Locking (`SELECT ... FOR UPDATE` + `CHECK`)**: Prevents overselling limited-capacity attraction slots.
  3. **Zero-Sum Double-Entry Ledger (`trg_enforce_zero_sum_ledger`)**: Guarantees $\sum \text{Debit} - \sum \text{Credit} = 0$.
  4. **GiST Exclusion Constraint (`no_participant_overlap`)**: Uses `tstzrange` to mathematically prevent any traveler from having overlapping itinerary time blocks.

### 🕒 Minute 2:30 – 4:00: Live Demo & Razorpay Gateway (Dilraj Singh)
* **Live Demo Sequence**:
  1. Open **http://localhost:5173** (or `prototype/index.html`).
  2. Show **Trip Chat & Copilot**: Intent extraction from natural language.
  3. Show **Group Approvals**: Cast votes, watch quorum bar hit threshold.
  4. Open **Heritage Tickets** $\rightarrow$ Click **`💳 Buy & Pay with Razorpay`**:
     * Real Razorpay Gateway modal pops up on screen.
     * Click **"Authorize Payment"** $\rightarrow$ Payment ID captured, row lock committed in PostgreSQL.
  5. Open **Booking Engine (Saga)**:
     * Click **"Fail at Razorpay"** or **"Simulate Decline"** $\rightarrow$ Show the compensating rollback: locks released, zero money charged, trip status preserved.

### 🕒 Minute 4:00 – 5:00: Conclusion & Production Scaling (Team)
* Summary of how this bridges academic relational theory with modern multi-agent systems and fintech.

---

## 2. Top 10 Viva Questions & Exact Answers

### Q1: Why use a `DEFERRABLE INITIALLY DEFERRED` constraint trigger for Quorum instead of a standard trigger?
**Answer**: In group booking, inserting the final batch of votes and updating the trip status often happens within the same transaction block (`BEGIN ... UPDATE status ... INSERT votes ... COMMIT`). A standard trigger fires immediately on `UPDATE status` and would fail because the vote rows haven't been inserted yet. A `DEFERRABLE` trigger postpones validation to the `COMMIT` boundary, ensuring all transactional changes are present before validation.

### Q2: What is an `EXCLUDE USING gist` constraint and why can't a `UNIQUE` constraint do this?
**Answer**: A standard `UNIQUE` constraint only checks scalar equality ($a = b$). Time ranges require checking for **overlap** ($[\text{start}_1, \text{end}_1] \ \&\& \ [\text{start}_2, \text{end}_2]$). Using the `btree_gist` extension, PostgreSQL builds a Generalized Search Tree (GiST) index that enforces:
$$\text{traveler\_id WITH } = , \quad \text{time\_block WITH } \&\&$$
If an overlap occurs, PostgreSQL rejects it at the storage engine level with SQLSTATE `23P01 (EXCLUSION_VIOLATION)`.

### Q3: How do you prevent overbooking when two users buy tickets simultaneously?
**Answer**: We use pessimistic concurrency control. In `trg_sync_capacity_slot_seats`, before updating seat counts, we execute:
```sql
SELECT capacity_total, seats_taken FROM capacity_slot WHERE slot_id = NEW.slot_id FOR UPDATE;
```
This acquires an exclusive row lock. The second transaction blocks until the first completes. A declarative `CHECK (seats_taken <= capacity_total)` ensures that if capacity is exceeded, PostgreSQL throws an exception.

### Q4: Why implement a Double-Entry Ledger in the database?
**Answer**: Single-entry expense logs allow rounding errors and balance mismatches. Under double-entry accounting, every expenditure creates equal and opposite debit and credit entries. Our deferred trigger verifies that across any trip:
$$\sum \text{amount} = 0$$
No money can be created or lost due to software glitches or AI hallucination.

### Q5: What is the Saga Pattern and why not use 2-Phase Commit (2PC)?
**Answer**: 2PC requires distributed database locks across independent external services (Razorpay, Booking.com, Airlines). External vendor APIs do not support holding open database locks. The **Saga pattern** breaks the transaction into local steps with **compensating transactions**:
$$\text{Hold Seats} \rightarrow \text{Charge Razorpay} \rightarrow \text{Book Hotel}$$
If the hotel booking fails, the orchestrator executes reverse compensation:
$$\text{Refund Razorpay} \rightarrow \text{Release Seat Hold} \rightarrow \text{Abort}$$

### Q6: Why use a Hybrid RDBMS + NoSQL architecture?
**Answer**: 
* **PostgreSQL (RDBMS)**: Handles structured, ACID-critical data (ledger, votes, capacity slots, payments).
* **MongoDB / JSONB (NoSQL)**: Handles unstructured, fast-evolving data (raw LLM conversation history, third-party API response snapshots, exploratory draft itineraries).

### Q7: What SQLSTATE error codes does your system handle?
* `23P01`: `EXCLUSION_VIOLATION` (Traveler time-window collision).
* `23514`: `CHECK_VIOLATION` (Capacity exceeded or invalid status jump).
* `P0001`: `RAISE_EXCEPTION` (Quorum threshold or ledger balance invariant failed).

### Q8: How does the AI Copilot self-correct when the database rejects an insert?
**Answer**: The Python backend catches PostgreSQL SQLSTATE exceptions. Instead of crashing, the error message (e.g. *"Traveler Arya has an overlap on Dec 21 09:00"*) is fed back into the LLM context prompt: *"Your proposal caused an overlap error. Propose an alternate time window."* The LLM then self-corrects and retries.

### Q9: What happens if payment succeeds on Razorpay but the network disconnects before confirmation?
**Answer**: We use **Idempotency Keys** and Razorpay Webhooks. The payment webhook updates the payment row to `CAPTURED`. If the client disconnects, the Saga worker detects the orphan state on recovery and completes the booking or triggers an automated refund.

### Q10: How does this prototype compare to commercial products (Hopper, Airbnb)?
**Answer**: Commercial products complement our database authority model with:
1. **Durable workflow engines (Temporal.io / Cadence)** to survive server crashes midway through multi-step sagas.
2. **Multi-party escrow pooling (Razorpay Route)** where each traveler pays their individual share through separate UPI links before the atomic vendor commit is triggered.

---

## 3. Quick psql Verification Commands

To demonstrate the database directly in the terminal for the evaluator:

```bash
# Connect to database
psql -U yatra -d yatra_db

# 1. View all 18 tables
\dt

# 2. Inspect GiST Exclusion constraint on itinerary_leg
\d leg_participant

# 3. Verify Quorum Trigger on trips
SELECT tgname, tgdeferrable FROM pg_trigger WHERE tgname = 'trg_enforce_trip_approval_quorum';

# 4. Check Double-Entry Ledger zero-sum balance
SELECT trip_id, SUM(amount) AS net_balance FROM ledger_entry GROUP BY trip_id;
```
