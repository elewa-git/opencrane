BEGIN;

CREATE TEMPORARY TABLE activity_coordinates (
    ordinal INTEGER PRIMARY KEY,
    kind "ConversationTimelineEntryKind" NOT NULL,
    coordinate TIMESTAMP(3) NOT NULL
) ON COMMIT DROP;

-- The lifecycle trigger replaces caller input so the initial coordinate is database-owned.
INSERT INTO "conversations" ("id", "silo_id", "mode", "updated_at")
VALUES ('activity-conversation', 'activity-silo', 'group', '2099-01-01T00:00:00.000');

DO $$
BEGIN
    IF (SELECT "updated_at" FROM "conversations" WHERE "id" = 'activity-conversation') = '2099-01-01T00:00:00.000'::TIMESTAMP(3) THEN
        RAISE EXCEPTION 'FAIL: Conversation accepted a caller-owned initial activity coordinate';
    END IF;
END;
$$;

-- Membership and message helpers must reach the same canonical allocator as direct kinds.
INSERT INTO "conversation_participants" ("conversation_id", "user_id")
VALUES ('activity-conversation', 'activity-user');
INSERT INTO activity_coordinates
SELECT 1, "kind", conversation."updated_at"
FROM "conversation_timeline_entries" entry
JOIN "conversations" conversation ON conversation."id" = entry."conversation_id"
WHERE entry."conversation_id" = 'activity-conversation' AND entry."position" = 1;

-- Match the personal list query: a later activity in another visible conversation moves it first.
SELECT pg_sleep(0.002);
INSERT INTO "conversations" ("id", "silo_id", "mode")
VALUES ('activity-rival-conversation', 'activity-silo', 'group');
INSERT INTO "conversation_participants" ("conversation_id", "user_id")
VALUES ('activity-rival-conversation', 'activity-user');
DO $$
BEGIN
    IF (
        SELECT participant."conversation_id"
        FROM "conversation_participants" participant
        JOIN "conversations" conversation ON conversation."id" = participant."conversation_id"
        WHERE participant."user_id" = 'activity-user'
        ORDER BY conversation."updated_at" DESC, participant."conversation_id" DESC
        LIMIT 1
    ) IS DISTINCT FROM 'activity-rival-conversation' THEN
        RAISE EXCEPTION 'FAIL: newest visible Conversation activity was not listed first';
    END IF;
END;
$$;

SELECT pg_sleep(0.002);
INSERT INTO "conversation_messages" (
    "id", "conversation_id", "user_id", "idempotency_key", "role", "state", "source", "blocks", "completed_at"
) VALUES (
    'activity-message', 'activity-conversation', 'activity-user', 'activity-message-key',
    'user', 'completed', 'user_input', '[]', clock_timestamp()
);
INSERT INTO activity_coordinates
SELECT 2, "kind", conversation."updated_at"
FROM "conversation_timeline_entries" entry
JOIN "conversations" conversation ON conversation."id" = entry."conversation_id"
WHERE entry."conversation_id" = 'activity-conversation' AND entry."position" = 2;
DO $$
BEGIN
    IF (
        SELECT participant."conversation_id"
        FROM "conversation_participants" participant
        JOIN "conversations" conversation ON conversation."id" = participant."conversation_id"
        WHERE participant."user_id" = 'activity-user'
        ORDER BY conversation."updated_at" DESC, participant."conversation_id" DESC
        LIMIT 1
    ) IS DISTINCT FROM 'activity-conversation' THEN
        RAISE EXCEPTION 'FAIL: a new canonical append did not reorder the visible Conversation list';
    END IF;
END;
$$;

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
SELECT 3, "kind", conversation."updated_at"
FROM "conversation_timeline_entries" entry
JOIN "conversations" conversation ON conversation."id" = entry."conversation_id"
WHERE entry."conversation_id" = 'activity-conversation' AND entry."position" = 3;

INSERT INTO "conversation_timeline_entries" (
    "conversation_id", "kind", "system_event_id", "payload", "occurred_at"
) VALUES (
    'activity-conversation', 'system', 'activity-system', '{"action":"activity-test"}', '2000-01-01T00:00:00.000'
);
INSERT INTO activity_coordinates
SELECT 4, "kind", conversation."updated_at"
FROM "conversation_timeline_entries" entry
JOIN "conversations" conversation ON conversation."id" = entry."conversation_id"
WHERE entry."conversation_id" = 'activity-conversation' AND entry."position" = 4;

INSERT INTO "conversation_timeline_entries" (
    "conversation_id", "kind", "parent_delivery_child_run_id"
) VALUES ('activity-conversation', 'parent_delivery', 'activity-child-run');
INSERT INTO activity_coordinates
SELECT 5, "kind", conversation."updated_at"
FROM "conversation_timeline_entries" entry
JOIN "conversations" conversation ON conversation."id" = entry."conversation_id"
WHERE entry."conversation_id" = 'activity-conversation' AND entry."position" = 5;

DO $$
DECLARE
    mismatched_coordinates INTEGER;
    non_monotonic_coordinates INTEGER;
BEGIN
    SELECT count(*) INTO mismatched_coordinates
    FROM activity_coordinates activity
    JOIN "conversation_timeline_entries" entry
      ON entry."conversation_id" = 'activity-conversation' AND entry."position" = activity.ordinal
    WHERE activity.coordinate IS DISTINCT FROM entry."occurred_at";
    IF mismatched_coordinates <> 0 THEN
        RAISE EXCEPTION 'FAIL: canonical timeline activity did not own the exact Conversation coordinate';
    END IF;

    SELECT count(*) INTO non_monotonic_coordinates
    FROM activity_coordinates current_activity
    JOIN activity_coordinates previous_activity ON previous_activity.ordinal = current_activity.ordinal - 1
    WHERE current_activity.coordinate <= previous_activity.coordinate;
    IF non_monotonic_coordinates <> 0 THEN
        RAISE EXCEPTION 'FAIL: Conversation activity coordinates did not advance monotonically';
    END IF;

    IF (SELECT array_agg(kind ORDER BY ordinal) FROM activity_coordinates)
        IS DISTINCT FROM ARRAY['membership', 'message', 'run_event', 'system', 'parent_delivery']::"ConversationTimelineEntryKind"[] THEN
        RAISE EXCEPTION 'FAIL: activity fixture did not exercise every canonical timeline kind';
    END IF;

    BEGIN
        UPDATE "conversations" SET "updated_at" = "updated_at" + INTERVAL '1 second'
        WHERE "id" = 'activity-conversation';
        RAISE EXCEPTION 'FAIL: direct Conversation activity mutation unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF strpos(SQLERRM, 'activity coordinate is database-owned') = 0 THEN
            RAISE;
        END IF;
    END;
END;
$$;

-- Lifecycle changes retain the existing coordinate; only a canonical timeline append advances it.
INSERT INTO "conversations" ("id", "silo_id", "mode")
VALUES ('activity-lifecycle-conversation', 'activity-silo', 'group');
CREATE TEMPORARY TABLE lifecycle_coordinate ON COMMIT DROP AS
SELECT "updated_at" AS coordinate FROM "conversations" WHERE "id" = 'activity-lifecycle-conversation';
UPDATE "conversations"
SET "lifecycle" = 'closed', "closed_at" = clock_timestamp()
WHERE "id" = 'activity-lifecycle-conversation';
DO $$
BEGIN
    IF (SELECT "updated_at" FROM "conversations" WHERE "id" = 'activity-lifecycle-conversation')
        IS DISTINCT FROM (SELECT coordinate FROM lifecycle_coordinate) THEN
        RAISE EXCEPTION 'FAIL: lifecycle mutation redefined canonical timeline activity';
    END IF;
    RAISE NOTICE 'PASS: every canonical timeline kind owns monotonic Conversation activity';
END;
$$;

ROLLBACK;
