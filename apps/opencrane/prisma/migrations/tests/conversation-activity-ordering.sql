BEGIN;

CREATE TEMPORARY TABLE activity_coordinates (
    ordinal INTEGER PRIMARY KEY,
    kind "ConversationTimelineEntryKind" NOT NULL,
    activity_time TIMESTAMP(3) NOT NULL,
    activity_sequence BIGINT NOT NULL
) ON COMMIT DROP;

-- A same-transaction burst must not push one conversation's display timestamp into the future or
-- outrank a subsequently active conversation. The global sequence, not wall-clock arithmetic, sorts it.
INSERT INTO "conversations" ("id", "silo_id", "mode")
VALUES ('activity-burst-first', 'activity-burst-silo', 'group');
INSERT INTO "conversation_participants" ("conversation_id", "user_id")
VALUES ('activity-burst-first', 'activity-burst-user');
INSERT INTO "conversation_timeline_entries" (
    "conversation_id", "kind", "system_event_id", "payload"
)
SELECT 'activity-burst-first', 'system', 'activity-burst-' || ordinal, '{}'
FROM generate_series(1, 256) ordinal;

INSERT INTO "conversations" ("id", "silo_id", "mode")
VALUES ('activity-burst-second', 'activity-burst-silo', 'group');
INSERT INTO "conversation_participants" ("conversation_id", "user_id")
VALUES ('activity-burst-second', 'activity-burst-user');
DO $$
BEGIN
    IF (
        SELECT participant."conversation_id"
        FROM "conversation_participants" participant
        JOIN "conversations" conversation ON conversation."id" = participant."conversation_id"
        WHERE participant."user_id" = 'activity-burst-user'
        ORDER BY conversation."activity_sequence" DESC, participant."conversation_id" DESC
        LIMIT 1
    ) IS DISTINCT FROM 'activity-burst-second' THEN
        RAISE EXCEPTION 'FAIL: a later cross-conversation activity allocation did not outrank an earlier burst';
    END IF;

    IF (SELECT "updated_at" FROM "conversations" WHERE "id" = 'activity-burst-first') > clock_timestamp() THEN
        RAISE EXCEPTION 'FAIL: burst activity advanced the human timestamp beyond database wall time';
    END IF;
END;
$$;

INSERT INTO "conversation_timeline_entries" (
    "conversation_id", "kind", "system_event_id", "payload"
) VALUES ('activity-burst-first', 'system', 'activity-burst-after-second', '{}');
DO $$
BEGIN
    IF (
        SELECT participant."conversation_id"
        FROM "conversation_participants" participant
        JOIN "conversations" conversation ON conversation."id" = participant."conversation_id"
        WHERE participant."user_id" = 'activity-burst-user'
        ORDER BY conversation."activity_sequence" DESC, participant."conversation_id" DESC
        LIMIT 1
    ) IS DISTINCT FROM 'activity-burst-first' THEN
        RAISE EXCEPTION 'FAIL: the latest global activity allocation did not reorder the visible list';
    END IF;
END;
$$;

-- The lifecycle trigger replaces caller time while the identity column allocates global order.
INSERT INTO "conversations" ("id", "silo_id", "mode", "updated_at")
VALUES ('activity-conversation', 'activity-silo', 'group', '2099-01-01T00:00:00.000');

DO $$
BEGIN
    IF (SELECT "updated_at" FROM "conversations" WHERE "id" = 'activity-conversation') = '2099-01-01T00:00:00.000'::TIMESTAMP(3) THEN
        RAISE EXCEPTION 'FAIL: Conversation accepted a caller-owned initial activity time';
    END IF;
    IF (SELECT "activity_sequence" FROM "conversations" WHERE "id" = 'activity-conversation') <= 0 THEN
        RAISE EXCEPTION 'FAIL: Conversation did not receive a database-owned initial activity sequence';
    END IF;

    BEGIN
        INSERT INTO "conversations" ("id", "silo_id", "mode", "activity_sequence")
        VALUES ('activity-spoofed-sequence', 'activity-silo', 'group', 999999);
        RAISE EXCEPTION 'FAIL: Conversation accepted a caller-owned initial activity sequence';
    EXCEPTION WHEN SQLSTATE '428C9' THEN
        NULL;
    END;
END;
$$;

-- Membership and message helpers must reach the same canonical allocator as direct kinds.
INSERT INTO "conversation_participants" ("conversation_id", "user_id")
VALUES ('activity-conversation', 'activity-user');
INSERT INTO activity_coordinates
SELECT 1, "kind", conversation."updated_at", conversation."activity_sequence"
FROM "conversation_timeline_entries" entry
JOIN "conversations" conversation ON conversation."id" = entry."conversation_id"
WHERE entry."conversation_id" = 'activity-conversation' AND entry."position" = 1;

INSERT INTO "conversation_messages" (
    "id", "conversation_id", "user_id", "idempotency_key", "role", "state", "source", "blocks", "completed_at"
) VALUES (
    'activity-message', 'activity-conversation', 'activity-user', 'activity-message-key',
    'user', 'completed', 'user_input', '[]', clock_timestamp()
);
INSERT INTO activity_coordinates
SELECT 2, "kind", conversation."updated_at", conversation."activity_sequence"
FROM "conversation_timeline_entries" entry
JOIN "conversations" conversation ON conversation."id" = entry."conversation_id"
WHERE entry."conversation_id" = 'activity-conversation' AND entry."position" = 2;

-- Seed otherwise unrelated provenance with authority triggers suppressed. The timeline inserts below
-- still run every canonical shape, foreign key, allocation, and activity-coordinate check.
SET LOCAL session_replication_role = replica;
INSERT INTO "agent_runs" (
    "id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger",
    "request_idempotency_key", "root_run_id", "parent_run_id", "state", "effective_contract_digest",
    "input_snapshot_digest", "finished_at", "terminal_reason"
) VALUES
    ('activity-parent-run', 'activity-silo', 'activity-service', 'activity-revision', 'activity-conversation', 'interactive',
     'activity-parent-run-key', 'activity-parent-run', NULL, 'accepted', 'sha256:' || repeat('c', 64),
     'sha256:' || repeat('d', 64), NULL, NULL),
    ('activity-child-run', 'activity-silo', 'activity-service', 'activity-revision', NULL, 'interactive',
     'activity-child-run-key', 'activity-parent-run', 'activity-parent-run', 'completed', 'sha256:' || repeat('e', 64),
     'sha256:' || repeat('f', 64), clock_timestamp(), 'success');
INSERT INTO "conversation_run_events" ("conversation_id", "run_id", "sequence", "type", "payload")
VALUES ('activity-conversation', 'activity-parent-run', 1, 'run.started', '{}');
INSERT INTO "child_run_completion_deliveries" ("child_run_id", "parent_run_id", "parent_event_sequence", "outcome")
VALUES ('activity-child-run', 'activity-parent-run', 1, 'delivered');
SET LOCAL session_replication_role = origin;

INSERT INTO "conversation_timeline_entries" (
    "conversation_id", "kind", "run_id", "run_event_sequence"
) VALUES ('activity-conversation', 'run_event', 'activity-parent-run', 1);
INSERT INTO activity_coordinates
SELECT 3, "kind", conversation."updated_at", conversation."activity_sequence"
FROM "conversation_timeline_entries" entry
JOIN "conversations" conversation ON conversation."id" = entry."conversation_id"
WHERE entry."conversation_id" = 'activity-conversation' AND entry."position" = 3;

INSERT INTO "conversation_timeline_entries" (
    "conversation_id", "kind", "system_event_id", "payload", "occurred_at"
) VALUES (
    'activity-conversation', 'system', 'activity-system', '{"action":"activity-test"}', '2000-01-01T00:00:00.000'
);
INSERT INTO activity_coordinates
SELECT 4, "kind", conversation."updated_at", conversation."activity_sequence"
FROM "conversation_timeline_entries" entry
JOIN "conversations" conversation ON conversation."id" = entry."conversation_id"
WHERE entry."conversation_id" = 'activity-conversation' AND entry."position" = 4;

INSERT INTO "conversation_timeline_entries" (
    "conversation_id", "kind", "parent_delivery_child_run_id"
) VALUES ('activity-conversation', 'parent_delivery', 'activity-child-run');
INSERT INTO activity_coordinates
SELECT 5, "kind", conversation."updated_at", conversation."activity_sequence"
FROM "conversation_timeline_entries" entry
JOIN "conversations" conversation ON conversation."id" = entry."conversation_id"
WHERE entry."conversation_id" = 'activity-conversation' AND entry."position" = 5;

DO $$
DECLARE
    mismatched_times INTEGER;
    non_monotonic_sequences INTEGER;
BEGIN
    SELECT count(*) INTO mismatched_times
    FROM activity_coordinates activity
    JOIN "conversation_timeline_entries" entry
      ON entry."conversation_id" = 'activity-conversation' AND entry."position" = activity.ordinal
    JOIN "conversations" conversation ON conversation."id" = entry."conversation_id"
    WHERE activity.activity_time IS DISTINCT FROM entry."occurred_at";
    IF mismatched_times <> 0 THEN
        RAISE EXCEPTION 'FAIL: canonical timeline append did not retain its real database time';
    END IF;

    SELECT count(*) INTO non_monotonic_sequences
    FROM activity_coordinates current_activity
    JOIN activity_coordinates previous_activity ON previous_activity.ordinal = current_activity.ordinal - 1
    WHERE current_activity.activity_sequence <= previous_activity.activity_sequence;
    IF non_monotonic_sequences <> 0 THEN
        RAISE EXCEPTION 'FAIL: Conversation global activity sequence did not advance monotonically';
    END IF;

    IF (SELECT array_agg(kind ORDER BY ordinal) FROM activity_coordinates)
        IS DISTINCT FROM ARRAY['membership', 'message', 'run_event', 'system', 'parent_delivery']::"ConversationTimelineEntryKind"[] THEN
        RAISE EXCEPTION 'FAIL: activity fixture did not exercise every canonical timeline kind';
    END IF;

    BEGIN
        UPDATE "conversations" SET "updated_at" = "updated_at" + INTERVAL '1 second'
        WHERE "id" = 'activity-conversation';
        RAISE EXCEPTION 'FAIL: direct Conversation activity-time mutation unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF strpos(SQLERRM, 'activity time and sequence are database-owned') = 0 THEN
            RAISE;
        END IF;
    END;

    BEGIN
        UPDATE "conversations" SET "activity_sequence" = "activity_sequence" + 1
        WHERE "id" = 'activity-conversation';
        RAISE EXCEPTION 'FAIL: direct Conversation activity-sequence mutation unexpectedly succeeded';
    EXCEPTION WHEN SQLSTATE '428C9' THEN
        NULL;
    WHEN OTHERS THEN
        IF strpos(SQLERRM, 'activity time and sequence are database-owned') = 0 THEN
            RAISE;
        END IF;
    END;
END;
$$;

-- Lifecycle changes retain both activity facts; only a canonical timeline append advances them.
INSERT INTO "conversations" ("id", "silo_id", "mode")
VALUES ('activity-lifecycle-conversation', 'activity-silo', 'group');
CREATE TEMPORARY TABLE lifecycle_coordinate ON COMMIT DROP AS
SELECT "updated_at", "activity_sequence" FROM "conversations" WHERE "id" = 'activity-lifecycle-conversation';
UPDATE "conversations"
SET "lifecycle" = 'closed', "closed_at" = clock_timestamp()
WHERE "id" = 'activity-lifecycle-conversation';
DO $$
BEGIN
    IF (SELECT "updated_at" FROM "conversations" WHERE "id" = 'activity-lifecycle-conversation')
        IS DISTINCT FROM (SELECT "updated_at" FROM lifecycle_coordinate)
        OR (SELECT "activity_sequence" FROM "conversations" WHERE "id" = 'activity-lifecycle-conversation')
        IS DISTINCT FROM (SELECT "activity_sequence" FROM lifecycle_coordinate) THEN
        RAISE EXCEPTION 'FAIL: lifecycle mutation redefined canonical timeline activity facts';
    END IF;
    RAISE NOTICE 'PASS: every canonical timeline kind owns globally ordered Conversation activity';
END;
$$;

ROLLBACK;
