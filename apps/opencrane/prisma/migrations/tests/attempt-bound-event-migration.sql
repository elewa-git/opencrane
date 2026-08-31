BEGIN;

CREATE SCHEMA attempt_migration_fixture;
SET LOCAL search_path = attempt_migration_fixture, pg_catalog;

CREATE TYPE "AgentRunState" AS ENUM (
    'accepted', 'queued', 'assigned', 'running', 'waiting_for_input',
    'recovery_required', 'cancelling', 'completed', 'failed', 'cancelled'
);
CREATE TYPE "ChildRunCompletionDeliveryOutcome" AS ENUM (
    'delivered', 'no_parent_stream', 'parent_stream_terminal'
);
CREATE TYPE "ConversationLifecycle" AS ENUM ('open', 'closed');
CREATE TYPE "ConversationTimelineEntryKind" AS ENUM (
    'message', 'run_event', 'membership', 'system', 'parent_delivery'
);

CREATE TABLE "conversations" (
    "id" TEXT PRIMARY KEY,
    "lifecycle" "ConversationLifecycle" NOT NULL DEFAULT 'open',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activity_sequence" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL
);
CREATE TABLE "agent_runs" (
    "id" TEXT PRIMARY KEY,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "state" "AgentRunState" NOT NULL DEFAULT 'accepted',
    "conversation_id" TEXT,
    "parent_run_id" TEXT,
    "root_run_id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL
);
CREATE TABLE "conversation_run_events" (
    "conversation_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "message_id" TEXT,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_run_events_pkey" PRIMARY KEY ("run_id", "sequence"),
    CONSTRAINT "conversation_run_events_sequence_check" CHECK ("sequence" > 0)
);
CREATE UNIQUE INDEX "conversation_run_events_conversation_id_run_id_sequence_key"
    ON "conversation_run_events"("conversation_id", "run_id", "sequence");
CREATE INDEX "conversation_run_events_run_id_message_id_idx"
    ON "conversation_run_events"("run_id", "message_id");
CREATE UNIQUE INDEX "conversation_run_events_one_message_start"
    ON "conversation_run_events"("run_id", "message_id") WHERE "type" = 'message.started';

CREATE TABLE "child_run_reservations" (
    "child_run_id" TEXT PRIMARY KEY,
    "parent_run_id" TEXT NOT NULL,
    "root_run_id" TEXT NOT NULL
);
CREATE TABLE "child_run_completion_deliveries" (
    "child_run_id" TEXT NOT NULL,
    "parent_run_id" TEXT NOT NULL,
    "parent_event_sequence" INTEGER,
    "outcome" "ChildRunCompletionDeliveryOutcome" NOT NULL,
    "delivered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "child_run_completion_deliveries_pkey" PRIMARY KEY ("child_run_id")
);
CREATE INDEX "child_run_completion_deliveries_parent_run_id_idx"
    ON "child_run_completion_deliveries"("parent_run_id");

CREATE TABLE "conversation_timeline_entries" (
    "conversation_id" TEXT NOT NULL,
    "position" BIGINT NOT NULL DEFAULT 0,
    "kind" "ConversationTimelineEntryKind" NOT NULL,
    "message_id" TEXT,
    "run_id" TEXT,
    "run_event_sequence" INTEGER,
    "membership_event_id" TEXT,
    "participant_user_id" TEXT,
    "system_event_id" TEXT,
    "parent_delivery_child_run_id" TEXT,
    "parent_delivery_agent_thread_id" TEXT,
    "payload" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_timeline_entries_pkey" PRIMARY KEY ("conversation_id", "position"),
    CONSTRAINT "conversation_timeline_entries_reference_shape_check" CHECK (
        ("kind" = 'message' AND "message_id" IS NOT NULL AND "run_id" IS NULL AND "run_event_sequence" IS NULL
            AND "membership_event_id" IS NULL AND "participant_user_id" IS NULL AND "system_event_id" IS NULL
            AND "parent_delivery_child_run_id" IS NULL AND "parent_delivery_agent_thread_id" IS NULL AND "payload" IS NULL) OR
        ("kind" = 'run_event' AND "message_id" IS NULL AND "run_id" IS NOT NULL AND "run_event_sequence" IS NOT NULL
            AND "membership_event_id" IS NULL AND "participant_user_id" IS NULL AND "system_event_id" IS NULL
            AND "parent_delivery_child_run_id" IS NULL AND "parent_delivery_agent_thread_id" IS NULL AND "payload" IS NULL) OR
        ("kind" = 'membership' AND "message_id" IS NULL AND "run_id" IS NULL AND "run_event_sequence" IS NULL
            AND "membership_event_id" IS NOT NULL AND "participant_user_id" IS NOT NULL AND "system_event_id" IS NULL
            AND "parent_delivery_child_run_id" IS NULL AND "parent_delivery_agent_thread_id" IS NULL
            AND jsonb_typeof("payload") = 'object') OR
        ("kind" = 'system' AND "message_id" IS NULL AND "run_id" IS NULL AND "run_event_sequence" IS NULL
            AND "membership_event_id" IS NULL AND "participant_user_id" IS NULL AND "system_event_id" IS NOT NULL
            AND "parent_delivery_child_run_id" IS NULL AND "parent_delivery_agent_thread_id" IS NULL
            AND jsonb_typeof("payload") = 'object') OR
        ("kind" = 'parent_delivery' AND "message_id" IS NULL AND "run_id" IS NULL AND "run_event_sequence" IS NULL
            AND "membership_event_id" IS NULL AND "participant_user_id" IS NULL AND "system_event_id" IS NULL
            AND (("parent_delivery_child_run_id" IS NOT NULL AND "parent_delivery_agent_thread_id" IS NULL)
              OR ("parent_delivery_child_run_id" IS NULL AND "parent_delivery_agent_thread_id" IS NOT NULL))
            AND "payload" IS NULL)
    )
);
CREATE UNIQUE INDEX "conversation_timeline_entries_parent_delivery_child_run_id_key"
    ON "conversation_timeline_entries"("parent_delivery_child_run_id");
ALTER TABLE "conversation_timeline_entries"
    ADD CONSTRAINT "conversation_timeline_entries_parent_delivery_child_run_id_fkey"
    FOREIGN KEY ("parent_delivery_child_run_id") REFERENCES "child_run_completion_deliveries"("child_run_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "agent_thread_parent_deliveries" (
    "id" TEXT PRIMARY KEY,
    "parent_conversation_id" TEXT NOT NULL
);
CREATE TABLE "conversation_assets" (
    "id" TEXT PRIMARY KEY,
    "conversation_id" TEXT NOT NULL,
    "run_id" TEXT,
    "run_attempt" INTEGER,
    "run_event_sequence" INTEGER
);
CREATE TABLE "conversation_asset_output_tickets" (
    "id" TEXT PRIMARY KEY,
    "conversation_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "run_attempt" INTEGER NOT NULL,
    "run_event_sequence" INTEGER NOT NULL
);
ALTER TABLE "conversation_assets"
    ADD CONSTRAINT "conversation_assets_conversation_id_run_id_run_event_seque_fkey"
    FOREIGN KEY ("conversation_id", "run_id", "run_event_sequence")
    REFERENCES "conversation_run_events"("conversation_id", "run_id", "sequence")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversation_asset_output_tickets"
    ADD CONSTRAINT "conversation_asset_output_tickets_conversation_id_run_id_r_fkey"
    FOREIGN KEY ("conversation_id", "run_id", "run_event_sequence")
    REFERENCES "conversation_run_events"("conversation_id", "run_id", "sequence")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "reject_conversation_immutable_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'canonical conversation history is immutable';
END;
$$;
CREATE FUNCTION "enforce_conversation_run_event_append"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RETURN NEW;
END;
$$;
CREATE FUNCTION "append_conversation_run_event_timeline"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO "conversation_timeline_entries" (
        "conversation_id", "kind", "run_id", "run_event_sequence"
    ) VALUES (
        NEW."conversation_id", 'run_event', NEW."run_id", NEW."sequence"
    );
    RETURN NULL;
END;
$$;
CREATE FUNCTION "enforce_conversation_timeline_entry"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'ConversationTimelineEntry rows are append-only';
    END IF;
    SELECT COALESCE(max("position"), 0) + 1 INTO NEW."position"
    FROM "conversation_timeline_entries"
    WHERE "conversation_id" = NEW."conversation_id";
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_child_run_completion_delivery"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'child completion deliveries are append-only'; END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_child_run_completion_delivery_event"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RETURN NULL;
END;
$$;
CREATE FUNCTION "enforce_terminal_agent_run_event"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RETURN NULL;
END;
$$;

CREATE TRIGGER "conversation_run_events_contiguous" BEFORE INSERT ON "conversation_run_events"
    FOR EACH ROW EXECUTE FUNCTION "enforce_conversation_run_event_append"();
CREATE TRIGGER "conversation_run_events_timeline" AFTER INSERT ON "conversation_run_events"
    FOR EACH ROW EXECUTE FUNCTION "append_conversation_run_event_timeline"();
CREATE TRIGGER "conversation_run_events_append_only" BEFORE UPDATE OR DELETE ON "conversation_run_events"
    FOR EACH ROW EXECUTE FUNCTION "reject_conversation_immutable_mutation"();
CREATE TRIGGER "conversation_timeline_entries_allocate" BEFORE INSERT OR UPDATE OR DELETE ON "conversation_timeline_entries"
    FOR EACH ROW EXECUTE FUNCTION "enforce_conversation_timeline_entry"();
CREATE TRIGGER "child_run_completion_deliveries_authority" BEFORE INSERT OR UPDATE OR DELETE ON "child_run_completion_deliveries"
    FOR EACH ROW EXECUTE FUNCTION "enforce_child_run_completion_delivery"();
CREATE CONSTRAINT TRIGGER "child_run_completion_deliveries_exact_parent_event"
    AFTER INSERT ON "child_run_completion_deliveries" DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION "enforce_child_run_completion_delivery_event"();
CREATE CONSTRAINT TRIGGER "terminal_agent_runs_require_event"
    AFTER INSERT OR UPDATE OF "state" ON "agent_runs" DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION "enforce_terminal_agent_run_event"();

SET LOCAL session_replication_role = replica;
INSERT INTO "conversations" ("id") VALUES ('attempt-parent-conversation');
INSERT INTO "agent_runs" (
    "id", "attempt", "state", "conversation_id", "parent_run_id", "root_run_id", "silo_id"
) VALUES
    ('attempt-parent-delivered', 1, 'accepted', 'attempt-parent-conversation', NULL, 'attempt-parent-delivered', 'attempt-silo'),
    ('attempt-child-delivered', 1, 'completed', NULL, 'attempt-parent-delivered', 'attempt-parent-delivered', 'attempt-silo'),
    ('attempt-parent-suppressed', 1, 'accepted', NULL, NULL, 'attempt-parent-suppressed', 'attempt-silo'),
    ('attempt-child-suppressed', 1, 'completed', NULL, 'attempt-parent-suppressed', 'attempt-parent-suppressed', 'attempt-silo');
INSERT INTO "child_run_reservations" ("child_run_id", "parent_run_id", "root_run_id") VALUES
    ('attempt-child-delivered', 'attempt-parent-delivered', 'attempt-parent-delivered'),
    ('attempt-child-suppressed', 'attempt-parent-suppressed', 'attempt-parent-suppressed');
INSERT INTO "conversation_run_events" (
    "conversation_id", "run_id", "sequence", "type", "payload"
) VALUES (
    'attempt-parent-conversation', 'attempt-parent-delivered', 1, 'child.run.completed',
    '{"childRunId":"attempt-child-delivered","childAttempt":1}'::jsonb
);
INSERT INTO "child_run_completion_deliveries" (
    "child_run_id", "parent_run_id", "parent_event_sequence", "outcome"
) VALUES
    ('attempt-child-delivered', 'attempt-parent-delivered', 1, 'delivered'),
    ('attempt-child-suppressed', 'attempt-parent-suppressed', NULL, 'no_parent_stream');
INSERT INTO "conversation_assets" (
    "id", "conversation_id", "run_id", "run_attempt", "run_event_sequence"
) VALUES (
    'attempt-asset', 'attempt-parent-conversation', 'attempt-parent-delivered', 1, 1
);
INSERT INTO "conversation_asset_output_tickets" (
    "id", "conversation_id", "run_id", "run_attempt", "run_event_sequence"
) VALUES (
    'attempt-ticket', 'attempt-parent-conversation', 'attempt-parent-delivered', 1, 1
);
SET LOCAL session_replication_role = origin;

\if :AMBIGUOUS
UPDATE "agent_runs" SET "attempt" = 2 WHERE "id" = 'attempt-parent-delivered';
\endif

-- APPLY THE EXACT ATTEMPT MIGRATION HERE

-- VERIFY THE MIGRATED ATTEMPT AUTHORITY HERE

DO $verification$
DECLARE
    child_primary_key TEXT;
    asset_event_key TEXT;
    ticket_event_key TEXT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = 'conversation_run_events'::regclass
          AND attname = 'attempt' AND attnotnull AND NOT attisdropped
    ) OR EXISTS (
        SELECT 1 FROM "conversation_run_events" WHERE "attempt" <> 1
    ) THEN
        RAISE EXCEPTION 'FAIL: RunEvent attempt was not deterministically backfilled and required';
    END IF;

    IF (SELECT "child_attempt" FROM "child_run_completion_deliveries" WHERE "child_run_id" = 'attempt-child-delivered') <> 1
        OR (SELECT "parent_attempt" FROM "child_run_completion_deliveries" WHERE "child_run_id" = 'attempt-child-delivered') <> 1
        OR (SELECT "child_attempt" FROM "child_run_completion_deliveries" WHERE "child_run_id" = 'attempt-child-suppressed') <> 1
        OR (SELECT "parent_attempt" FROM "child_run_completion_deliveries" WHERE "child_run_id" = 'attempt-child-suppressed') <> 1 THEN
        RAISE EXCEPTION 'FAIL: delivered and suppressed child history did not receive deterministic attempt coordinates';
    END IF;

    SELECT pg_get_constraintdef(oid) INTO child_primary_key
    FROM pg_constraint
    WHERE conrelid = 'child_run_completion_deliveries'::regclass
      AND conname = 'child_run_completion_deliveries_pkey';
    IF child_primary_key NOT LIKE 'PRIMARY KEY (child_run_id, child_attempt, parent_attempt)%' THEN
        RAISE EXCEPTION 'FAIL: child completion delivery primary key is not attempt-bound';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_index index_row
        JOIN pg_class index_class ON index_class.oid = index_row.indexrelid
        WHERE index_row.indrelid = 'child_run_completion_deliveries'::regclass
          AND index_class.relname = 'child_run_completion_deliveries_one_delivery_per_attempt'
          AND index_row.indisunique AND index_row.indpred IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'FAIL: child completion delivery lacks its delivered-attempt partial unique authority';
    END IF;

    SELECT pg_get_constraintdef(oid) INTO asset_event_key
    FROM pg_constraint
    WHERE conrelid = 'conversation_assets'::regclass
      AND conname = 'conversation_assets_conversation_id_run_id_run_attempt_run_fkey';
    SELECT pg_get_constraintdef(oid) INTO ticket_event_key
    FROM pg_constraint
    WHERE conrelid = 'conversation_asset_output_tickets'::regclass
      AND conname = 'conversation_asset_output_tickets_conversation_id_run_id_r_fkey';
    IF asset_event_key NOT LIKE 'FOREIGN KEY (conversation_id, run_id, run_attempt, run_event_sequence) REFERENCES conversation_run_events(conversation_id, run_id, attempt, sequence)%'
        OR ticket_event_key NOT LIKE 'FOREIGN KEY (conversation_id, run_id, run_attempt, run_event_sequence) REFERENCES conversation_run_events(conversation_id, run_id, attempt, sequence)%' THEN
        RAISE EXCEPTION 'FAIL: asset evidence does not bind its exact RunEvent attempt';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = 'conversation_timeline_entries'::regclass
          AND attname = 'parent_delivery_child_run_id' AND NOT attisdropped
    ) THEN
        RAISE EXCEPTION 'FAIL: callerless child parent-delivery timeline provenance survived migration';
    END IF;

    IF to_regclass('conversation_run_events_run_id_message_id_idx') IS NOT NULL
        OR to_regclass('conversation_run_events_run_id_attempt_message_id_idx') IS NULL
        OR position('(run_id, attempt, message_id)' IN pg_get_indexdef('conversation_run_events_one_message_start'::regclass)) = 0 THEN
        RAISE EXCEPTION 'FAIL: RunEvent message identity is not scoped to its attempt';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'conversation_run_events'::regclass
          AND tgname = 'conversation_run_events_append_only' AND tgenabled = 'O'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'child_run_completion_deliveries'::regclass
          AND tgname = 'child_run_completion_deliveries_authority' AND tgenabled = 'O'
    ) THEN
        RAISE EXCEPTION 'FAIL: migration did not restore immutable event and child-delivery triggers';
    END IF;

    IF position('RunEvent must bind the current AgentRun attempt' IN pg_get_functiondef('enforce_conversation_run_event_append()'::regprocedure)) = 0
        OR position('delivered child completion requires exact parent attempt event' IN pg_get_functiondef('enforce_child_run_completion_delivery_event()'::regprocedure)) = 0
        OR position('"attempt" = NEW."attempt"' IN pg_get_functiondef('enforce_terminal_agent_run_event()'::regprocedure)) = 0 THEN
        RAISE EXCEPTION 'FAIL: migrated functions do not enforce attempt-bound terminal evidence';
    END IF;
END;
$verification$;

UPDATE "agent_runs"
SET "attempt" = 2, "state" = 'accepted'
WHERE "id" = 'attempt-parent-delivered';
INSERT INTO "conversation_run_events" (
    "conversation_id", "run_id", "attempt", "sequence", "type", "payload"
) VALUES (
    'attempt-parent-conversation', 'attempt-parent-delivered', 2, 2, 'run.started', '{}'
);

DO $stale_attempt$
BEGIN
    BEGIN
        INSERT INTO "conversation_run_events" (
            "conversation_id", "run_id", "attempt", "sequence", "type", "payload"
        ) VALUES (
            'attempt-parent-conversation', 'attempt-parent-delivered', 1, 3, 'run.started', '{}'
        );
        RAISE EXCEPTION 'FAIL: migrated RunEvent authority accepted a stale attempt';
    EXCEPTION WHEN OTHERS THEN
        IF position('RunEvent must bind the current AgentRun attempt' IN SQLERRM) = 0 THEN RAISE; END IF;
    END;
END;
$stale_attempt$;

UPDATE "agent_runs" SET "state" = 'failed' WHERE "id" = 'attempt-parent-delivered';
INSERT INTO "conversation_run_events" (
    "conversation_id", "run_id", "attempt", "sequence", "type", "payload"
) VALUES (
    'attempt-parent-conversation', 'attempt-parent-delivered', 2, 3, 'run.failed', '{}'
);
SET CONSTRAINTS ALL IMMEDIATE;

DO $terminal_attempt$
BEGIN
    BEGIN
        INSERT INTO "conversation_run_events" (
            "conversation_id", "run_id", "attempt", "sequence", "type", "payload"
        ) VALUES (
            'attempt-parent-conversation', 'attempt-parent-delivered', 2, 4, 'run.started', '{}'
        );
        RAISE EXCEPTION 'FAIL: migrated RunEvent authority accepted an event after terminality';
    EXCEPTION WHEN OTHERS THEN
        IF position('RunEvent attempt stream is terminal' IN SQLERRM) = 0 THEN RAISE; END IF;
    END;

    BEGIN
        UPDATE "conversation_run_events" SET "payload" = '{"mutated":true}'
        WHERE "run_id" = 'attempt-parent-delivered' AND "sequence" = 1;
        RAISE EXCEPTION 'FAIL: migrated RunEvent history became mutable';
    EXCEPTION WHEN OTHERS THEN
        IF position('canonical conversation history is immutable' IN SQLERRM) = 0 THEN RAISE; END IF;
    END;

    BEGIN
        UPDATE "child_run_completion_deliveries" SET "outcome" = 'parent_stream_terminal'
        WHERE "child_run_id" = 'attempt-child-delivered';
        RAISE EXCEPTION 'FAIL: migrated child completion history became mutable';
    EXCEPTION WHEN OTHERS THEN
        IF position('child completion deliveries are append-only' IN SQLERRM) = 0 THEN RAISE; END IF;
    END;

    BEGIN
        UPDATE "conversation_asset_output_tickets" SET "run_attempt" = 2
        WHERE "id" = 'attempt-ticket';
        RAISE EXCEPTION 'FAIL: output ticket escaped its exact RunEvent attempt';
    EXCEPTION WHEN foreign_key_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO "child_run_completion_deliveries" (
            "child_run_id", "child_attempt", "parent_run_id", "parent_attempt",
            "parent_event_sequence", "outcome"
        ) VALUES (
            'attempt-child-delivered', 1, 'attempt-parent-delivered', 2, 4, 'delivered'
        );
        RAISE EXCEPTION 'FAIL: one child attempt received two delivered outcomes';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;
END;
$terminal_attempt$;

DO $$
BEGIN
    RAISE NOTICE 'PASS: central migration preserves deterministic attempt history and installs retry-bound authority';
END;
$$;

ROLLBACK;
