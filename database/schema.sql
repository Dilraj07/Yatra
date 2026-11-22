-- =============================================================================
-- Yatra — Smart Group Tourism Management System
-- RV College of Engineering | Dept. of CSE (AIML) | DBMS (CD252IA)
-- PostgreSQL 16 Schema (3NF / BCNF) with Database-Enforced Invariants
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- GROUP 1: People and Trips
-- -----------------------------------------------------------------------------

CREATE TABLE app_user (
    user_id       BIGSERIAL PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    full_name     TEXT NOT NULL,
    home_city     TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE trip (
    trip_id       BIGSERIAL PRIMARY KEY,
    organizer_id  BIGINT NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
    title         TEXT NOT NULL,
    travel_window DATERANGE NOT NULL,
    quorum_pct    INTEGER NOT NULL DEFAULT 60 CHECK (quorum_pct BETWEEN 1 AND 100),
    status        TEXT NOT NULL DEFAULT 'PROPOSED'
                  CHECK (status IN ('PROPOSED', 'APPROVED', 'PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (NOT isempty(travel_window))
);

CREATE TABLE trip_member (
    trip_id        BIGINT NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
    user_id        BIGINT NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
    role           TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('ORGANIZER', 'MEMBER')),
    budget_ceiling NUMERIC(12, 2) NOT NULL CHECK (budget_ceiling >= 0),
    joining_city   TEXT NOT NULL,
    joined_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (trip_id, user_id)
);

CREATE TABLE member_constraint (
    constraint_id BIGSERIAL PRIMARY KEY,
    trip_id       BIGINT NOT NULL,
    user_id       BIGINT NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('DIET', 'MOBILITY', 'DEPARTURE_TIME', 'PACE', 'BUDGET', 'OTHER')),
    value         JSONB NOT NULL,
    is_hard       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (trip_id, user_id) REFERENCES trip_member(trip_id, user_id) ON DELETE CASCADE
);

-- -----------------------------------------------------------------------------
-- GROUP 2: Supply Side (Capacity-Managed Inventory)
-- -----------------------------------------------------------------------------

CREATE TABLE supplier (
    supplier_id BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    kind        TEXT NOT NULL CHECK (kind IN ('SITE_OPERATOR', 'FLIGHT_API', 'HOTEL_API')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE poi (
    poi_id           BIGSERIAL PRIMARY KEY,
    supplier_id      BIGINT REFERENCES supplier(supplier_id) ON DELETE SET NULL,
    name             TEXT NOT NULL,
    city             TEXT NOT NULL,
    lat              DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lon              DOUBLE PRECISION NOT NULL CHECK (lon BETWEEN -180 AND 180),
    capacity_managed BOOLEAN NOT NULL DEFAULT FALSE,
    description      TEXT NOT NULL DEFAULT ''
);

CREATE TABLE capacity_slot (
    slot_id        BIGSERIAL PRIMARY KEY,
    poi_id         BIGINT NOT NULL REFERENCES poi(poi_id) ON DELETE CASCADE,
    circuit        TEXT NOT NULL,
    entry_window   TSTZRANGE NOT NULL,
    capacity_total INTEGER NOT NULL CHECK (capacity_total > 0),
    seats_taken    INTEGER NOT NULL DEFAULT 0,
    price_inr      NUMERIC(12, 2) NOT NULL CHECK (price_inr >= 0),
    CHECK (NOT isempty(entry_window)),
    -- ENFORCED RULE #2: No overselling via declarative CHECK
    CONSTRAINT chk_capacity_no_oversell CHECK (seats_taken >= 0 AND seats_taken <= capacity_total),
    -- Prevent overlapping slot windows for the same POI and circuit
    CONSTRAINT excl_capacity_slot_window EXCLUDE USING gist (
        poi_id WITH =,
        circuit WITH =,
        entry_window WITH &&
    )
);

-- -----------------------------------------------------------------------------
-- GROUP 3: Itinerary and Group Decisions
-- -----------------------------------------------------------------------------

CREATE TABLE itinerary (
    itinerary_id BIGSERIAL PRIMARY KEY,
    trip_id      BIGINT NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
    version      INTEGER NOT NULL CHECK (version > 0),
    status       TEXT NOT NULL DEFAULT 'DRAFT'
                 CHECK (status IN ('DRAFT', 'PROPOSED', 'APPROVED', 'CONFIRMED', 'REJECTED')),
    summary      TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (trip_id, version)
);

-- Partial unique index: at most one CONFIRMED itinerary per trip
CREATE UNIQUE INDEX uq_itinerary_one_confirmed_per_trip
    ON itinerary (trip_id)
    WHERE status = 'CONFIRMED';

CREATE TABLE itinerary_leg (
    leg_id        BIGSERIAL PRIMARY KEY,
    itinerary_id  BIGINT NOT NULL REFERENCES itinerary(itinerary_id) ON DELETE CASCADE,
    poi_id        BIGINT REFERENCES poi(poi_id) ON DELETE SET NULL,
    slot_id       BIGINT REFERENCES capacity_slot(slot_id) ON DELETE SET NULL,
    seq           INTEGER NOT NULL CHECK (seq > 0),
    kind          TEXT NOT NULL CHECK (kind IN ('FLIGHT', 'HOTEL', 'ATTRACTION', 'TRANSFER', 'ACTIVITY')),
    title         TEXT NOT NULL,
    span          TSTZRANGE NOT NULL,
    est_cost_inr  NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (est_cost_inr >= 0),
    supplier_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    CHECK (NOT isempty(span)),
    UNIQUE (itinerary_id, seq)
);

CREATE TABLE leg_participant (
    leg_id       BIGINT NOT NULL REFERENCES itinerary_leg(leg_id) ON DELETE CASCADE,
    user_id      BIGINT NOT NULL,
    trip_id      BIGINT NOT NULL,
    itinerary_id BIGINT NOT NULL REFERENCES itinerary(itinerary_id) ON DELETE CASCADE,
    span         TSTZRANGE NOT NULL,
    PRIMARY KEY (leg_id, user_id),
    FOREIGN KEY (trip_id, user_id) REFERENCES trip_member(trip_id, user_id) ON DELETE CASCADE,
    -- ENFORCED RULE #4: No double-booking per traveller within an itinerary
    CONSTRAINT excl_leg_participant_no_overlap EXCLUDE USING gist (
        itinerary_id WITH =,
        user_id WITH =,
        span WITH &&
    )
);

CREATE TABLE slot_hold (
    hold_id    BIGSERIAL PRIMARY KEY,
    slot_id    BIGINT NOT NULL REFERENCES capacity_slot(slot_id) ON DELETE RESTRICT,
    leg_id     BIGINT REFERENCES itinerary_leg(leg_id) ON DELETE SET NULL,
    seats      INTEGER NOT NULL CHECK (seats > 0),
    state      TEXT NOT NULL DEFAULT 'HELD'
               CHECK (state IN ('HELD', 'CONFIRMED', 'RELEASED', 'EXPIRED')),
    held_until TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE proposal (
    proposal_id   BIGSERIAL PRIMARY KEY,
    trip_id       BIGINT NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
    itinerary_id  BIGINT NOT NULL REFERENCES itinerary(itinerary_id) ON DELETE CASCADE,
    raised_by     BIGINT NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
    voting_window TSTZRANGE NOT NULL DEFAULT tstzrange(NOW(), NOW() + INTERVAL '72 hours'),
    status        TEXT NOT NULL DEFAULT 'OPEN'
                  CHECK (status IN ('OPEN', 'PASSED', 'FAILED', 'EXPIRED')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE vote (
    proposal_id BIGINT NOT NULL REFERENCES proposal(proposal_id) ON DELETE CASCADE,
    user_id     BIGINT NOT NULL,
    trip_id     BIGINT NOT NULL,
    choice      TEXT NOT NULL CHECK (choice IN ('APPROVE', 'REJECT', 'ABSTAIN')),
    cast_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (proposal_id, user_id),
    FOREIGN KEY (trip_id, user_id) REFERENCES trip_member(trip_id, user_id) ON DELETE CASCADE
);

-- -----------------------------------------------------------------------------
-- GROUP 4: Booking Saga
-- -----------------------------------------------------------------------------

CREATE TABLE booking_saga (
    saga_id      BIGSERIAL PRIMARY KEY,
    itinerary_id BIGINT NOT NULL UNIQUE REFERENCES itinerary(itinerary_id) ON DELETE RESTRICT,
    state        TEXT NOT NULL DEFAULT 'INITIATED'
                 CHECK (state IN (
                     'INITIATED', 'HOLDING_SLOTS', 'BOOKING_SUPPLIERS',
                     'AWAITING_PAYMENT', 'CONFIRMED', 'COMPENSATING',
                     'ROLLED_BACK', 'FAILED'
                 )),
    started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at  TIMESTAMPTZ
);

CREATE TABLE saga_step (
    step_id         BIGSERIAL PRIMARY KEY,
    saga_id         BIGINT NOT NULL REFERENCES booking_saga(saga_id) ON DELETE CASCADE,
    leg_id          BIGINT REFERENCES itinerary_leg(leg_id) ON DELETE SET NULL,
    seq             INTEGER NOT NULL CHECK (seq > 0),
    step_type       TEXT NOT NULL CHECK (step_type IN ('HOLD_SLOT', 'BOOK_FLIGHT', 'BOOK_HOTEL', 'COLLECT_PAYMENT')),
    state           TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (state IN ('PENDING', 'COMPLETED', 'FAILED', 'COMPENSATED')),
    attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    idempotency_key TEXT NOT NULL UNIQUE,
    supplier_ref    TEXT,
    error_message   TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (saga_id, seq)
);

-- -----------------------------------------------------------------------------
-- GROUP 5: Money (Double-Entry Ledger & Payments)
-- -----------------------------------------------------------------------------

CREATE TABLE expense (
    expense_id  BIGSERIAL PRIMARY KEY,
    trip_id     BIGINT NOT NULL,
    payer_id    BIGINT NOT NULL,
    leg_id      BIGINT REFERENCES itinerary_leg(leg_id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    amount      NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    currency    VARCHAR(3) NOT NULL DEFAULT 'INR',
    fx_to_inr   NUMERIC(12, 6) NOT NULL DEFAULT 1.000000 CHECK (fx_to_inr > 0),
    rule        TEXT NOT NULL DEFAULT 'EQUAL' CHECK (rule IN ('EQUAL', 'EXACT', 'SHARES', 'PERCENTAGE')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (trip_id, payer_id) REFERENCES trip_member(trip_id, user_id) ON DELETE RESTRICT
);

CREATE TABLE ledger_entry (
    entry_id   BIGSERIAL PRIMARY KEY,
    expense_id BIGINT NOT NULL REFERENCES expense(expense_id) ON DELETE CASCADE,
    trip_id    BIGINT NOT NULL,
    user_id    BIGINT NOT NULL,
    amount_inr NUMERIC(12, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (trip_id, user_id) REFERENCES trip_member(trip_id, user_id) ON DELETE RESTRICT
);

CREATE TABLE payment (
    payment_id          BIGSERIAL PRIMARY KEY,
    trip_id             BIGINT NOT NULL,
    user_id             BIGINT NOT NULL,
    saga_id             BIGINT REFERENCES booking_saga(saga_id) ON DELETE SET NULL,
    razorpay_order_id   TEXT NOT NULL UNIQUE,
    razorpay_payment_id TEXT,
    amount_inr          NUMERIC(12, 2) NOT NULL CHECK (amount_inr > 0),
    status              TEXT NOT NULL DEFAULT 'CREATED'
                        CHECK (status IN ('CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (trip_id, user_id) REFERENCES trip_member(trip_id, user_id) ON DELETE RESTRICT
);

-- -----------------------------------------------------------------------------
-- MONTH-PARTITIONED AUDIT LOG (Before/After JSONB images)
-- -----------------------------------------------------------------------------

CREATE TABLE audit_log (
    audit_id   BIGSERIAL,
    table_name TEXT NOT NULL,
    operation  TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
    row_pk     TEXT NOT NULL,
    before_img JSONB,
    after_img  JSONB,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (audit_id, changed_at)
) PARTITION BY RANGE (changed_at);

CREATE TABLE audit_log_2026_10 PARTITION OF audit_log
    FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');

CREATE TABLE audit_log_2026_11 PARTITION OF audit_log
    FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');

CREATE TABLE audit_log_2026_12 PARTITION OF audit_log
    FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');

CREATE TABLE audit_log_2027_01 PARTITION OF audit_log
    FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2027-02-01 00:00:00+00');

CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT;

-- =============================================================================
-- TRIGGERS & ENFORCED INVARIANTS
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_sync_leg_participant()
RETURNS TRIGGER AS $$
DECLARE
    v_itinerary_id BIGINT;
    v_trip_id      BIGINT;
    v_span         TSTZRANGE;
BEGIN
    SELECT il.itinerary_id, i.trip_id, il.span
      INTO v_itinerary_id, v_trip_id, v_span
      FROM itinerary_leg il
      JOIN itinerary i ON i.itinerary_id = il.itinerary_id
     WHERE il.leg_id = NEW.leg_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Itinerary leg % does not exist', NEW.leg_id;
    END IF;

    NEW.itinerary_id := v_itinerary_id;
    NEW.trip_id      := v_trip_id;
    NEW.span         := v_span;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_leg_participant
BEFORE INSERT OR UPDATE OF leg_id ON leg_participant
FOR EACH ROW EXECUTE FUNCTION fn_sync_leg_participant();

CREATE OR REPLACE FUNCTION fn_propagate_leg_span()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.span IS DISTINCT FROM OLD.span THEN
        UPDATE leg_participant
           SET span = NEW.span
         WHERE leg_id = NEW.leg_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_propagate_leg_span
AFTER UPDATE OF span ON itinerary_leg
FOR EACH ROW EXECUTE FUNCTION fn_propagate_leg_span();

CREATE OR REPLACE FUNCTION fn_sync_capacity_slot_seats()
RETURNS TRIGGER AS $$
DECLARE
    v_delta INTEGER := 0;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.state IN ('HELD', 'CONFIRMED') THEN
            v_delta := NEW.seats;
        END IF;
        IF v_delta <> 0 THEN
            PERFORM 1 FROM capacity_slot WHERE slot_id = NEW.slot_id FOR UPDATE;
            UPDATE capacity_slot
               SET seats_taken = seats_taken + v_delta
             WHERE slot_id = NEW.slot_id;
        END IF;
        RETURN NEW;

    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.state IN ('HELD', 'CONFIRMED') AND NEW.state IN ('RELEASED', 'EXPIRED') THEN
            v_delta := -OLD.seats;
        ELSIF OLD.state IN ('RELEASED', 'EXPIRED') AND NEW.state IN ('HELD', 'CONFIRMED') THEN
            v_delta := NEW.seats;
        ELSIF OLD.state IN ('HELD', 'CONFIRMED') AND NEW.state IN ('HELD', 'CONFIRMED') AND OLD.seats <> NEW.seats THEN
            v_delta := NEW.seats - OLD.seats;
        END IF;

        IF v_delta <> 0 THEN
            PERFORM 1 FROM capacity_slot WHERE slot_id = NEW.slot_id FOR UPDATE;
            UPDATE capacity_slot
               SET seats_taken = seats_taken + v_delta
             WHERE slot_id = NEW.slot_id;
        END IF;
        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.state IN ('HELD', 'CONFIRMED') THEN
            PERFORM 1 FROM capacity_slot WHERE slot_id = OLD.slot_id FOR UPDATE;
            UPDATE capacity_slot
               SET seats_taken = seats_taken - OLD.seats
             WHERE slot_id = OLD.slot_id;
        END IF;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_capacity_slot_seats
AFTER INSERT OR UPDATE OF state, seats OR DELETE ON slot_hold
FOR EACH ROW EXECUTE FUNCTION fn_sync_capacity_slot_seats();

CREATE OR REPLACE FUNCTION fn_enforce_itinerary_quorum()
RETURNS TRIGGER AS $$
DECLARE
    v_member_count   INTEGER;
    v_quorum_pct     INTEGER;
    v_required_votes INTEGER;
    v_approve_votes  INTEGER;
BEGIN
    IF NEW.status IN ('APPROVED', 'CONFIRMED') THEN
        SELECT t.quorum_pct, COUNT(tm.user_id)
          INTO v_quorum_pct, v_member_count
          FROM trip t
          JOIN trip_member tm ON tm.trip_id = t.trip_id
         WHERE t.trip_id = NEW.trip_id
         GROUP BY t.quorum_pct;

        IF v_member_count IS NULL OR v_member_count = 0 THEN
            RAISE EXCEPTION 'QUORUM_NOT_MET: Trip % has no members', NEW.trip_id
                USING ERRCODE = 'P0001';
        END IF;

        v_required_votes := CEIL((v_member_count::NUMERIC * v_quorum_pct::NUMERIC) / 100.0);

        SELECT COALESCE(MAX(approve_cnt), 0)
          INTO v_approve_votes
          FROM (
              SELECT p.proposal_id, COUNT(v.user_id) AS approve_cnt
                FROM proposal p
                LEFT JOIN vote v
                  ON v.proposal_id = p.proposal_id
                 AND v.choice = 'APPROVE'
               WHERE p.itinerary_id = NEW.itinerary_id
               GROUP BY p.proposal_id
          ) sub;

        IF v_approve_votes < v_required_votes THEN
            RAISE EXCEPTION 'QUORUM_NOT_MET: Itinerary % requires % approve votes (% pct of % members), found %',
                NEW.itinerary_id, v_required_votes, v_quorum_pct, v_member_count, v_approve_votes
                USING ERRCODE = 'P0001';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_enforce_itinerary_quorum
AFTER INSERT OR UPDATE OF status ON itinerary
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION fn_enforce_itinerary_quorum();

CREATE OR REPLACE FUNCTION fn_validate_vote_trip()
RETURNS TRIGGER AS $$
DECLARE
    v_trip_id BIGINT;
BEGIN
    SELECT trip_id INTO v_trip_id FROM proposal WHERE proposal_id = NEW.proposal_id;
    IF v_trip_id IS NULL THEN
        RAISE EXCEPTION 'Proposal % not found', NEW.proposal_id;
    END IF;
    NEW.trip_id := v_trip_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_vote_trip
BEFORE INSERT OR UPDATE ON vote
FOR EACH ROW EXECUTE FUNCTION fn_validate_vote_trip();

CREATE OR REPLACE FUNCTION fn_enforce_balanced_ledger()
RETURNS TRIGGER AS $$
DECLARE
    v_expense_id BIGINT;
    v_sum        NUMERIC(12, 2);
    v_count      INTEGER;
BEGIN
    v_expense_id := COALESCE(NEW.expense_id, OLD.expense_id);

    IF NOT EXISTS (SELECT 1 FROM expense WHERE expense_id = v_expense_id) THEN
        RETURN NULL;
    END IF;

    SELECT COALESCE(SUM(amount_inr), 0), COUNT(*)
      INTO v_sum, v_count
      FROM ledger_entry
     WHERE expense_id = v_expense_id;

    IF v_count = 0 OR v_sum <> 0 THEN
        RAISE EXCEPTION 'LEDGER_UNBALANCED: Expense % ledger entries sum to % INR (must equal 0.00 across >=1 entries)',
            v_expense_id, v_sum
            USING ERRCODE = 'P0002';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_enforce_balanced_ledger_on_entry
AFTER INSERT OR UPDATE OR DELETE ON ledger_entry
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION fn_enforce_balanced_ledger();

CREATE CONSTRAINT TRIGGER trg_enforce_balanced_ledger_on_expense
AFTER INSERT ON expense
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION fn_enforce_balanced_ledger();

CREATE OR REPLACE FUNCTION fn_write_audit_log()
RETURNS TRIGGER AS $$
DECLARE
    v_pk TEXT;
BEGIN
    IF TG_TABLE_NAME = 'slot_hold' THEN
        v_pk := COALESCE(NEW.hold_id, OLD.hold_id)::TEXT;
    ELSIF TG_TABLE_NAME = 'saga_step' THEN
        v_pk := COALESCE(NEW.step_id, OLD.step_id)::TEXT;
    ELSE
        v_pk := 'unknown';
    END IF;

    INSERT INTO audit_log (table_name, operation, row_pk, before_img, after_img, changed_at)
    VALUES (
        TG_TABLE_NAME,
        TG_OP,
        v_pk,
        CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
        CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
        NOW()
    );
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_slot_hold
AFTER INSERT OR UPDATE OR DELETE ON slot_hold
FOR EACH ROW EXECUTE FUNCTION fn_write_audit_log();

CREATE TRIGGER trg_audit_saga_step
AFTER INSERT OR UPDATE OR DELETE ON saga_step
FOR EACH ROW EXECUTE FUNCTION fn_write_audit_log();

-- =============================================================================
-- VIEWS & INDEXES
-- =============================================================================

CREATE OR REPLACE VIEW member_balance AS
SELECT
    tm.trip_id,
    tm.user_id,
    u.full_name,
    u.email,
    COALESCE(SUM(le.amount_inr), 0.00)::NUMERIC(12, 2) AS net_balance_inr
FROM trip_member tm
JOIN app_user u ON u.user_id = tm.user_id
LEFT JOIN ledger_entry le
       ON le.trip_id = tm.trip_id
      AND le.user_id = tm.user_id
GROUP BY tm.trip_id, tm.user_id, u.full_name, u.email;

CREATE OR REPLACE VIEW slot_availability AS
SELECT
    cs.slot_id,
    cs.poi_id,
    p.name AS poi_name,
    p.city,
    s.name AS supplier_name,
    cs.circuit,
    lower(cs.entry_window) AS window_start,
    upper(cs.entry_window) AS window_end,
    cs.capacity_total,
    cs.seats_taken,
    (cs.capacity_total - cs.seats_taken) AS seats_remaining,
    cs.price_inr
FROM capacity_slot cs
JOIN poi p ON p.poi_id = cs.poi_id
LEFT JOIN supplier s ON s.supplier_id = p.supplier_id;

CREATE INDEX idx_trip_member_user ON trip_member(user_id);
CREATE INDEX idx_itinerary_trip ON itinerary(trip_id);
CREATE INDEX idx_itinerary_leg_itinerary ON itinerary_leg(itinerary_id);
CREATE INDEX idx_slot_hold_slot_state ON slot_hold(slot_id, state);
CREATE INDEX idx_ledger_entry_trip_user ON ledger_entry(trip_id, user_id);
CREATE INDEX idx_audit_log_table_time ON audit_log(table_name, changed_at DESC);
