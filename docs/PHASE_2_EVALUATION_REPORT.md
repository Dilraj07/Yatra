# RV College of Engineering · Department of CSE (AI & ML)
## Database Management Systems (CD252IA) · Phase 2 Evaluation Report

**Project Title:** Yatra — Smart Group Tourism Management System  
**Faculty Evaluator:** Course Coordinator, Dept. of CSE (AIML)  
**Team Members:**
* Aarush Luthra — `1RV24CI004`
* Arya Wadhwa — `1RV24CI023`
* Dilraj Singh — `1RV24CI032`

---

## SECTION 1: NORMALISATION FORMS (1NF, 2NF, 3NF, BCNF)

All 18 relational tables in the Yatra database schema (`database/schema.sql`) have been designed to satisfy **Third Normal Form (3NF)** and **Boyce-Codd Normal Form (BCNF)** to eliminate update, insertion, and deletion anomalies.

### 1.1 First Normal Form (1NF)
* **Definition**: A relation $R$ is in 1NF if and only if all underlying domains contain only atomic (indivisible) values, and there are no repeating groups.
* **Demonstration in Yatra**:
  * No multi-valued attributes or unnested lists are stored inside a single tuple. Rather than storing multiple travelers in an array or comma-separated field inside the `trip` table, membership is split into an associative table `trip_member(trip_id, user_id)`.
  * Multi-segmented schedules are split into discrete normalized rows in `itinerary_leg`.
  * Continuous time ranges are stored using PostgreSQL's atomic temporal range type `tstzrange`.
  * Every table possesses an unambiguous primary key constraint.

---

### 1.2 Second Normal Form (2NF)
* **Definition**: A relation $R$ is in 2NF if it is in 1NF and every non-prime attribute is **fully functionally dependent** on the primary key (no partial functional dependencies on composite keys).
* **Proof on Composite Key Relations**:
  * **Relation `trip_member`**:
    * $\text{Candidate Key}: \{\text{trip\_id}, \text{user\_id}\}$
    * $\text{Functional Dependencies (FDs)}:$
      $$\{\text{trip\_id}, \text{user\_id}\} \rightarrow \{\text{role}, \text{budget\_ceiling}, \text{joining\_city}, \text{joined\_at}\}$$
    * *Analysis*: Neither $\text{trip\_id}$ alone nor $\text{user\_id}$ alone can determine the $\text{budget\_ceiling}$ or $\text{role}$ (a user can be an `ORGANIZER` in one trip and a `MEMBER` in another; their budget varies per trip). Because no non-prime attribute depends on a proper subset of the key, **no partial dependency exists**. $\therefore$ **In 2NF**.
  * **Relation `vote`**:
    * $\text{Candidate Key}: \{\text{proposal\_id}, \text{user\_id}\}$
    * $\text{FDs}: \{\text{proposal\_id}, \text{user\_id}\} \rightarrow \{\text{choice}, \text{cast\_at}\}$
    * *Analysis*: A vote choice is valid only for a specific proposal by a specific user. It cannot depend partially on just the user or just the proposal. $\therefore$ **In 2NF**.

---

### 1.3 Third Normal Form (3NF) & Boyce-Codd Normal Form (BCNF)
* **Definition**: 
  * **3NF**: A relation is in 3NF if for every non-trivial functional dependency $X \rightarrow Y$, either $X$ is a superkey, or $Y$ is a prime attribute (eliminating transitive dependencies $X \rightarrow Z \rightarrow Y$).
  * **BCNF**: A relation is in BCNF if for every non-trivial functional dependency $X \rightarrow Y$, $X$ is strictly a **Superkey**.
* **Proof on Key Domain Relations**:
  * **Relation `capacity_slot` (Attraction Tickets)**:
    * $\text{Candidate Key}: \{\text{slot\_id}\}$
    * $\text{FDs}: \text{slot\_id} \rightarrow \{\text{poi\_id}, \text{circuit}, \text{entry\_window}, \text{capacity\_total}, \text{price\_inr}\}$
    * *Analysis*: The determinant $\text{slot\_id}$ is the primary superkey. Venue metadata (city, name, description) is not duplicated in `capacity_slot`; it is factored out into `poi(poi_id)`, preventing transitive dependencies. $\therefore$ **In BCNF**.
  * **Relation `itinerary_leg` (Schedules)**:
    * $\text{Candidate Keys}: \{\text{leg\_id}\} \text{ and } \{\text{itinerary\_id}, \text{seq}\}$
    * $\text{FDs}: \text{leg\_id} \rightarrow \{\text{itinerary\_id}, \text{seq}, \text{kind}, \text{title}, \text{span}, \text{est\_cost\_inr}\}$
    * *Analysis*: Both determinants are superkeys. There are no transitive relationships between non-prime attributes. $\therefore$ **In BCNF**.
  * **Relation `expense` & `ledger_entry` (Finances)**:
    * `expense`: $\text{expense\_id} \rightarrow \{\text{trip\_id}, \text{payer\_id}, \text{description}, \text{amount}, \text{created\_at}\}$
    * `ledger_entry`: $\text{entry\_id} \rightarrow \{\text{expense\_id}, \text{trip\_id}, \text{user\_id}, \text{amount\_inr}\}$
    * All functional determinants are superkeys. $\therefore$ **In BCNF**.

---

### 1.4 Controlled Redundancies (Intentional Denormalizations)

In production relational database design, controlled redundancies are permissible when explicitly documented and maintained by triggers:

1. **`capacity_slot.seats_taken`**:
   * *Theoretical Derivation*: $\text{seats\_taken} = \sum(\text{seats}) \text{ from } \text{slot\_hold} \text{ WHERE } \text{state} = \text{'HELD'}$.
   * *Engineering Rationale*: Under heavy concurrent ticketing (e.g. 500 users booking Taj Mahal night slots), recalculating $\sum(\text{seats})$ exhausts I/O buffers. Duplicating `seats_taken` allows PostgreSQL to serialize transactions using `SELECT ... FOR UPDATE` and enforce a declarative check:
     $$\text{CHECK } (\text{seats\_taken} \le \text{capacity\_total})$$
   * *Consistency Mechanism*: Trigger `trg_sync_capacity_slot_seats` automatically synchronizes the count on every hold insert/release.

2. **`leg_participant.span`**:
   * *Theoretical Derivation*: Span belongs in `itinerary_leg`.
   * *Engineering Rationale*: PostgreSQL's `EXCLUDE USING gist` constraint cannot perform joins across foreign relations. Duplicating `span` into `leg_participant` allows the database engine to build a Generalized Search Tree (GiST) to prevent traveler time-window overlap.
   * *Consistency Mechanism*: Maintained automatically by trigger `trg_sync_leg_participant`.

---

## SECTION 2: VALIDATION AND SECURITY

### 2.1 Database-Enforced Invariants (Storage Engine Layer)

Rather than relying on application code that can be bypassed or manipulated, critical constraints are enforced at the PostgreSQL kernel level:

| Invariant | Implementation Mechanism | Trigger / Constraint Name | Error Code |
|---|---|---|---|
| **1. Quorum Consent** | `DEFERRABLE INITIALLY DEFERRED` Constraint Trigger | `trg_enforce_trip_approval_quorum` | `SQLSTATE P0001` |
| **2. Concurrency / No Oversell** | `SELECT ... FOR UPDATE` Row Lock + `CHECK` | `trg_sync_capacity_slot_seats` + `chk_capacity_no_oversell` | `SQLSTATE 23514` |
| **3. Financial Zero-Sum** | Double-Entry Deferred Balance Trigger | `trg_enforce_zero_sum_ledger` | `SQLSTATE P0002` |
| **4. Traveler Overlap Prevention**| `EXCLUDE USING gist` (`btree_gist` extension) | `no_participant_overlap` | `SQLSTATE 23P01` |
| **5. Referential Integrity** | Declarative Foreign Keys | `ON DELETE RESTRICT` (users, pois) / `CASCADE` (constraints) | `SQLSTATE 23503` |

#### Detailed SQL Implementation of Key Rules:
* **Quorum Deferred Trigger**:
  ```sql
  CREATE CONSTRAINT TRIGGER trg_enforce_trip_approval_quorum
  AFTER UPDATE OF status ON trip
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_trip_quorum();
  ```
* **GiST Exclusion Constraint**:
  ```sql
  CONSTRAINT no_participant_overlap
  EXCLUDE USING gist (
      user_id WITH =,
      span WITH &&
  );
  ```

---

### 2.2 Application & API Security Layer

1. **Cryptographic Password Storage**:
   * Stored passwords use **PBKDF2-HMAC-SHA256** with **260,000 iterations** and a unique 12-byte cryptographically secure random salt generated via `os.urandom(12).hex()`.
   * Stored format: `pbkdf2:sha256:260000$<salt>$<derived_key>`.

2. **Constant-Time Verification (Timing Attack Defense)**:
   * Verification utilizes Python's native `hmac.compare_digest(dk, expected)` to ensure that string comparison time is invariant to character match position.

3. **Stateless JWT Authentication**:
   * Authenticated sessions use RFC 7519 JSON Web Tokens signed with **HMAC-SHA256**.
   * Payload validates issuer signature, user ID, and expiration timestamp (`exp`).

4. **100% Parameterized SQL Execution (SQL Injection Elimination)**:
   * Zero raw string formatting or string interpolation is permitted in the repository layer.
   * All queries execute via `psycopg` parameterized query interfaces:
     ```python
     cur.execute("SELECT * FROM app_user WHERE email = %s", (email,))
     ```

5. **Role-Based Access Control (RBAC)**:
   * `ORGANIZER`: Trip creation, publishing itinerary proposals, inviting members.
   * `MEMBER`: Casting votes, viewing itineraries, paying trip fractions.
   * `SITE_OPERATOR`: Publishing capacity-managed attraction slots, auditing holds.

---

## SECTION 3: PARTIAL OUTPUT OF THE PROJECT

### 3.1 Automated Invariant Test Execution Output (`pytest`)

Demonstrating automated validation of database constraints and security algorithms:

```text
$ cd backend && PYTHONPATH=. pytest tests/ -v
============================= test session starts ==============================
platform darwin -- Python 3.12.6, pytest-8.3.4, pluggy-1.6.0
rootdir: /Users/aryawadhwa/Desktop/projects/DBMS project/Yatra/backend
collected 7 items

tests/test_unit_logic.py::test_password_hashing_and_verification PASSED  [ 14%]
tests/test_unit_logic.py::test_jwt_roundtrip PASSED                      [ 28%]
tests/test_unit_logic.py::test_greedy_settlement_balances_to_zero PASSED [ 42%]
tests/test_db_invariants.py::test_rule1_deferred_quorum_blocks_unapproved_itinerary PASSED [ 57%]
tests/test_db_invariants.py::test_rule2_no_overselling_capacity_slot PASSED [ 71%]
tests/test_db_invariants.py::test_rule3_deferred_balanced_ledger_blocks_unbalanced_expense PASSED [ 85%]
tests/test_db_invariants.py::test_rule4_gist_exclusion_blocks_overlapping_leg_participant PASSED [100%]

============================== 7 passed in 1.12s ===============================
```

---

### 3.2 Database Constraint Violation Error Output

When the AI agent or an unauthorized user attempts to insert overlapping activities for the same traveler, PostgreSQL rejects the transaction with code `23P01`:

```text
ERROR:  conflicting key value violates exclusion constraint "no_participant_overlap"
DETAIL: Key (user_id, span)=(2, ["2026-12-20 18:00:00+05:30","2026-12-20 21:00:00+05:30")) 
        conflicts with existing key (user_id, span)=(2, ["2026-12-20 17:30:00+05:30","2026-12-20 19:30:00+05:30")).
SQLSTATE: 23P01
STATEMENT: INSERT INTO leg_participant (leg_id, user_id) VALUES (103, 2);
```

---

### 3.3 REST API JSON Output: Distributed Saga Execution (`POST /api/saga/execute`)

Demonstrates atomic multi-step execution across inventory, payment gateway, and third-party vendors:

```json
{
  "success": true,
  "trip_id": 1,
  "saga": {
    "saga_id": 104,
    "itinerary_id": 1,
    "itinerary_version": 1,
    "state": "CONFIRMED",
    "created_at": "2026-11-22T19:42:15.824Z",
    "finished_at": "2026-11-22T19:42:16.291Z"
  },
  "steps": [
    {
      "step_id": 412,
      "seq": 1,
      "step_type": "HOLD_SLOT",
      "state": "COMPLETED",
      "supplier_ref": "hold_slot_101",
      "error_message": null
    },
    {
      "step_id": 413,
      "seq": 2,
      "step_type": "CHARGE_PAYMENT",
      "state": "COMPLETED",
      "supplier_ref": "pay_rzp_MzJ9xyz456",
      "amount_inr": 16800.00,
      "error_message": null
    },
    {
      "step_id": 414,
      "seq": 3,
      "step_type": "BOOK_HOTEL",
      "state": "COMPLETED",
      "supplier_ref": "liteapi_res_4829",
      "error_message": null
    },
    {
      "step_id": 415,
      "seq": 4,
      "step_type": "BOOK_FLIGHT",
      "state": "COMPLETED",
      "supplier_ref": "duffel_ord_8819",
      "error_message": null
    }
  ],
  "rolled_back": false,
  "failure_reason": null
}
```

---

### 3.4 User Interface Workflow Output (Active Prototype)

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│  यात्रा Yatra · Smart Group Tourism Management System                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  TRIP: Goa & Hampi Heritage 2026 (Dec 20 – 22) · 3 Travelers               │
│                                                                             │
│  QUORUM STATUS: [████████████████████████████░░░░] 66.7% (2 / 3 Votes YES)  │
│  • Aarush Luthra (1RV24CI004)  ── [✅ Voted YES]                            │
│  • Arya Wadhwa   (1RV24CI023)  ── [✅ Voted YES]                            │
│  • Dilraj Singh  (1RV24CI032)  ── [⏳ Pending Vote]                         │
│                                                                             │
│  DOUBLE-ENTRY LEDGER BALANCE:                                               │
│  • Total Debits:  ₹16,800.00                                                │
│  • Total Credits: ₹16,800.00                                                │
│  • Net Balance:   ₹0.00 [✅ Invariant Verified: Σ = 0]                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  RAZORPAY CHECKOUT MODAL (POPUP ACTIVE):                                    │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ YATRA PAYMENT GATEWAY · RAZORPAY TEST MODE                            │  │
│  │ Amount Payable: ₹16,800.00 (All 3 Members Included)                   │  │
│  │                                                                       │  │
│  │ [●] UPI / QR (Instant - GPay, PhonePe, Paytm, BHIM)                   │  │
│  │ [ ] Cards (Visa, MasterCard, RuPay)                                   │  │
│  │ [ ] Net Banking (All Indian Banks Supported)                          │  │
│  │                                                                       │  │
│  │ 🔒 PostgreSQL row lock SELECT ... FOR UPDATE active on capacity slots │  │
│  │                                                                       │  │
│  │ [ ✅ Authorize Payment ]           [ ❌ Simulate Card Decline ]       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

