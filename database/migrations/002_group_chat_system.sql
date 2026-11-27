-- =============================================================================
-- Migration 002: Real-Time Group Chat, Operations Agent & Task Integration
-- Integrates directly with existing app_user, trip, trip_member, itinerary,
-- itinerary_leg, and proposal tables without duplicating core domain models.
-- =============================================================================

ALTER TABLE app_user ADD COLUMN IF NOT EXISTS avatar_url TEXT NOT NULL DEFAULT '';
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- -----------------------------------------------------------------------------
-- 1. Conversations & Group Management
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_conversation (
    conversation_id BIGSERIAL PRIMARY KEY,
    trip_id         BIGINT REFERENCES trip(trip_id) ON DELETE CASCADE,
    kind            TEXT NOT NULL DEFAULT 'GROUP'
                    CHECK (kind IN ('TRIP_GROUP', 'GROUP', 'DIRECT')),
    direct_pair_key TEXT UNIQUE,
    title           TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    avatar_url      TEXT NOT NULL DEFAULT '',
    created_by      BIGINT REFERENCES app_user(user_id) ON DELETE SET NULL,
    agent_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
    agent_mode      TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK (agent_mode IN ('ACTIVE', 'OBSERVE', 'OFF')),
    retention_days  INTEGER NOT NULL DEFAULT 365 CHECK (retention_days > 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_conv_trip_group
    ON chat_conversation (trip_id)
    WHERE kind = 'TRIP_GROUP' AND trip_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_member (
    conversation_id      BIGINT NOT NULL REFERENCES chat_conversation(conversation_id) ON DELETE CASCADE,
    user_id              BIGINT NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    role                 TEXT NOT NULL DEFAULT 'MEMBER'
                         CHECK (role IN ('OWNER', 'ADMIN', 'MODERATOR', 'MEMBER')),
    can_send             BOOLEAN NOT NULL DEFAULT TRUE,
    can_manage_members   BOOLEAN NOT NULL DEFAULT FALSE,
    can_configure_agent  BOOLEAN NOT NULL DEFAULT FALSE,
    last_read_message_id BIGINT,
    muted                BOOLEAN NOT NULL DEFAULT FALSE,
    joined_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_member_user ON chat_member(user_id);

CREATE TABLE IF NOT EXISTS chat_membership_event (
    event_id        BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES chat_conversation(conversation_id) ON DELETE CASCADE,
    actor_user_id   BIGINT REFERENCES app_user(user_id) ON DELETE SET NULL,
    target_user_id  BIGINT REFERENCES app_user(user_id) ON DELETE SET NULL,
    event_type      TEXT NOT NULL,
    details         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_membership_event_conv
    ON chat_membership_event(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_invitation (
    invitation_id   BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES chat_conversation(conversation_id) ON DELETE CASCADE,
    invited_by      BIGINT NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    invited_user_id BIGINT REFERENCES app_user(user_id) ON DELETE CASCADE,
    invite_code     TEXT NOT NULL UNIQUE,
    role            TEXT NOT NULL DEFAULT 'MEMBER'
                    CHECK (role IN ('ADMIN', 'MODERATOR', 'MEMBER')),
    status          TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'REVOKED', 'EXPIRED')),
    max_uses        INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
    uses_count      INTEGER NOT NULL DEFAULT 0 CHECK (uses_count >= 0),
    expires_at      TIMESTAMPTZ,
    responded_by    BIGINT REFERENCES app_user(user_id) ON DELETE SET NULL,
    responded_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_invitation_user_status
    ON chat_invitation(invited_user_id, status);

-- -----------------------------------------------------------------------------
-- 2. Persistent Messages, Threading, Attachments, Receipts, Pins & Bookmarks
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_message (
    message_id                BIGSERIAL PRIMARY KEY,
    conversation_id           BIGINT NOT NULL REFERENCES chat_conversation(conversation_id) ON DELETE CASCADE,
    sender_id                 BIGINT REFERENCES app_user(user_id) ON DELETE SET NULL,
    sender_name               TEXT NOT NULL,
    sender_type               TEXT NOT NULL DEFAULT 'USER'
                              CHECK (sender_type IN ('USER', 'AGENT', 'SYSTEM')),
    message_type              TEXT NOT NULL DEFAULT 'TEXT'
                              CHECK (message_type IN ('TEXT', 'SYSTEM', 'AGENT_PROPOSAL', 'PLAN_SUMMARY', 'ATTACHMENT')),
    body                      TEXT NOT NULL,
    reply_to_message_id       BIGINT REFERENCES chat_message(message_id) ON DELETE SET NULL,
    thread_root_id            BIGINT REFERENCES chat_message(message_id) ON DELETE SET NULL,
    forwarded_from_message_id BIGINT REFERENCES chat_message(message_id) ON DELETE SET NULL,
    mentions_json             JSONB NOT NULL DEFAULT '[]'::jsonb,
    attachments_json          JSONB NOT NULL DEFAULT '[]'::jsonb,
    agent_metadata_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_edited                 BOOLEAN NOT NULL DEFAULT FALSE,
    edited_at                 TIMESTAMPTZ,
    is_deleted                BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at                TIMESTAMPTZ,
    deleted_by                BIGINT REFERENCES app_user(user_id) ON DELETE SET NULL,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_message_conv_id
    ON chat_message(conversation_id, message_id ASC);
CREATE INDEX IF NOT EXISTS idx_chat_message_thread
    ON chat_message(thread_root_id, message_id ASC)
    WHERE thread_root_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_attachment (
    attachment_id   BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES chat_conversation(conversation_id) ON DELETE CASCADE,
    uploaded_by     BIGINT NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    file_name       TEXT NOT NULL,
    content_type    TEXT NOT NULL,
    size_bytes      BIGINT NOT NULL CHECK (size_bytes >= 0),
    storage_path    TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_message_receipt (
    message_id   BIGINT NOT NULL REFERENCES chat_message(message_id) ON DELETE CASCADE,
    user_id      BIGINT NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at      TIMESTAMPTZ,
    PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_receipt_user_unread
    ON chat_message_receipt(user_id, read_at)
    WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS chat_message_pin (
    conversation_id BIGINT NOT NULL REFERENCES chat_conversation(conversation_id) ON DELETE CASCADE,
    message_id      BIGINT NOT NULL REFERENCES chat_message(message_id) ON DELETE CASCADE,
    pinned_by       BIGINT REFERENCES app_user(user_id) ON DELETE SET NULL,
    pinned_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (conversation_id, message_id)
);

CREATE TABLE IF NOT EXISTS chat_message_bookmark (
    user_id    BIGINT NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    message_id BIGINT NOT NULL REFERENCES chat_message(message_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, message_id)
);

-- -----------------------------------------------------------------------------
-- 3. AI Agent Tasks (Connected to Trip, Itinerary, Itinerary Leg & Proposal)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_task (
    task_id              BIGSERIAL PRIMARY KEY,
    conversation_id      BIGINT NOT NULL REFERENCES chat_conversation(conversation_id) ON DELETE CASCADE,
    source_message_id    BIGINT REFERENCES chat_message(message_id) ON DELETE SET NULL,
    trip_id              BIGINT REFERENCES trip(trip_id) ON DELETE CASCADE,
    itinerary_id         BIGINT REFERENCES itinerary(itinerary_id) ON DELETE SET NULL,
    linked_leg_id        BIGINT REFERENCES itinerary_leg(leg_id) ON DELETE SET NULL,
    linked_proposal_id   BIGINT REFERENCES proposal(proposal_id) ON DELETE SET NULL,
    title                TEXT NOT NULL,
    description          TEXT NOT NULL DEFAULT '',
    assigned_to_user_id  BIGINT REFERENCES app_user(user_id) ON DELETE SET NULL,
    assigned_to_agent    BOOLEAN NOT NULL DEFAULT FALSE,
    created_by_user_id   BIGINT REFERENCES app_user(user_id) ON DELETE SET NULL,
    proposed_by_agent    BOOLEAN NOT NULL DEFAULT FALSE,
    priority             TEXT NOT NULL DEFAULT 'MEDIUM'
                         CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
    status               TEXT NOT NULL DEFAULT 'PROPOSED'
                         CHECK (status IN ('PROPOSED', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'REJECTED')),
    due_at               TIMESTAMPTZ,
    schedule_start       TIMESTAMPTZ,
    schedule_end         TIMESTAMPTZ,
    leg_kind             TEXT CHECK (leg_kind IN ('FLIGHT', 'HOTEL', 'ATTRACTION', 'TRANSFER', 'ACTIVITY')),
    est_cost_inr         NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (est_cost_inr >= 0),
    dependencies_json    JSONB NOT NULL DEFAULT '[]'::jsonb,
    reminder_at          TIMESTAMPTZ,
    reminder_sent        BOOLEAN NOT NULL DEFAULT FALSE,
    confirmed_by_user_id BIGINT REFERENCES app_user(user_id) ON DELETE SET NULL,
    confirmed_at         TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_task_conv_status
    ON chat_task(conversation_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_task_assignee
    ON chat_task(assigned_to_user_id, status);

-- -----------------------------------------------------------------------------
-- 4. AI Agent Audit Trail & Real-Time Notifications
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_agent_audit (
    audit_id              BIGSERIAL PRIMARY KEY,
    conversation_id       BIGINT NOT NULL REFERENCES chat_conversation(conversation_id) ON DELETE CASCADE,
    trigger_message_id    BIGINT REFERENCES chat_message(message_id) ON DELETE SET NULL,
    agent_mode            TEXT NOT NULL,
    classification        TEXT NOT NULL,
    summary               TEXT NOT NULL,
    recommendations_json  JSONB NOT NULL DEFAULT '[]'::jsonb,
    action_taken          TEXT NOT NULL DEFAULT 'LOGGED',
    authorized_by_user_id BIGINT REFERENCES app_user(user_id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_agent_audit_conv
    ON chat_agent_audit(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_notification (
    notification_id BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    conversation_id BIGINT REFERENCES chat_conversation(conversation_id) ON DELETE CASCADE,
    message_id      BIGINT REFERENCES chat_message(message_id) ON DELETE CASCADE,
    task_id         BIGINT REFERENCES chat_task(task_id) ON DELETE CASCADE,
    kind            TEXT NOT NULL,
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    is_read         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_notification_user_unread
    ON chat_notification(user_id, is_read, created_at DESC);

-- -----------------------------------------------------------------------------
-- 5. Triggers: Auto-sync Trip & Trip Members into Trip Group Conversations
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_trip_auto_chat_conversation()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO chat_conversation (trip_id, kind, title, description, created_by, agent_enabled, agent_mode)
    VALUES (
        NEW.trip_id,
        'TRIP_GROUP',
        NEW.title,
        'Trip collaboration group & AI operations channel',
        NEW.organizer_id,
        TRUE,
        'ACTIVE'
    )
    ON CONFLICT DO NOTHING;

    UPDATE chat_conversation
       SET title = NEW.title, updated_at = NOW()
     WHERE trip_id = NEW.trip_id AND kind = 'TRIP_GROUP';

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_trip_auto_chat_conversation ON trip;
CREATE TRIGGER trg_trip_auto_chat_conversation
AFTER INSERT OR UPDATE OF title ON trip
FOR EACH ROW EXECUTE FUNCTION fn_trip_auto_chat_conversation();

CREATE OR REPLACE FUNCTION fn_trip_member_sync_chat()
RETURNS TRIGGER AS $$
DECLARE
    v_conv_id BIGINT;
    v_role    TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        SELECT conversation_id INTO v_conv_id
          FROM chat_conversation
         WHERE trip_id = OLD.trip_id AND kind = 'TRIP_GROUP';
        IF v_conv_id IS NOT NULL THEN
            DELETE FROM chat_member WHERE conversation_id = v_conv_id AND user_id = OLD.user_id;
        END IF;
        RETURN OLD;
    END IF;

    SELECT conversation_id INTO v_conv_id
      FROM chat_conversation
     WHERE trip_id = NEW.trip_id AND kind = 'TRIP_GROUP';

    IF v_conv_id IS NULL THEN
        INSERT INTO chat_conversation (trip_id, kind, title, description, created_by)
        SELECT t.trip_id, 'TRIP_GROUP', t.title, 'Trip collaboration group & AI operations channel', t.organizer_id
          FROM trip t WHERE t.trip_id = NEW.trip_id
        ON CONFLICT DO NOTHING
        RETURNING conversation_id INTO v_conv_id;
    END IF;

    IF v_conv_id IS NOT NULL THEN
        v_role := CASE WHEN NEW.role = 'ORGANIZER' THEN 'OWNER' ELSE 'MEMBER' END;
        INSERT INTO chat_member (
            conversation_id, user_id, role, can_send, can_manage_members, can_configure_agent
        )
        VALUES (
            v_conv_id,
            NEW.user_id,
            v_role,
            TRUE,
            NEW.role = 'ORGANIZER',
            NEW.role = 'ORGANIZER'
        )
        ON CONFLICT (conversation_id, user_id) DO UPDATE
            SET role = CASE
                    WHEN chat_member.role IN ('ADMIN', 'MODERATOR') AND EXCLUDED.role = 'MEMBER' THEN chat_member.role
                    ELSE EXCLUDED.role
                END,
                can_manage_members = CASE
                    WHEN chat_member.role IN ('ADMIN') THEN TRUE
                    ELSE EXCLUDED.can_manage_members
                END,
                can_configure_agent = CASE
                    WHEN chat_member.role IN ('ADMIN') THEN TRUE
                    ELSE EXCLUDED.can_configure_agent
                END;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_trip_member_sync_chat ON trip_member;
CREATE TRIGGER trg_trip_member_sync_chat
AFTER INSERT OR UPDATE OF role OR DELETE ON trip_member
FOR EACH ROW EXECUTE FUNCTION fn_trip_member_sync_chat();

-- -----------------------------------------------------------------------------
-- 6. Backfill Existing Seeded Trips & Members Idempotently
-- -----------------------------------------------------------------------------
INSERT INTO chat_conversation (trip_id, kind, title, description, created_by, agent_enabled, agent_mode)
SELECT t.trip_id, 'TRIP_GROUP', t.title, 'Trip collaboration group & AI operations channel', t.organizer_id, TRUE, 'ACTIVE'
FROM trip t
WHERE NOT EXISTS (
    SELECT 1 FROM chat_conversation c WHERE c.trip_id = t.trip_id AND c.kind = 'TRIP_GROUP'
);

INSERT INTO chat_member (conversation_id, user_id, role, can_send, can_manage_members, can_configure_agent)
SELECT c.conversation_id,
       tm.user_id,
       CASE WHEN tm.role = 'ORGANIZER' THEN 'OWNER' ELSE 'MEMBER' END,
       TRUE,
       tm.role = 'ORGANIZER',
       tm.role = 'ORGANIZER'
FROM trip_member tm
JOIN chat_conversation c ON c.trip_id = tm.trip_id AND c.kind = 'TRIP_GROUP'
ON CONFLICT (conversation_id, user_id) DO NOTHING;

-- Seed initial welcome message only for conversations with zero messages
INSERT INTO chat_message (conversation_id, sender_id, sender_name, sender_type, message_type, body)
SELECT c.conversation_id,
       NULL,
       'Yatra Copilot',
       'AGENT',
       'TEXT',
       'Welcome to ' || c.title || '. Coordinate plans, @mention teammates, or assign tasks like "Assign hotel booking to Arya before Friday" and I will structure them into your trip plan.'
FROM chat_conversation c
WHERE c.kind = 'TRIP_GROUP'
  AND NOT EXISTS (SELECT 1 FROM chat_message m WHERE m.conversation_id = c.conversation_id);
