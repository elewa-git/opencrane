BEGIN;

INSERT INTO "model_definitions" ("id", "scope", "public_model_name", "litellm_model_id", "upstream_model", "updated_at")
VALUES ('phase-d-model', 'global', 'phase-d-model', 'litellm-phase-d-model', 'phase-d-model', clock_timestamp());

CREATE FUNCTION pg_temp.expect_failure(test_name TEXT, statement TEXT, expected_message TEXT)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
    actual_message TEXT;
BEGIN
    BEGIN
        EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS actual_message = MESSAGE_TEXT;
        IF strpos(actual_message, expected_message) > 0 THEN
            RAISE NOTICE 'PASS: %', test_name;
            RETURN;
        END IF;
        RAISE EXCEPTION 'FAIL: % returned unexpected error: %', test_name, actual_message;
    END;
    RAISE EXCEPTION 'FAIL: % unexpectedly succeeded', test_name;
END;
$$;

CREATE FUNCTION pg_temp.assert_true(test_name TEXT, condition BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    IF condition IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL: %', test_name;
    END IF;
    RAISE NOTICE 'PASS: %', test_name;
END;
$$;

INSERT INTO "agent_services" (
    "id", "silo_id", "kind", "name",
    "state", "workload_profile", "created_at", "updated_at"
) VALUES (
    'svc-main', 'silo-1', 'managed', 'Main service',
    'draft', 'standard', clock_timestamp(), clock_timestamp()
);

SELECT pg_temp.expect_failure(
    'new AgentService cannot bypass the Draft initial state',
    $statement$
        INSERT INTO "agent_services" (
            "id", "silo_id", "kind", "name",
            "state", "workload_profile", "created_at", "updated_at"
        ) VALUES (
            'svc-invalid-initial', 'silo-1', 'managed', 'Invalid service',
            'paused', 'standard', clock_timestamp(), clock_timestamp()
        )
    $statement$,
    'must begin Draft without an active revision'
);

INSERT INTO "agent_revisions" (
    "id", "agent_service_id", "revision", "state", "digest",
    "prompt_policy_version", "model_definition_id", "budget", "authored_by"
) VALUES
    ('rev-published', 'svc-main', 1, 'draft', 'sha256:' || repeat('a', 64),
     'prompt-v1', 'phase-d-model', '{}', 'user-1'),
    ('rev-draft', 'svc-main', 2, 'draft', 'sha256:' || repeat('b', 64),
     'prompt-v1', 'phase-d-model', '{}', 'user-1');

SELECT pg_temp.expect_failure(
    'referenced model definition cannot change routing identity',
    $statement$
        UPDATE "model_definitions"
        SET "public_model_name" = 'changed-model'
        WHERE "id" = 'phase-d-model'
    $statement$,
    'A ModelDefinition referenced by an AgentRevision is immutable'
);

INSERT INTO "model_definitions" ("id", "scope", "cluster_tenant", "public_model_name", "litellm_model_id", "upstream_model", "updated_at")
VALUES ('foreign-phase-d-model', 'clusterTenant', 'silo-other', 'foreign-phase-d-model', 'litellm-foreign-phase-d-model', 'foreign-phase-d-model', clock_timestamp());
SELECT pg_temp.expect_failure(
    'foreign tenant model definition is unavailable',
    $statement$
        INSERT INTO "agent_revisions" (
            "id", "agent_service_id", "revision", "state", "digest",
            "prompt_policy_version", "model_definition_id", "budget", "authored_by"
        ) VALUES (
            'foreign-model-revision', 'svc-main', 3, 'draft', 'sha256:' || repeat('c', 64),
            'prompt-v1', 'foreign-phase-d-model', '{}', 'user-1'
        )
    $statement$,
    'AgentRevision model definition is unavailable to its service tenant'
);

SELECT pg_temp.expect_failure(
    'unpublished AgentService activation is rejected',
    $statement$
        UPDATE "agent_services"
        SET "active_revision_id" = 'rev-draft', "state" = 'active'
        WHERE "id" = 'svc-main'
    $statement$,
    'must be a Published revision'
);

UPDATE "agent_revisions"
SET "state" = 'published', "published_at" = clock_timestamp()
WHERE "id" = 'rev-published';

UPDATE "agent_services"
SET "active_revision_id" = 'rev-published', "state" = 'active'
WHERE "id" = 'svc-main';

SELECT pg_temp.expect_failure(
    'AgentService silo identity cannot move after creation',
    $statement$UPDATE "agent_services" SET "silo_id" = 'silo-other' WHERE "id" = 'svc-main'$statement$,
    'silo identity is immutable'
);

SELECT pg_temp.expect_failure(
    'AgentRun silo must match its AgentService silo',
    $statement$
        INSERT INTO "agent_runs" (
            "id", "silo_id", "agent_service_id", "agent_revision_id", "thread_id", "trigger",
            "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest"
        ) VALUES (
            'run-wrong-silo', 'silo-other', 'svc-main', 'rev-published', 'thread-wrong-silo', 'interactive',
            'request-wrong-silo', 'run-wrong-silo', 'sha256:' || repeat('e', 64), 'sha256:' || repeat('f', 64)
        )
    $statement$,
    'requires the exact silo and active revision'
);

SELECT pg_temp.expect_failure(
    'assignments cannot be appended after revision publication',
    $statement$
        INSERT INTO "agent_revision_skill_assignments" (
            "agent_revision_id", "skill_id", "skill_revision_id"
        ) VALUES ('rev-published', 'skill-late', 'skill-revision-late')
    $statement$,
    'only to a draft AgentRevision'
);

SELECT pg_temp.expect_failure(
    'AgentRun creation on a non-current revision is rejected',
    $statement$
        INSERT INTO "agent_runs" (
            "id", "silo_id", "agent_service_id", "agent_revision_id", "thread_id", "trigger",
            "request_idempotency_key", "root_run_id", "effective_contract_digest",
            "input_snapshot_digest"
        ) VALUES (
            'run-unpublished', 'silo-1', 'svc-main', 'rev-draft', 'thread-unpublished', 'interactive',
            'request-unpublished', 'run-unpublished', 'sha256:' || repeat('c', 64),
            'sha256:' || repeat('d', 64)
        )
    $statement$,
    'requires the exact silo and active revision of an Active AgentService'
);

SELECT pg_temp.expect_failure(
    'new AgentRun cannot bypass the initial state',
    $statement$
        INSERT INTO "agent_runs" (
            "id", "silo_id", "agent_service_id", "agent_revision_id", "thread_id", "trigger",
            "request_idempotency_key", "root_run_id", "attempt", "state",
            "effective_contract_digest", "input_snapshot_digest", "finished_at", "terminal_reason"
        ) VALUES (
            'run-terminal-insert', 'silo-1', 'svc-main', 'rev-published', 'thread-terminal-insert', 'interactive',
            'request-terminal-insert', 'run-terminal-insert', 1, 'completed',
            'sha256:' || repeat('c', 64), 'sha256:' || repeat('d', 64), clock_timestamp(), 'success'
        )
    $statement$,
    'must begin as accepted attempt 1'
);

INSERT INTO "agent_services" (
    "id", "silo_id", "kind", "name",
    "state", "workload_profile", "created_at", "updated_at"
) VALUES (
    'svc-lifecycle', 'silo-1', 'managed', 'Lifecycle service',
    'draft', 'standard', clock_timestamp(), clock_timestamp()
);

INSERT INTO "agent_revisions" (
    "id", "agent_service_id", "revision", "state", "digest",
    "prompt_policy_version", "model_definition_id", "budget", "authored_by", "published_at"
) VALUES
    ('rev-never-published', 'svc-lifecycle', 1, 'draft', 'sha256:' || repeat('e', 64),
     'prompt-v1', 'phase-d-model', '{}', 'user-1', NULL),
    ('rev-retirable', 'svc-lifecycle', 2, 'published', 'sha256:' || repeat('f', 64),
     'prompt-v1', 'phase-d-model', '{}', 'user-1', '2026-01-01T00:00:00Z');

SELECT pg_temp.expect_failure(
    'Draft revision cannot retire without publication evidence',
    $statement$
        UPDATE "agent_revisions"
        SET "state" = 'retired'
        WHERE "id" = 'rev-never-published'
    $statement$,
    'invalid AgentRevision lifecycle transition'
);

UPDATE "agent_revisions" SET "state" = 'retired' WHERE "id" = 'rev-retirable';
SELECT pg_temp.assert_true(
    'Published revision keeps published_at after retirement',
    (SELECT "published_at" = '2026-01-01T00:00:00Z'::timestamptz
     FROM "agent_revisions" WHERE "id" = 'rev-retirable')
);

UPDATE "agent_services" SET "state" = 'retired' WHERE "id" = 'svc-lifecycle';
SELECT pg_temp.expect_failure(
    'Retired AgentService cannot be resurrected',
    $statement$
        UPDATE "agent_services" SET "state" = 'draft' WHERE "id" = 'svc-lifecycle'
    $statement$,
    'is closed and cannot be changed'
);

INSERT INTO "agent_services" (
    "id", "silo_id", "kind", "name",
    "state", "workload_profile", "created_at", "updated_at"
) VALUES (
    'svc-run-retirement', 'silo-1', 'managed', 'Run retirement service',
    'draft', 'standard', clock_timestamp(), clock_timestamp()
);
INSERT INTO "agent_revisions" (
    "id", "agent_service_id", "revision", "state", "digest",
    "prompt_policy_version", "model_definition_id", "budget", "authored_by", "published_at"
) VALUES (
    'rev-run-retirement', 'svc-run-retirement', 1, 'published', 'sha256:' || repeat('7', 64),
    'prompt-v1', 'phase-d-model', '{}', 'user-1', clock_timestamp()
);
UPDATE "agent_services"
SET "active_revision_id" = 'rev-run-retirement', "state" = 'active'
WHERE "id" = 'svc-run-retirement';
INSERT INTO "conversation_threads" ("id", "silo_id", "agent_service_id", "updated_at")
VALUES ('thread-retry-retirement', 'silo-1', 'svc-run-retirement', clock_timestamp());
INSERT INTO "agent_runs" (
    "id", "silo_id", "agent_service_id", "agent_revision_id", "thread_id", "trigger",
    "request_idempotency_key", "root_run_id", "effective_contract_digest",
    "input_snapshot_digest"
) VALUES (
    'run-retry-retirement', 'silo-1', 'svc-run-retirement', 'rev-run-retirement', 'thread-retry-retirement', 'interactive',
    'request-retry-retirement', 'run-retry-retirement', 'sha256:' || repeat('1', 64),
    'sha256:' || repeat('2', 64)
);
UPDATE "agent_runs"
SET "state" = 'failed', "finished_at" = clock_timestamp(), "terminal_reason" = 'runtime_failure'
WHERE "id" = 'run-retry-retirement';
UPDATE "agent_services"
SET "state" = 'retired', "active_revision_id" = NULL
WHERE "id" = 'svc-run-retirement';

SELECT pg_temp.expect_failure(
    'new AgentRun after service retirement is rejected',
    $statement$
        INSERT INTO "agent_runs" (
            "id", "silo_id", "agent_service_id", "agent_revision_id", "thread_id", "trigger",
            "request_idempotency_key", "root_run_id", "effective_contract_digest",
            "input_snapshot_digest"
        ) VALUES (
            'run-after-retirement', 'silo-1', 'svc-run-retirement', 'rev-run-retirement', 'thread-after-retirement', 'interactive',
            'request-after-retirement', 'run-after-retirement', 'sha256:' || repeat('3', 64),
            'sha256:' || repeat('4', 64)
        )
    $statement$,
    'requires the exact silo and active revision of an Active AgentService'
);

SELECT pg_temp.expect_failure(
    'AgentRun retry after service retirement is rejected',
    $statement$
        UPDATE "agent_runs"
        SET "attempt" = 2, "state" = 'accepted', "accepted_at" = "accepted_at" + interval '1 second',
            "started_at" = NULL, "finished_at" = NULL, "terminal_reason" = NULL,
            "cost_amount" = NULL, "cost_currency" = NULL
        WHERE "id" = 'run-retry-retirement'
    $statement$,
    'requires the exact silo and active revision of an Active AgentService'
);

INSERT INTO "agent_services" (
    "id", "silo_id", "kind", "name",
    "state", "workload_profile", "created_at", "updated_at"
) VALUES (
    'svc-run-rollover', 'silo-1', 'managed', 'Run rollover service',
    'draft', 'standard', clock_timestamp(), clock_timestamp()
);
INSERT INTO "agent_revisions" (
    "id", "agent_service_id", "revision", "state", "digest",
    "prompt_policy_version", "model_definition_id", "budget", "authored_by", "published_at"
) VALUES
    ('rev-run-rollover-1', 'svc-run-rollover', 1, 'published', 'sha256:' || repeat('8', 64),
     'prompt-v1', 'phase-d-model', '{}', 'user-1', clock_timestamp()),
    ('rev-run-rollover-2', 'svc-run-rollover', 2, 'published', 'sha256:' || repeat('9', 64),
     'prompt-v1', 'phase-d-model', '{}', 'user-1', clock_timestamp());
UPDATE "agent_services"
SET "active_revision_id" = 'rev-run-rollover-1', "state" = 'active'
WHERE "id" = 'svc-run-rollover';
INSERT INTO "conversation_threads" ("id", "silo_id", "agent_service_id", "updated_at")
VALUES ('thread-retry-rollover', 'silo-1', 'svc-run-rollover', clock_timestamp());
INSERT INTO "agent_runs" (
    "id", "silo_id", "agent_service_id", "agent_revision_id", "thread_id", "trigger",
    "request_idempotency_key", "root_run_id", "effective_contract_digest",
    "input_snapshot_digest"
) VALUES (
    'run-retry-rollover', 'silo-1', 'svc-run-rollover', 'rev-run-rollover-1', 'thread-retry-rollover', 'interactive',
    'request-retry-rollover', 'run-retry-rollover', 'sha256:' || repeat('5', 64),
    'sha256:' || repeat('6', 64)
);
UPDATE "agent_runs"
SET "state" = 'failed', "finished_at" = clock_timestamp(), "terminal_reason" = 'runtime_failure'
WHERE "id" = 'run-retry-rollover';
UPDATE "agent_services"
SET "active_revision_id" = 'rev-run-rollover-2'
WHERE "id" = 'svc-run-rollover';

SELECT pg_temp.expect_failure(
    'new AgentRun on a superseded Published revision is rejected',
    $statement$
        INSERT INTO "agent_runs" (
            "id", "silo_id", "agent_service_id", "agent_revision_id", "thread_id", "trigger",
            "request_idempotency_key", "root_run_id", "effective_contract_digest",
            "input_snapshot_digest"
        ) VALUES (
            'run-superseded-revision', 'silo-1', 'svc-run-rollover', 'rev-run-rollover-1', 'thread-superseded-revision', 'interactive',
            'request-superseded-revision', 'run-superseded-revision', 'sha256:' || repeat('7', 64),
            'sha256:' || repeat('8', 64)
        )
    $statement$,
    'requires the exact silo and active revision of an Active AgentService'
);

SELECT pg_temp.expect_failure(
    'AgentRun retry after active revision rollover is rejected',
    $statement$
        UPDATE "agent_runs"
        SET "attempt" = 2, "state" = 'accepted', "accepted_at" = "accepted_at" + interval '1 second',
            "started_at" = NULL, "finished_at" = NULL, "terminal_reason" = NULL,
            "cost_amount" = NULL, "cost_currency" = NULL
        WHERE "id" = 'run-retry-rollover'
    $statement$,
    'requires the exact silo and active revision of an Active AgentService'
);

INSERT INTO "conversation_threads" ("id", "silo_id", "agent_service_id", "updated_at") VALUES
    ('thread-run-state', 'silo-1', 'svc-main', clock_timestamp()),
    ('thread-run-action', 'silo-1', 'svc-main', clock_timestamp());
INSERT INTO "agent_runs" (
    "id", "silo_id", "agent_service_id", "agent_revision_id", "thread_id", "trigger",
    "request_idempotency_key", "root_run_id", "effective_contract_digest",
    "input_snapshot_digest"
) VALUES (
    'run-state', 'silo-1', 'svc-main', 'rev-published', 'thread-run-state', 'interactive',
    'request-state', 'run-state', 'sha256:' || repeat('1', 64),
    'sha256:' || repeat('a', 64)
);

UPDATE "agent_runs" SET "state" = 'queued' WHERE "id" = 'run-state';
UPDATE "agent_runs" SET "state" = 'assigned' WHERE "id" = 'run-state';
UPDATE "agent_runs"
SET "state" = 'running', "started_at" = clock_timestamp()
WHERE "id" = 'run-state';
UPDATE "agent_runs"
SET "state" = 'failed', "finished_at" = clock_timestamp(), "terminal_reason" = 'runtime_failure'
WHERE "id" = 'run-state';

SELECT pg_temp.expect_failure(
    'terminal attempt cannot resurrect in place',
    $statement$
        UPDATE "agent_runs"
        SET "state" = 'running', "finished_at" = NULL, "terminal_reason" = NULL
        WHERE "id" = 'run-state'
    $statement$,
    'terminal AgentRun attempt coordinates are immutable'
);

UPDATE "agent_runs"
SET "attempt" = 2, "state" = 'accepted', "accepted_at" = "accepted_at" + interval '1 second',
    "started_at" = NULL, "finished_at" = NULL, "terminal_reason" = NULL,
    "cost_amount" = NULL, "cost_currency" = NULL
WHERE "id" = 'run-state';

UPDATE "agent_runs" SET "state" = 'queued' WHERE "id" = 'run-state';
UPDATE "agent_runs" SET "state" = 'assigned' WHERE "id" = 'run-state';
UPDATE "agent_runs"
SET "state" = 'running', "started_at" = clock_timestamp()
WHERE "id" = 'run-state';
UPDATE "agent_runs"
SET "state" = 'completed', "finished_at" = clock_timestamp(), "terminal_reason" = 'success'
WHERE "id" = 'run-state';

SELECT pg_temp.expect_failure(
    'completed run cannot create another attempt',
    $statement$
        UPDATE "agent_runs"
        SET "attempt" = 3, "state" = 'accepted', "accepted_at" = "accepted_at" + interval '1 second',
            "started_at" = NULL, "finished_at" = NULL, "terminal_reason" = NULL
        WHERE "id" = 'run-state'
    $statement$,
    'invalid AgentRun attempt transition'
);

INSERT INTO "agent_runs" (
    "id", "silo_id", "agent_service_id", "agent_revision_id", "trigger",
    "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest"
) VALUES
    ('run-cancel-accepted', 'silo-1', 'svc-main', 'rev-published', 'interactive',
     'request-cancel-accepted', 'run-cancel-accepted', 'sha256:' || repeat('1', 64), 'sha256:' || repeat('1', 64)),
    ('run-cancel-queued', 'silo-1', 'svc-main', 'rev-published', 'interactive',
     'request-cancel-queued', 'run-cancel-queued', 'sha256:' || repeat('2', 64), 'sha256:' || repeat('c2', 32)),
    ('run-cancel-assigned', 'silo-1', 'svc-main', 'rev-published', 'interactive',
     'request-cancel-assigned', 'run-cancel-assigned', 'sha256:' || repeat('3', 64), 'sha256:' || repeat('3', 64)),
    ('run-cancel-running', 'silo-1', 'svc-main', 'rev-published', 'interactive',
     'request-cancel-running', 'run-cancel-running', 'sha256:' || repeat('4', 64), 'sha256:' || repeat('4', 64)),
    ('run-cancel-waiting', 'silo-1', 'svc-main', 'rev-published', 'interactive',
     'request-cancel-waiting', 'run-cancel-waiting', 'sha256:' || repeat('5', 64), 'sha256:' || repeat('5', 64));

UPDATE "agent_runs" SET "state" = 'queued'
WHERE "id" IN ('run-cancel-queued', 'run-cancel-assigned', 'run-cancel-running', 'run-cancel-waiting');
UPDATE "agent_runs" SET "state" = 'assigned'
WHERE "id" IN ('run-cancel-assigned', 'run-cancel-running', 'run-cancel-waiting');
UPDATE "agent_runs" SET "state" = 'running', "started_at" = clock_timestamp()
WHERE "id" IN ('run-cancel-running', 'run-cancel-waiting');
UPDATE "agent_runs" SET "state" = 'waiting_for_approval' WHERE "id" = 'run-cancel-waiting';

SELECT pg_temp.expect_failure(
    'an active AgentRun cannot skip Cancelling',
    $statement$
        UPDATE "agent_runs"
        SET "state" = 'cancelled', "finished_at" = clock_timestamp(), "terminal_reason" = 'user_cancelled'
        WHERE "id" = 'run-cancel-running'
    $statement$,
    'invalid AgentRun state transition'
);

UPDATE "agent_runs" SET "state" = 'cancelling'
WHERE "id" IN (
    'run-cancel-accepted', 'run-cancel-queued', 'run-cancel-assigned',
    'run-cancel-running', 'run-cancel-waiting'
);

SELECT pg_temp.assert_true(
    'every active AgentRun state may enter nonterminal Cancelling',
    (SELECT count(*) = 5
     FROM "agent_runs"
     WHERE "id" LIKE 'run-cancel-%' AND "state" = 'cancelling'
       AND "finished_at" IS NULL AND "terminal_reason" IS NULL)
);

SELECT pg_temp.expect_failure(
    'Cancelling cannot carry terminal fields',
    $statement$
        UPDATE "agent_runs"
        SET "finished_at" = clock_timestamp(), "terminal_reason" = 'user_cancelled'
        WHERE "id" = 'run-cancel-accepted'
    $statement$,
    'agent_runs_terminal_check'
);

SELECT pg_temp.expect_failure(
    'Cancelling may transition only to Cancelled',
    $statement$
        UPDATE "agent_runs"
        SET "state" = 'failed', "finished_at" = clock_timestamp(), "terminal_reason" = 'runtime_failure'
        WHERE "id" = 'run-cancel-queued'
    $statement$,
    'invalid AgentRun state transition'
);

SELECT pg_temp.expect_failure(
    'Cancelled requires its RunCancellationRequested event',
    $statement$
        UPDATE "agent_runs"
        SET "state" = 'cancelled', "finished_at" = clock_timestamp(), "terminal_reason" = 'user_cancelled'
        WHERE "id" = 'run-cancel-accepted'
    $statement$,
    'requires its RunCancellationRequested event'
);

INSERT INTO "run_outbox_events" (
    "id", "run_id", "attempt", "sequence", "kind", "idempotency_key", "payload"
) VALUES (
    'outbox-cancel-accepted-cancellation', 'run-cancel-accepted', 1, 1, 'run.cancellation_requested',
    'run-cancel-accepted:cancellation:1', '{"runId":"run-cancel-accepted","attempt":1}'
);

UPDATE "agent_runs"
SET "state" = 'cancelled', "finished_at" = clock_timestamp(), "terminal_reason" = 'user_cancelled'
WHERE "id" = 'run-cancel-accepted';

SELECT pg_temp.assert_true(
    'Cancelled finalises without physical work when nothing was ever assigned or claimed',
    (SELECT "state" = 'cancelled' AND "finished_at" IS NOT NULL AND "terminal_reason" = 'user_cancelled'
     FROM "agent_runs" WHERE "id" = 'run-cancel-accepted')
);

INSERT INTO "run_outbox_events" (
    "id", "run_id", "attempt", "sequence", "kind", "idempotency_key", "payload"
) VALUES (
    'outbox-cancel-cleanup', 'run-cancel-running', 1, 1, 'run.workload_cleanup_requested',
    'run-cancel-running:cleanup:1', '{"runId":"run-cancel-running","attempt":1}'
);

SELECT pg_temp.assert_true(
    'cancellation cleanup has a dedicated outbox event kind',
    (SELECT "kind" = 'run.workload_cleanup_requested'::"RunOutboxEventKind"
     FROM "run_outbox_events" WHERE "id" = 'outbox-cancel-cleanup')
);

INSERT INTO "conversation_threads" ("id", "silo_id", "agent_service_id", "updated_at")
VALUES ('thread-cancel-event', 'silo-1', 'svc-main', clock_timestamp());
INSERT INTO "agent_runs" (
    "id", "silo_id", "agent_service_id", "agent_revision_id", "thread_id", "trigger",
    "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest"
) VALUES (
    'run-cancel-event', 'silo-1', 'svc-main', 'rev-published', 'thread-cancel-event', 'interactive',
    'request-cancel-event', 'run-cancel-event', 'sha256:' || repeat('6', 64), 'sha256:' || repeat('c6', 32)
);
UPDATE "agent_runs" SET "state" = 'cancelling' WHERE "id" = 'run-cancel-event';

SELECT pg_temp.expect_failure(
    'Cancelling cannot publish the terminal cancellation event',
    $statement$
        INSERT INTO "conversation_run_events" ("run_id", "sequence", "type", "payload", "occurred_at")
        VALUES ('run-cancel-event', 1, 'run.cancelled', '{}', clock_timestamp())
    $statement$,
    'requires Cancelled AgentRun authority'
);

INSERT INTO "run_outbox_events" (
    "id", "run_id", "attempt", "sequence", "kind", "idempotency_key", "payload"
) VALUES (
    'outbox-cancel-event-cancellation', 'run-cancel-event', 1, 1, 'run.cancellation_requested',
    'run-cancel-event:cancellation:1', '{"runId":"run-cancel-event","attempt":1}'
);

UPDATE "agent_runs"
SET "state" = 'cancelled', "finished_at" = clock_timestamp(), "terminal_reason" = 'user_cancelled'
WHERE "id" = 'run-cancel-event';
INSERT INTO "conversation_run_events" ("run_id", "sequence", "type", "payload", "occurred_at")
VALUES ('run-cancel-event', 1, 'run.cancelled', '{}', clock_timestamp());

INSERT INTO "agent_runs" (
    "id", "silo_id", "agent_service_id", "agent_revision_id", "trigger",
    "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest"
) VALUES
    ('run-cancel-bootstrap', 'silo-1', 'svc-main', 'rev-published', 'interactive',
     'request-cancel-bootstrap', 'run-cancel-bootstrap', 'sha256:' || repeat('7', 64), 'sha256:' || repeat('7', 64)),
    ('run-cancel-proof', 'silo-1', 'svc-main', 'rev-published', 'interactive',
     'request-cancel-proof', 'run-cancel-proof', 'sha256:' || repeat('8', 64), 'sha256:' || repeat('8', 64));
UPDATE "agent_runs" SET "state" = 'queued' WHERE "id" IN ('run-cancel-bootstrap', 'run-cancel-proof');

INSERT INTO "workload_assignments" (
    "run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "subject_id",
    "audience", "service_account_name", "namespace", "workload_kind", "workload_uid", "workload_profile", "expires_at"
) VALUES
    ('run-cancel-bootstrap', 1, 'svc-main', 'rev-published', 'silo-1', 'user-1',
     'opencrane-agent-runtime', 'runtime', 'tenant-silo-1', 'job', 'job-uid-cancel-bootstrap', 'personal-small', clock_timestamp() + interval '1 hour'),
    ('run-cancel-proof', 1, 'svc-main', 'rev-published', 'silo-1', 'user-1',
     'opencrane-agent-runtime', 'runtime', 'tenant-silo-1', 'job', 'job-uid-cancel-proof', 'personal-small', clock_timestamp() + interval '1 hour');
UPDATE "agent_runs" SET "state" = 'assigned' WHERE "id" IN ('run-cancel-bootstrap', 'run-cancel-proof');

INSERT INTO "workload_bootstraps" (
    "id", "run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "subject_id",
    "audience", "service_account_name", "namespace", "workload_kind", "workload_uid", "claim_digest", "expires_at"
) VALUES
    ('bootstrap-cancel-bootstrap', 'run-cancel-bootstrap', 1, 'svc-main', 'rev-published', 'silo-1', 'user-1',
     'opencrane-agent-runtime', 'runtime', 'tenant-silo-1', 'job', 'job-uid-cancel-bootstrap',
     'sha256:' || repeat('9', 64), clock_timestamp() + interval '30 minutes'),
    ('bootstrap-cancel-proof', 'run-cancel-proof', 1, 'svc-main', 'rev-published', 'silo-1', 'user-1',
     'opencrane-agent-runtime', 'runtime', 'tenant-silo-1', 'job', 'job-uid-cancel-proof',
     'sha256:' || repeat('a', 64), clock_timestamp() + interval '30 minutes');

UPDATE "workload_assignments"
SET "state" = 'registered', "pod_uid" = 'pod-uid-cancel-bootstrap', "registered_at" = clock_timestamp()
WHERE "run_id" = 'run-cancel-bootstrap';
UPDATE "workload_assignments"
SET "state" = 'registered', "pod_uid" = 'pod-uid-cancel-proof', "registered_at" = clock_timestamp()
WHERE "run_id" = 'run-cancel-proof';
UPDATE "workload_bootstraps"
SET "consumed_at" = clock_timestamp(), "consumed_by_pod_uid" = 'pod-uid-cancel-proof',
    "receipt_id" = 'receipt-cancel-proof'
WHERE "id" = 'bootstrap-cancel-proof';

UPDATE "agent_runs" SET "state" = 'cancelling' WHERE "id" IN ('run-cancel-bootstrap', 'run-cancel-proof');

SELECT pg_temp.expect_failure(
    'Cancelling cannot consume a workload bootstrap',
    $statement$
        UPDATE "workload_bootstraps"
        SET "consumed_at" = clock_timestamp(), "consumed_by_pod_uid" = 'pod-uid-cancel-bootstrap',
            "receipt_id" = 'receipt-cancel-bootstrap'
        WHERE "id" = 'bootstrap-cancel-bootstrap'
    $statement$,
    'consumption requires the current Assigned attempt'
);

SELECT pg_temp.expect_failure(
    'Cancelling cannot mint a RunProofKey from an earlier consumed bootstrap',
    $statement$
        INSERT INTO "run_proof_keys" (
            "id", "bootstrap_id", "run_id", "attempt", "workload_kind", "workload_uid", "pod_uid",
            "public_key_jwk", "key_thumbprint", "expires_at"
        ) VALUES (
            'proof-key-cancelled', 'bootstrap-cancel-proof', 'run-cancel-proof', 1,
            'job', 'job-uid-cancel-proof', 'pod-uid-cancel-proof', '{}', repeat('z', 43),
            clock_timestamp() + interval '20 minutes'
        )
    $statement$,
    'requires the current Assigned attempt'
);

-- Cancelling -> Cancelled: a current Registered WorkloadAssignment blocks finalisation (D1),
-- then a missing published RunWorkloadCleanupRequested blocks it once the assignment exists (D5),
-- until the confirmed cleanup event lets the fenced run finalise (S2, assigned variant).
SELECT pg_temp.expect_failure(
    'Cancelled requires no current Registered WorkloadAssignment',
    $statement$
        UPDATE "agent_runs"
        SET "state" = 'cancelled', "finished_at" = clock_timestamp(), "terminal_reason" = 'user_cancelled'
        WHERE "id" = 'run-cancel-bootstrap'
    $statement$,
    'requires no current PendingPod or Registered WorkloadAssignment'
);

UPDATE "workload_assignments"
SET "state" = 'revoked', "revoked_at" = clock_timestamp()
WHERE "run_id" = 'run-cancel-bootstrap';

SELECT pg_temp.expect_failure(
    'Cancelled still requires its RunCancellationRequested event once the assignment is revoked',
    $statement$
        UPDATE "agent_runs"
        SET "state" = 'cancelled', "finished_at" = clock_timestamp(), "terminal_reason" = 'user_cancelled'
        WHERE "id" = 'run-cancel-bootstrap'
    $statement$,
    'requires its RunCancellationRequested event'
);

INSERT INTO "run_outbox_events" (
    "id", "run_id", "attempt", "sequence", "kind", "idempotency_key", "payload"
) VALUES (
    'outbox-cancel-bootstrap-cancellation', 'run-cancel-bootstrap', 1, 1, 'run.cancellation_requested',
    'run-cancel-bootstrap:cancellation:1', '{"runId":"run-cancel-bootstrap","attempt":1}'
);

SELECT pg_temp.expect_failure(
    'Cancelled requires a confirmed WorkloadCleanup once a WorkloadAssignment ever existed',
    $statement$
        UPDATE "agent_runs"
        SET "state" = 'cancelled', "finished_at" = clock_timestamp(), "terminal_reason" = 'user_cancelled'
        WHERE "id" = 'run-cancel-bootstrap'
    $statement$,
    'requires a confirmed WorkloadCleanup'
);

INSERT INTO "run_outbox_events" (
    "id", "run_id", "attempt", "sequence", "kind", "idempotency_key", "payload"
) VALUES (
    'outbox-cancel-bootstrap-cleanup', 'run-cancel-bootstrap', 1, 2, 'run.workload_cleanup_requested',
    'run-cancel-bootstrap:cleanup:1', '{"runId":"run-cancel-bootstrap","attempt":1}'
);

SELECT pg_temp.expect_failure(
    'Cancelled requires the WorkloadCleanup to be published, not merely requested',
    $statement$
        UPDATE "agent_runs"
        SET "state" = 'cancelled', "finished_at" = clock_timestamp(), "terminal_reason" = 'user_cancelled'
        WHERE "id" = 'run-cancel-bootstrap'
    $statement$,
    'requires a confirmed WorkloadCleanup'
);

UPDATE "run_outbox_events" SET "published_at" = clock_timestamp()
WHERE "id" = 'outbox-cancel-bootstrap-cleanup';

UPDATE "agent_runs"
SET "state" = 'cancelled', "finished_at" = clock_timestamp(), "terminal_reason" = 'user_cancelled'
WHERE "id" = 'run-cancel-bootstrap';

SELECT pg_temp.assert_true(
    'Cancelled finalises once its assignment is revoked and its WorkloadCleanup is confirmed',
    (SELECT "state" = 'cancelled' AND "finished_at" IS NOT NULL AND "terminal_reason" = 'user_cancelled'
     FROM "agent_runs" WHERE "id" = 'run-cancel-bootstrap')
);

-- Cancelling -> Cancelled: an unrevoked RunProofKey blocks finalisation even after its
-- WorkloadAssignment is revoked (D2), independent of the outbox-event invariants above.
INSERT INTO "agent_runs" (
    "id", "silo_id", "agent_service_id", "agent_revision_id", "trigger",
    "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest"
) VALUES (
    'run-cancel-invariant-proofkey', 'silo-1', 'svc-main', 'rev-published', 'interactive',
    'request-cancel-invariant-proofkey', 'run-cancel-invariant-proofkey',
    'sha256:' || repeat('d3', 32), 'sha256:' || repeat('d3', 32)
);
UPDATE "agent_runs" SET "state" = 'queued' WHERE "id" = 'run-cancel-invariant-proofkey';

INSERT INTO "workload_assignments" (
    "run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "subject_id",
    "audience", "service_account_name", "namespace", "workload_kind", "workload_uid", "workload_profile", "expires_at"
) VALUES (
    'run-cancel-invariant-proofkey', 1, 'svc-main', 'rev-published', 'silo-1', 'user-1',
    'opencrane-agent-runtime', 'runtime', 'tenant-silo-1', 'job', 'job-uid-cancel-invariant-proofkey', 'personal-small',
    clock_timestamp() + interval '1 hour'
);
UPDATE "agent_runs" SET "state" = 'assigned' WHERE "id" = 'run-cancel-invariant-proofkey';

INSERT INTO "workload_bootstraps" (
    "id", "run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "subject_id",
    "audience", "service_account_name", "namespace", "workload_kind", "workload_uid", "claim_digest", "expires_at"
) VALUES (
    'bootstrap-cancel-invariant-proofkey', 'run-cancel-invariant-proofkey', 1, 'svc-main', 'rev-published', 'silo-1', 'user-1',
    'opencrane-agent-runtime', 'runtime', 'tenant-silo-1', 'job', 'job-uid-cancel-invariant-proofkey',
    'sha256:' || repeat('d4', 32), clock_timestamp() + interval '30 minutes'
);

UPDATE "workload_assignments"
SET "state" = 'registered', "pod_uid" = 'pod-uid-cancel-invariant-proofkey', "registered_at" = clock_timestamp()
WHERE "run_id" = 'run-cancel-invariant-proofkey';
UPDATE "workload_bootstraps"
SET "consumed_at" = clock_timestamp(), "consumed_by_pod_uid" = 'pod-uid-cancel-invariant-proofkey',
    "receipt_id" = 'receipt-cancel-invariant-proofkey'
WHERE "id" = 'bootstrap-cancel-invariant-proofkey';

INSERT INTO "run_proof_keys" (
    "id", "bootstrap_id", "run_id", "attempt", "workload_kind", "workload_uid", "pod_uid",
    "public_key_jwk", "key_thumbprint", "expires_at"
) VALUES (
    'proof-key-cancel-invariant-proofkey', 'bootstrap-cancel-invariant-proofkey', 'run-cancel-invariant-proofkey', 1,
    'job', 'job-uid-cancel-invariant-proofkey', 'pod-uid-cancel-invariant-proofkey', '{}', repeat('m', 43),
    clock_timestamp() + interval '20 minutes'
);

UPDATE "agent_runs" SET "state" = 'cancelling' WHERE "id" = 'run-cancel-invariant-proofkey';
UPDATE "workload_assignments"
SET "state" = 'revoked', "revoked_at" = clock_timestamp()
WHERE "run_id" = 'run-cancel-invariant-proofkey';

SELECT pg_temp.expect_failure(
    'Cancelled requires every RunProofKey revoked',
    $statement$
        UPDATE "agent_runs"
        SET "state" = 'cancelled', "finished_at" = clock_timestamp(), "terminal_reason" = 'user_cancelled'
        WHERE "id" = 'run-cancel-invariant-proofkey'
    $statement$,
    'requires every RunProofKey revoked'
);

UPDATE "run_proof_keys" SET "revoked_at" = clock_timestamp() WHERE "run_id" = 'run-cancel-invariant-proofkey';

INSERT INTO "run_outbox_events" (
    "id", "run_id", "attempt", "sequence", "kind", "idempotency_key", "payload"
) VALUES (
    'outbox-cancel-invariant-proofkey-cancellation', 'run-cancel-invariant-proofkey', 1, 1, 'run.cancellation_requested',
    'run-cancel-invariant-proofkey:cancellation:1', '{"runId":"run-cancel-invariant-proofkey","attempt":1}'
);
INSERT INTO "run_outbox_events" (
    "id", "run_id", "attempt", "sequence", "kind", "idempotency_key", "payload", "published_at"
) VALUES (
    'outbox-cancel-invariant-proofkey-cleanup', 'run-cancel-invariant-proofkey', 1, 2, 'run.workload_cleanup_requested',
    'run-cancel-invariant-proofkey:cleanup:1', '{"runId":"run-cancel-invariant-proofkey","attempt":1}', clock_timestamp()
);

UPDATE "agent_runs"
SET "state" = 'cancelled', "finished_at" = clock_timestamp(), "terminal_reason" = 'user_cancelled'
WHERE "id" = 'run-cancel-invariant-proofkey';

SELECT pg_temp.assert_true(
    'Cancelled finalises once every RunProofKey is revoked alongside a confirmed WorkloadCleanup',
    (SELECT "state" = 'cancelled' AND "finished_at" IS NOT NULL AND "terminal_reason" = 'user_cancelled'
     FROM "agent_runs" WHERE "id" = 'run-cancel-invariant-proofkey')
);

-- Cancelling -> Cancelled: no WorkloadAssignment ever existed, but the attempt-dispatch event was
-- claimed (a Kubernetes create may be in flight); an unresolved RunAttemptRequested blocks
-- finalisation (D4), and once resolved, cleanup is still required and must be published (D5,
-- unassigned orphan variant) before the run finalises (S2, orphan variant).
INSERT INTO "agent_runs" (
    "id", "silo_id", "agent_service_id", "agent_revision_id", "trigger",
    "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest"
) VALUES (
    'run-cancel-invariant-outbox', 'silo-1', 'svc-main', 'rev-published', 'interactive',
    'request-cancel-invariant-outbox', 'run-cancel-invariant-outbox',
    'sha256:' || repeat('d2', 32), 'sha256:' || repeat('d2', 32)
);

INSERT INTO "run_outbox_events" (
    "id", "run_id", "attempt", "sequence", "kind", "idempotency_key", "payload"
) VALUES (
    'outbox-invariant-attempt', 'run-cancel-invariant-outbox', 1, 1, 'run.attempt_requested',
    'run-cancel-invariant-outbox:attempt:1', '{"runId":"run-cancel-invariant-outbox","attempt":1}'
);

UPDATE "agent_runs" SET "state" = 'cancelling' WHERE "id" = 'run-cancel-invariant-outbox';

SELECT pg_temp.expect_failure(
    'Cancelled requires its RunCancellationRequested event before any outbox-resolution check',
    $statement$
        UPDATE "agent_runs"
        SET "state" = 'cancelled', "finished_at" = clock_timestamp(), "terminal_reason" = 'user_cancelled'
        WHERE "id" = 'run-cancel-invariant-outbox'
    $statement$,
    'requires its RunCancellationRequested event'
);

INSERT INTO "run_outbox_events" (
    "id", "run_id", "attempt", "sequence", "kind", "idempotency_key", "payload"
) VALUES (
    'outbox-invariant-cancellation', 'run-cancel-invariant-outbox', 1, 2, 'run.cancellation_requested',
    'run-cancel-invariant-outbox:cancellation:1', '{"runId":"run-cancel-invariant-outbox","attempt":1}'
);

SELECT pg_temp.expect_failure(
    'Cancelled requires its attempt command resolved before it can finalise',
    $statement$
        UPDATE "agent_runs"
        SET "state" = 'cancelled', "finished_at" = clock_timestamp(), "terminal_reason" = 'user_cancelled'
        WHERE "id" = 'run-cancel-invariant-outbox'
    $statement$,
    'requires its attempt and release commands resolved'
);

UPDATE "run_outbox_events"
SET "claimed_at" = clock_timestamp(), "delivery_count" = 1,
    "failed_at" = clock_timestamp(), "failure_code" = 'RUN_CANCELLED'
WHERE "id" = 'outbox-invariant-attempt';

SELECT pg_temp.expect_failure(
    'Cancelled requires a confirmed WorkloadCleanup once its attempt event had been claimed',
    $statement$
        UPDATE "agent_runs"
        SET "state" = 'cancelled', "finished_at" = clock_timestamp(), "terminal_reason" = 'user_cancelled'
        WHERE "id" = 'run-cancel-invariant-outbox'
    $statement$,
    'requires a confirmed WorkloadCleanup'
);

INSERT INTO "run_outbox_events" (
    "id", "run_id", "attempt", "sequence", "kind", "idempotency_key", "payload"
) VALUES (
    'outbox-invariant-cleanup', 'run-cancel-invariant-outbox', 1, 3, 'run.workload_cleanup_requested',
    'run-cancel-invariant-outbox:cleanup:1', '{"runId":"run-cancel-invariant-outbox","attempt":1}'
);

SELECT pg_temp.expect_failure(
    'Cancelled requires the orphan WorkloadCleanup to be published, not merely requested',
    $statement$
        UPDATE "agent_runs"
        SET "state" = 'cancelled', "finished_at" = clock_timestamp(), "terminal_reason" = 'user_cancelled'
        WHERE "id" = 'run-cancel-invariant-outbox'
    $statement$,
    'requires a confirmed WorkloadCleanup'
);

UPDATE "run_outbox_events" SET "published_at" = clock_timestamp()
WHERE "id" = 'outbox-invariant-cleanup';

UPDATE "agent_runs"
SET "state" = 'cancelled', "finished_at" = clock_timestamp(), "terminal_reason" = 'user_cancelled'
WHERE "id" = 'run-cancel-invariant-outbox';

SELECT pg_temp.assert_true(
    'Cancelled finalises once a claimed-but-unassigned attempt has its orphan WorkloadCleanup confirmed',
    (SELECT "state" = 'cancelled' AND "finished_at" IS NOT NULL AND "terminal_reason" = 'user_cancelled'
     FROM "agent_runs" WHERE "id" = 'run-cancel-invariant-outbox')
);

-- Cancelling -> Cancelled: an unresolved RunWorkloadReleaseRequested also blocks finalisation (D4),
-- independent of the RunAttemptRequested variant above; with no WorkloadAssignment ever created and
-- no claimed RunAttemptRequested, resolving it alone is sufficient (no WorkloadCleanup required).
INSERT INTO "agent_runs" (
    "id", "silo_id", "agent_service_id", "agent_revision_id", "trigger",
    "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest"
) VALUES (
    'run-cancel-invariant-release', 'silo-1', 'svc-main', 'rev-published', 'interactive',
    'request-cancel-invariant-release', 'run-cancel-invariant-release',
    'sha256:' || repeat('d5', 32), 'sha256:' || repeat('d5', 32)
);

INSERT INTO "run_outbox_events" (
    "id", "run_id", "attempt", "sequence", "kind", "idempotency_key", "payload"
) VALUES
    ('outbox-invariant-release-cancellation', 'run-cancel-invariant-release', 1, 1, 'run.cancellation_requested',
     'run-cancel-invariant-release:cancellation:1', '{"runId":"run-cancel-invariant-release","attempt":1}'),
    ('outbox-invariant-release', 'run-cancel-invariant-release', 1, 2, 'run.workload_release_requested',
     'run-cancel-invariant-release:release:1', '{"runId":"run-cancel-invariant-release","attempt":1}');

UPDATE "agent_runs" SET "state" = 'cancelling' WHERE "id" = 'run-cancel-invariant-release';

SELECT pg_temp.expect_failure(
    'Cancelled requires its release command resolved before it can finalise',
    $statement$
        UPDATE "agent_runs"
        SET "state" = 'cancelled', "finished_at" = clock_timestamp(), "terminal_reason" = 'user_cancelled'
        WHERE "id" = 'run-cancel-invariant-release'
    $statement$,
    'requires its attempt and release commands resolved'
);

UPDATE "run_outbox_events"
SET "claimed_at" = clock_timestamp(), "delivery_count" = 1,
    "failed_at" = clock_timestamp(), "failure_code" = 'RUN_CANCELLED'
WHERE "id" = 'outbox-invariant-release';

UPDATE "agent_runs"
SET "state" = 'cancelled', "finished_at" = clock_timestamp(), "terminal_reason" = 'user_cancelled'
WHERE "id" = 'run-cancel-invariant-release';

SELECT pg_temp.assert_true(
    'Cancelled finalises once its release command resolves with no assignment or claimed attempt outstanding',
    (SELECT "state" = 'cancelled' AND "finished_at" IS NOT NULL AND "terminal_reason" = 'user_cancelled'
     FROM "agent_runs" WHERE "id" = 'run-cancel-invariant-release')
);

INSERT INTO "agent_runs" (
    "id", "silo_id", "agent_service_id", "agent_revision_id", "thread_id", "trigger",
    "request_idempotency_key", "root_run_id", "effective_contract_digest",
    "input_snapshot_digest"
) VALUES (
    'run-action', 'silo-1', 'svc-main', 'rev-published', 'thread-run-action', 'interactive',
    'request-action', 'run-action', 'sha256:' || repeat('3', 64),
    'sha256:' || repeat('b', 64)
);

UPDATE "agent_runs" SET "state" = 'queued' WHERE "id" = 'run-action';

SELECT pg_temp.expect_failure(
    'new WorkloadAssignment cannot begin registered',
    $statement$
        INSERT INTO "workload_assignments" (
            "run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "subject_id",
            "audience", "service_account_name", "namespace", "workload_kind", "workload_uid", "workload_profile",
            "pod_uid", "state", "expires_at", "registered_at"
        ) VALUES (
            'run-action', 1, 'svc-main', 'rev-published', 'silo-1', 'user-1',
            'opencrane-agent-runtime', 'runtime', 'tenant-silo-1', 'job', 'job-uid-invalid', 'personal-small',
            'pod-uid-invalid', 'registered', clock_timestamp() + interval '1 hour', clock_timestamp()
        )
    $statement$,
    'must begin pending_pod'
);

INSERT INTO "workload_assignments" (
    "run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "subject_id",
    "audience", "service_account_name", "namespace", "workload_kind", "workload_uid", "workload_profile", "expires_at"
) VALUES (
    'run-action', 1, 'svc-main', 'rev-published', 'silo-1', 'user-1',
    'opencrane-agent-runtime', 'runtime', 'tenant-silo-1', 'job', 'job-uid-1', 'personal-small', clock_timestamp() + interval '1 hour'
);

SELECT pg_temp.expect_failure(
    'WorkloadAssignment workload profile is immutable',
    $statement$
        UPDATE "workload_assignments"
        SET "workload_profile" = 'personal-large'
        WHERE "run_id" = 'run-action' AND "attempt" = 1
    $statement$,
    'identity is immutable'
);

SELECT pg_temp.expect_failure(
    'WorkloadBootstrap cannot be created before the run is Assigned',
    $statement$
        INSERT INTO "workload_bootstraps" (
            "id", "run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "subject_id",
            "audience", "service_account_name", "namespace", "workload_kind", "workload_uid",
            "claim_digest", "expires_at"
        ) VALUES (
            'bootstrap-too-early', 'run-action', 1, 'svc-main', 'rev-published', 'silo-1', 'user-1',
            'opencrane-agent-runtime', 'runtime', 'tenant-silo-1', 'job', 'job-uid-1',
            'sha256:' || repeat('0', 64), clock_timestamp() + interval '30 minutes'
        )
    $statement$,
    'requires the current Assigned attempt'
);

UPDATE "agent_runs" SET "state" = 'assigned' WHERE "id" = 'run-action';

SELECT pg_temp.expect_failure(
    'new WorkloadBootstrap cannot begin consumed',
    $statement$
        INSERT INTO "workload_bootstraps" (
            "id", "run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "subject_id",
            "audience", "service_account_name", "namespace", "workload_kind", "workload_uid",
            "claim_digest", "expires_at", "consumed_at", "consumed_by_pod_uid", "receipt_id"
        ) VALUES (
            'bootstrap-consumed', 'run-action', 1, 'svc-main', 'rev-published', 'silo-1', 'user-1',
            'opencrane-agent-runtime', 'runtime', 'tenant-silo-1', 'job', 'job-uid-1',
            'sha256:' || repeat('f', 64), clock_timestamp() + interval '30 minutes',
            clock_timestamp(), 'pod-uid-1', 'receipt-invalid'
        )
    $statement$,
    'must begin unconsumed'
);

INSERT INTO "workload_bootstraps" (
    "id", "run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "subject_id",
    "audience", "service_account_name", "namespace", "workload_kind", "workload_uid",
    "claim_digest", "expires_at"
) VALUES (
    'bootstrap-1', 'run-action', 1, 'svc-main', 'rev-published', 'silo-1', 'user-1',
    'opencrane-agent-runtime', 'runtime', 'tenant-silo-1', 'job', 'job-uid-1',
    'sha256:' || repeat('5', 64), clock_timestamp() + interval '30 minutes'
);

SELECT pg_temp.expect_failure(
    'PendingPod assignment cannot smuggle Pod registration while revoking',
    $statement$
        UPDATE "workload_assignments"
        SET "state" = 'revoked', "pod_uid" = 'pod-smuggled',
            "registered_at" = clock_timestamp(), "revoked_at" = clock_timestamp()
        WHERE "run_id" = 'run-action' AND "attempt" = 1
    $statement$,
    'must revoke without Pod registration'
);

UPDATE "workload_assignments"
SET "state" = 'registered', "pod_uid" = 'pod-uid-1', "registered_at" = clock_timestamp()
WHERE "run_id" = 'run-action' AND "attempt" = 1;

SELECT pg_temp.expect_failure(
    'registered WorkloadAssignment rejects a different Pod UID',
    $statement$
        UPDATE "workload_assignments"
        SET "pod_uid" = 'pod-uid-2'
        WHERE "run_id" = 'run-action' AND "attempt" = 1
    $statement$,
    'invalid WorkloadAssignment state transition'
);

SELECT pg_temp.expect_failure(
    'WorkloadBootstrap cannot record a consumption instant after expiry',
    $statement$
        UPDATE "workload_bootstraps"
        SET "consumed_at" = "expires_at" + interval '1 second',
            "consumed_by_pod_uid" = 'pod-uid-1', "receipt_id" = 'receipt-too-late'
        WHERE "id" = 'bootstrap-1'
    $statement$,
    'must be consumed at a current time before expiry'
);

UPDATE "workload_bootstraps"
SET "consumed_at" = clock_timestamp(), "consumed_by_pod_uid" = 'pod-uid-1', "receipt_id" = 'bootstrap-receipt-1'
WHERE "id" = 'bootstrap-1';

INSERT INTO "run_proof_keys" (
    "id", "bootstrap_id", "run_id", "attempt", "workload_kind", "workload_uid", "pod_uid",
    "public_key_jwk", "key_thumbprint", "expires_at"
) VALUES (
    'proof-key-1', 'bootstrap-1', 'run-action', 1, 'job', 'job-uid-1', 'pod-uid-1',
    '{}', repeat('k', 43), clock_timestamp() + interval '20 minutes'
);

INSERT INTO "capability_catalog_revisions" (
    "id", "catalog_id", "revision", "digest", "capabilities", "created_by"
) VALUES (
    'catalog-revision-1', 'catalog-1', 1, 'sha256:' || repeat('6', 64), '{}', 'user-1'
);

UPDATE "agent_runs"
SET "state" = 'running', "started_at" = clock_timestamp()
WHERE "id" = 'run-action';
UPDATE "agent_runs" SET "state" = 'waiting_for_approval' WHERE "id" = 'run-action';

SELECT pg_temp.expect_failure(
    'new ApprovalRequest cannot begin Approved',
    $statement$
        INSERT INTO "approval_requests" (
            "id", "run_id", "attempt", "agent_revision_id", "agent_service_id", "silo_id",
            "proof_key_id", "proof_key_thumbprint", "subject_id", "workload_audience",
            "service_account_name", "namespace", "workload_kind", "workload_uid", "pod_uid",
            "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
            "resource_kind", "resource_id", "action", "arguments_digest", "action_digest",
            "approver_policy_revision", "effective_policy_digest", "state", "expires_at",
            "decided_at", "decided_by", "resume_token_hash"
        ) VALUES (
            'approval-invalid-initial', 'run-action', 1, 'rev-published', 'svc-main', 'silo-1',
            'proof-key-1', repeat('k', 43), 'user-1', 'opencrane-agent-runtime',
            'runtime', 'tenant-silo-1', 'job', 'job-uid-1', 'pod-uid-1',
            'catalog-1', 1, 'sha256:' || repeat('6', 64), 'email.send',
            'message', 'message-1', 'send', 'sha256:' || repeat('8', 64), 'sha256:' || repeat('a', 64),
            'approver-v1', 'sha256:' || repeat('7', 64), 'approved', clock_timestamp() + interval '1 hour',
            clock_timestamp(), 'approver-1', 'resume-invalid'
        )
    $statement$,
    'must begin pending'
);

SELECT pg_temp.expect_failure(
    'new ApprovalRequest cannot carry a pre-created decided_at while otherwise Pending',
    $statement$
        INSERT INTO "approval_requests" (
            "id", "run_id", "attempt", "agent_revision_id", "agent_service_id", "silo_id",
            "proof_key_id", "proof_key_thumbprint", "subject_id", "workload_audience",
            "service_account_name", "namespace", "workload_kind", "workload_uid", "pod_uid",
            "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
            "resource_kind", "resource_id", "action", "arguments_digest", "action_digest",
            "approver_policy_revision", "effective_policy_digest", "expires_at", "decided_at"
        ) VALUES (
            'approval-pre-decided', 'run-action', 1, 'rev-published', 'svc-main', 'silo-1',
            'proof-key-1', repeat('k', 43), 'user-1', 'opencrane-agent-runtime',
            'runtime', 'tenant-silo-1', 'job', 'job-uid-1', 'pod-uid-1',
            'catalog-1', 1, 'sha256:' || repeat('6', 64), 'email.send',
            'message', 'message-pre-decided', 'send', 'sha256:' || repeat('8', 64), 'sha256:' || repeat('9', 64),
            'approver-v1', 'sha256:' || repeat('7', 64), clock_timestamp() + interval '1 hour', clock_timestamp()
        )
    $statement$,
    'must begin pending'
);

SELECT pg_temp.expect_failure(
    'new ApprovalRequest cannot already be expired',
    $statement$
        INSERT INTO "approval_requests" (
            "id", "run_id", "attempt", "agent_revision_id", "agent_service_id", "silo_id",
            "proof_key_id", "proof_key_thumbprint", "subject_id", "workload_audience",
            "service_account_name", "namespace", "workload_kind", "workload_uid", "pod_uid",
            "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
            "resource_kind", "resource_id", "action", "arguments_digest", "action_digest",
            "approver_policy_revision", "effective_policy_digest", "expires_at", "created_at"
        ) VALUES (
            'approval-expired-initial', 'run-action', 1, 'rev-published', 'svc-main', 'silo-1',
            'proof-key-1', repeat('k', 43), 'user-1', 'opencrane-agent-runtime',
            'runtime', 'tenant-silo-1', 'job', 'job-uid-1', 'pod-uid-1',
            'catalog-1', 1, 'sha256:' || repeat('6', 64), 'email.send',
            'message', 'message-expired', 'send', 'sha256:' || repeat('8', 64), 'sha256:' || repeat('b', 64),
            'approver-v1', 'sha256:' || repeat('7', 64),
            clock_timestamp() - interval '1 second', clock_timestamp() - interval '2 seconds'
        )
    $statement$,
    'must have a current, future expiry'
);

INSERT INTO "approval_requests" (
    "id", "run_id", "attempt", "agent_revision_id", "agent_service_id", "silo_id",
    "proof_key_id", "proof_key_thumbprint", "subject_id", "workload_audience",
    "service_account_name", "namespace", "workload_kind", "workload_uid", "pod_uid",
    "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", "resource_id", "action", "arguments_digest", "action_digest",
    "approver_policy_revision", "effective_policy_digest", "expires_at"
) VALUES (
    'approval-1', 'run-action', 1, 'rev-published', 'svc-main', 'silo-1',
    'proof-key-1', repeat('k', 43), 'user-1', 'opencrane-agent-runtime',
    'runtime', 'tenant-silo-1', 'job', 'job-uid-1', 'pod-uid-1',
    'catalog-1', 1, 'sha256:' || repeat('6', 64), 'email.send',
    'message', 'message-approval', 'send', 'sha256:' || repeat('8', 64), 'sha256:' || repeat('c', 64),
    'approver-v1', 'sha256:' || repeat('7', 64), clock_timestamp() + interval '1 hour'
);

SELECT pg_temp.expect_failure(
    'ApprovalRequest subject must match the exact workload assignment',
    $statement$
        INSERT INTO "approval_requests" (
            "id", "run_id", "attempt", "agent_revision_id", "agent_service_id", "silo_id",
            "proof_key_id", "proof_key_thumbprint", "subject_id", "workload_audience",
            "service_account_name", "namespace", "workload_kind", "workload_uid", "pod_uid",
            "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
            "resource_kind", "resource_id", "action", "arguments_digest", "action_digest",
            "approver_policy_revision", "effective_policy_digest", "expires_at"
        ) SELECT
            'approval-forged-subject', "run_id", "attempt", "agent_revision_id", "agent_service_id", "silo_id",
            "proof_key_id", "proof_key_thumbprint", 'user-other', "workload_audience",
            "service_account_name", "namespace", "workload_kind", "workload_uid", "pod_uid",
            "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
            "resource_kind", 'message-forged', "action", "arguments_digest", 'sha256:' || repeat('e', 64),
            "approver_policy_revision", "effective_policy_digest", clock_timestamp() + interval '1 hour'
        FROM "approval_requests" WHERE "id" = 'approval-1'
    $statement$,
    'requires current WaitingForApproval run, assignment, and proof authority'
);

SELECT pg_temp.expect_failure(
    'ApprovalRequest cannot expire before its deadline',
    $statement$
        UPDATE "approval_requests"
        SET "state" = 'expired', "decided_at" = clock_timestamp()
        WHERE "id" = 'approval-1'
    $statement$,
    'may expire only after its deadline'
);

UPDATE "approval_requests"
SET "state" = 'approved', "decided_at" = '2099-01-01T00:00:00Z',
    "decided_by" = 'approver-1', "resume_token_hash" = 'resume-approval-1'
WHERE "id" = 'approval-1';
SELECT pg_temp.assert_true(
    'ApprovalRequest decision time is database-owned and before expiry',
    (SELECT "decided_at" <= clock_timestamp() AND "decided_at" < "expires_at"
     FROM "approval_requests" WHERE "id" = 'approval-1')
);
UPDATE "approval_requests"
SET "resume_token_hash" = NULL
WHERE "id" = 'approval-1';
SELECT pg_temp.assert_true(
    'approved ApprovalRequest consumes its resume token exactly once',
    (SELECT "state" = 'approved' AND "resume_token_hash" IS NULL
     FROM "approval_requests" WHERE "id" = 'approval-1')
);
SELECT pg_temp.expect_failure(
    'approved ApprovalRequest cannot mutate after its resume token is consumed',
    $statement$
        UPDATE "approval_requests"
        SET "decided_by" = 'replacement-approver'
        WHERE "id" = 'approval-1'
    $statement$,
    'may only consume its resume token once'
);

INSERT INTO "approval_requests" (
    "id", "run_id", "attempt", "agent_revision_id", "agent_service_id", "silo_id",
    "proof_key_id", "proof_key_thumbprint", "subject_id", "workload_audience",
    "service_account_name", "namespace", "workload_kind", "workload_uid", "pod_uid",
    "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", "resource_id", "action", "arguments_digest", "action_digest",
    "approver_policy_revision", "effective_policy_digest", "expires_at"
) VALUES (
    'approval-expiring', 'run-action', 1, 'rev-published', 'svc-main', 'silo-1',
    'proof-key-1', repeat('k', 43), 'user-1', 'opencrane-agent-runtime',
    'runtime', 'tenant-silo-1', 'job', 'job-uid-1', 'pod-uid-1',
    'catalog-1', 1, 'sha256:' || repeat('6', 64), 'email.send',
    'message', 'message-expiring', 'send', 'sha256:' || repeat('8', 64), 'sha256:' || repeat('d', 64),
    'approver-v1', 'sha256:' || repeat('7', 64), clock_timestamp() + interval '300 milliseconds'
);
SELECT pg_sleep(0.4);
SELECT pg_temp.expect_failure(
    'ApprovalRequest cannot be approved after its deadline',
    $statement$
        UPDATE "approval_requests"
        SET "state" = 'approved', "decided_at" = clock_timestamp(),
            "decided_by" = 'approver-1', "resume_token_hash" = 'resume-too-late'
        WHERE "id" = 'approval-expiring'
    $statement$,
    'decisions must be recorded before expiry'
);
UPDATE "approval_requests"
SET "state" = 'expired', "decided_at" = clock_timestamp()
WHERE "id" = 'approval-expiring';
SELECT pg_temp.assert_true(
    'ApprovalRequest expires only after its deadline',
    (SELECT "state" = 'expired' AND "decided_at" >= "expires_at"
     FROM "approval_requests" WHERE "id" = 'approval-expiring')
);

INSERT INTO "approval_requests" (
    "id", "run_id", "attempt", "agent_revision_id", "agent_service_id", "silo_id",
    "proof_key_id", "proof_key_thumbprint", "subject_id", "workload_audience",
    "service_account_name", "namespace", "workload_kind", "workload_uid", "pod_uid",
    "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", "resource_id", "action", "arguments_digest", "action_digest",
    "approver_policy_revision", "effective_policy_digest", "expires_at"
) SELECT
    'approval-stale-cancellation', "run_id", "attempt", "agent_revision_id", "agent_service_id", "silo_id",
    "proof_key_id", "proof_key_thumbprint", "subject_id", "workload_audience",
    "service_account_name", "namespace", "workload_kind", "workload_uid", "pod_uid",
    "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", 'message-stale-cancellation', "action", "arguments_digest", 'sha256:' || repeat('e', 64),
    "approver_policy_revision", "effective_policy_digest", clock_timestamp() + interval '300 milliseconds'
FROM "approval_requests" WHERE "id" = 'approval-1';
SELECT pg_sleep(0.4);
CREATE TEMP TABLE cancellation_test_clock (
    cancelled_at TIMESTAMP(3) NOT NULL
) ON COMMIT DROP;
INSERT INTO cancellation_test_clock VALUES (clock_timestamp()::timestamp(3));
SELECT pg_temp.expect_failure(
    'ApprovalRequest cancellation requires the shared caller-owned instant',
    $statement$
        UPDATE "approval_requests"
        SET "state" = 'cancelled'
        WHERE "id" = 'approval-stale-cancellation'
    $statement$,
    'requires a caller-supplied decision time between creation and now'
);
SELECT pg_temp.expect_failure(
    'ApprovalRequest cancellation cannot predate its own creation',
    $statement$
        UPDATE "approval_requests"
        SET "state" = 'cancelled', "decided_at" = '2000-01-01T00:00:00Z'
        WHERE "id" = 'approval-stale-cancellation'
    $statement$,
    'requires a caller-supplied decision time between creation and now'
);
UPDATE "approval_requests"
SET "state" = 'cancelled', "decided_at" = cancellation_test_clock.cancelled_at,
    "decided_by" = 'must-be-cleared', "resume_token_hash" = 'must-be-cleared'
FROM cancellation_test_clock
WHERE "id" = 'approval-stale-cancellation';
SELECT pg_temp.assert_true(
    'cancellation preserves one caller-owned instant while closing a stale Pending ApprovalRequest',
    (SELECT "state" = 'cancelled' AND "decided_at" >= "expires_at"
        AND "decided_at" = cancellation_test_clock.cancelled_at
        AND "decided_by" IS NULL AND "resume_token_hash" IS NULL
     FROM "approval_requests" CROSS JOIN cancellation_test_clock
     WHERE "id" = 'approval-stale-cancellation')
);

INSERT INTO "approval_requests" (
    "id", "run_id", "attempt", "agent_revision_id", "agent_service_id", "silo_id",
    "proof_key_id", "proof_key_thumbprint", "subject_id", "workload_audience",
    "service_account_name", "namespace", "workload_kind", "workload_uid", "pod_uid",
    "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", "resource_id", "action", "arguments_digest", "action_digest",
    "approver_policy_revision", "effective_policy_digest", "expires_at"
) SELECT
    'approval-stale-state', "run_id", "attempt", "agent_revision_id", "agent_service_id", "silo_id",
    "proof_key_id", "proof_key_thumbprint", "subject_id", "workload_audience",
    "service_account_name", "namespace", "workload_kind", "workload_uid", "pod_uid",
    "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", 'message-stale', "action", "arguments_digest", 'sha256:' || repeat('f', 64),
    "approver_policy_revision", "effective_policy_digest", clock_timestamp() + interval '1 hour'
FROM "approval_requests" WHERE "id" = 'approval-1';

UPDATE "agent_runs" SET "state" = 'running' WHERE "id" = 'run-action';
SELECT pg_temp.expect_failure(
    'approval decision fails when the run is no longer WaitingForApproval',
    $statement$
        UPDATE "approval_requests"
        SET "state" = 'approved', "decided_by" = 'approver-1', "resume_token_hash" = 'resume-stale-state'
        WHERE "id" = 'approval-stale-state'
    $statement$,
    'decision authority is no longer current'
);
SELECT pg_temp.assert_true(
    'stale approval remains pending for the caller to resolve as a conflict',
    (SELECT "state" = 'pending' AND "resume_token_hash" IS NULL
     FROM "approval_requests" WHERE "id" = 'approval-stale-state')
);

UPDATE "agent_runs" SET "state" = 'waiting_for_approval' WHERE "id" = 'run-action';
SELECT pg_temp.expect_failure(
    'ActionExecutionReceipt cannot reserve while its current run is waiting',
    $statement$
        INSERT INTO "action_execution_receipts" (
            "id", "silo_id", "subject_id", "audience", "service_account_name", "namespace",
            "workload_kind", "workload_uid", "pod_uid", "run_id", "attempt", "agent_service_id",
            "agent_revision_id", "proof_key_id", "proof_key_thumbprint", "catalog_id", "catalog_revision",
            "catalog_digest", "capability_id", "effective_policy_digest", "resource_kind", "resource_id",
            "action", "arguments_digest", "jti", "replay_mode", "request_fingerprint"
        ) VALUES (
            'receipt-waiting', 'silo-1', 'user-1', 'service:email-send', 'runtime', 'tenant-silo-1',
            'job', 'job-uid-1', 'pod-uid-1', 'run-action', 1, 'svc-main',
            'rev-published', 'proof-key-1', repeat('k', 43), 'catalog-1', 1,
            'sha256:' || repeat('6', 64), 'email.send', 'sha256:' || repeat('7', 64), 'message', 'message-waiting',
            'send', 'sha256:' || repeat('8', 64), 'jti-waiting', 'one_shot', 'sha256:' || repeat('0', 64)
        )
    $statement$,
    'requires the current Running AgentRun attempt'
);
UPDATE "agent_runs" SET "state" = 'running' WHERE "id" = 'run-action';

INSERT INTO "action_execution_receipts" (
    "id", "silo_id", "subject_id", "audience", "service_account_name", "namespace",
    "workload_kind", "workload_uid", "pod_uid", "run_id", "attempt", "agent_service_id",
    "agent_revision_id", "proof_key_id", "proof_key_thumbprint", "catalog_id", "catalog_revision",
    "catalog_digest", "capability_id", "effective_policy_digest", "resource_kind", "resource_id",
    "action", "arguments_digest", "jti", "replay_mode", "request_fingerprint", "reserved_at"
) VALUES (
    'receipt-1', 'silo-1', 'user-1', 'service:email-send', 'runtime', 'tenant-silo-1',
    'job', 'job-uid-1', 'pod-uid-1', 'run-action', 1, 'svc-main',
    'rev-published', 'proof-key-1', repeat('k', 43), 'catalog-1', 1,
    'sha256:' || repeat('6', 64), 'email.send', 'sha256:' || repeat('7', 64), 'message', 'message-1',
    'send', 'sha256:' || repeat('8', 64), 'jti-1', 'one_shot', 'sha256:' || repeat('9', 64),
    '2099-01-01T00:00:00Z'
);

SELECT pg_temp.assert_true(
    'action receipt accepts a service-specific PEP audience independent of bootstrap audience',
    (SELECT "audience" = 'service:email-send' FROM "action_execution_receipts" WHERE "id" = 'receipt-1')
);
SELECT pg_temp.assert_true(
    'action receipt reservation time is database-owned',
    (SELECT "reserved_at" <= clock_timestamp() FROM "action_execution_receipts" WHERE "id" = 'receipt-1')
);

SELECT pg_temp.expect_failure(
    'new ActionExecutionReceipt cannot be inserted directly as succeeded',
    $statement$
        INSERT INTO "action_execution_receipts" (
            "id", "silo_id", "subject_id", "audience", "service_account_name", "namespace",
            "workload_kind", "workload_uid", "pod_uid", "run_id", "attempt", "agent_service_id",
            "agent_revision_id", "proof_key_id", "proof_key_thumbprint", "catalog_id", "catalog_revision",
            "catalog_digest", "capability_id", "effective_policy_digest", "resource_kind", "resource_id",
            "action", "arguments_digest", "jti", "replay_mode", "request_fingerprint",
            "state", "result", "completed_at"
        )
        SELECT
            'receipt-direct-success', "silo_id", "subject_id", "audience", "service_account_name", "namespace",
            "workload_kind", "workload_uid", "pod_uid", "run_id", "attempt", "agent_service_id",
            "agent_revision_id", "proof_key_id", "proof_key_thumbprint", "catalog_id", "catalog_revision",
            "catalog_digest", "capability_id", "effective_policy_digest", "resource_kind", "resource_id",
            "action", "arguments_digest", 'jti-direct-success', "replay_mode", 'sha256:' || repeat('a', 64),
            'succeeded', '{}', clock_timestamp()
        FROM "action_execution_receipts" WHERE "id" = 'receipt-1'
    $statement$,
    'must begin reserved without a result, failure, or completion'
);

SELECT pg_temp.expect_failure(
    'new ActionExecutionReceipt cannot be inserted directly as failed',
    $statement$
        INSERT INTO "action_execution_receipts" (
            "id", "silo_id", "subject_id", "audience", "service_account_name", "namespace",
            "workload_kind", "workload_uid", "pod_uid", "run_id", "attempt", "agent_service_id",
            "agent_revision_id", "proof_key_id", "proof_key_thumbprint", "catalog_id", "catalog_revision",
            "catalog_digest", "capability_id", "effective_policy_digest", "resource_kind", "resource_id",
            "action", "arguments_digest", "jti", "replay_mode", "request_fingerprint",
            "state", "failure_code", "completed_at"
        )
        SELECT
            'receipt-direct-failure', "silo_id", "subject_id", "audience", "service_account_name", "namespace",
            "workload_kind", "workload_uid", "pod_uid", "run_id", "attempt", "agent_service_id",
            "agent_revision_id", "proof_key_id", "proof_key_thumbprint", "catalog_id", "catalog_revision",
            "catalog_digest", "capability_id", "effective_policy_digest", "resource_kind", "resource_id",
            "action", "arguments_digest", 'jti-direct-failure', "replay_mode", 'sha256:' || repeat('b', 64),
            'failed', 'external_failure', clock_timestamp()
        FROM "action_execution_receipts" WHERE "id" = 'receipt-1'
    $statement$,
    'must begin reserved without a result, failure, or completion'
);

UPDATE "run_proof_keys" SET "revoked_at" = clock_timestamp() WHERE "id" = 'proof-key-1';
SELECT pg_temp.expect_failure(
    'ActionExecutionReceipt cannot reserve with a revoked proof key',
    $statement$
        INSERT INTO "action_execution_receipts" (
            "id", "silo_id", "subject_id", "audience", "service_account_name", "namespace",
            "workload_kind", "workload_uid", "pod_uid", "run_id", "attempt", "agent_service_id",
            "agent_revision_id", "proof_key_id", "proof_key_thumbprint", "catalog_id", "catalog_revision",
            "catalog_digest", "capability_id", "effective_policy_digest", "resource_kind", "resource_id",
            "action", "arguments_digest", "jti", "replay_mode", "request_fingerprint"
        ) SELECT
            'receipt-revoked-proof', "silo_id", "subject_id", "audience", "service_account_name", "namespace",
            "workload_kind", "workload_uid", "pod_uid", "run_id", "attempt", "agent_service_id",
            "agent_revision_id", "proof_key_id", "proof_key_thumbprint", "catalog_id", "catalog_revision",
            "catalog_digest", "capability_id", "effective_policy_digest", "resource_kind", "resource_id",
            "action", "arguments_digest", 'jti-revoked-proof', "replay_mode", 'sha256:' || repeat('1', 64)
        FROM "action_execution_receipts" WHERE "id" = 'receipt-1'
    $statement$,
    'requires a current unrevoked RunProofKey'
);

INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_id", "scope_kind", "organization_id", "scope_resource_id",
    "catalog_id", "catalog_revision", "catalog_digest", "capability_id", "resource_kind",
    "resource_id", "effect", "priority", "created_by"
) VALUES (
    'grant-org-1', 'silo-1', 'user-1', NULL,
    'catalog-1', 1, 'sha256:' || repeat('6', 64), 'email.send', 'message',
    'message-1', 'allow', 100, 'user-1'
);

SELECT pg_temp.expect_failure(
    'duplicate organization grant with NULL scope resource is rejected',
    $statement$
        INSERT INTO "authorization_grants" (
            "id", "silo_id", "subject_id", "scope_kind", "organization_id", "scope_resource_id",
            "catalog_id", "catalog_revision", "catalog_digest", "capability_id", "resource_kind",
            "resource_id", "effect", "priority", "created_by"
        ) VALUES (
            'grant-org-2', 'silo-1', 'user-1', NULL,
            'catalog-1', 1, 'sha256:' || repeat('6', 64), 'email.send', 'message',
            'message-1', 'allow', 100, 'user-1'
        )
    $statement$,
    'authorization_grant_exact_authority_key'
);

INSERT INTO "verified_fleet_membership_revisions" (
    "id", "revision", "issuer_id", "issuer_key_id", "silo_id", "issued_at", "expires_at",
    "payload_digest", "signature", "verified_at"
) VALUES
    ('membership-1', 1, 'fleet-issuer', 'key-1', 'silo-1', clock_timestamp() - interval '1 hour',
     clock_timestamp() + interval '1 hour', 'sha256:' || repeat('a', 64), 'signature-1', clock_timestamp() - interval '30 minutes'),
    ('membership-2', 2, 'fleet-issuer', 'key-1', 'silo-1', clock_timestamp() - interval '30 minutes',
     clock_timestamp() + interval '2 hours', 'sha256:' || repeat('b', 64), 'signature-2', clock_timestamp() - interval '10 minutes');

INSERT INTO "verified_fleet_membership_assertions" (
    "id", "revision_id", "assertion_id", "silo_id", "subject_id", "scope_kind", "organization_id"
) VALUES (
    'assertion-before-acceptance-1', 'membership-1', 'assertion-1', 'silo-1', 'user-1', 'organization', 'org-1'
), (
    'assertion-before-acceptance-2', 'membership-2', 'assertion-2', 'silo-1', 'user-1', 'organization', 'org-1'
);

INSERT INTO "highest_accepted_fleet_memberships" (
    "issuer_id", "silo_id", "revision_id", "revision", "accepted_at"
) VALUES ('fleet-issuer', 'silo-1', 'membership-1', 1, clock_timestamp());

SELECT pg_temp.expect_failure(
    'accepted fleet membership revision cannot receive another assertion',
    $statement$
        INSERT INTO "verified_fleet_membership_assertions" (
            "id", "revision_id", "assertion_id", "silo_id", "subject_id", "scope_kind", "organization_id"
        ) VALUES (
            'assertion-after-acceptance-1', 'membership-1', 'assertion-3',
            'silo-1', 'user-2', 'organization', 'org-1'
        )
    $statement$,
    'accepted fleet membership assertions are sealed'
);

SELECT pg_temp.expect_failure(
    'membership high-watermark issuer and silo key cannot mutate',
    $statement$
        UPDATE "highest_accepted_fleet_memberships"
        SET "issuer_id" = 'other-issuer'
        WHERE "issuer_id" = 'fleet-issuer' AND "silo_id" = 'silo-1'
    $statement$,
    'high-watermark key is immutable'
);

UPDATE "highest_accepted_fleet_memberships"
SET "revision_id" = 'membership-2', "revision" = 2, "accepted_at" = "accepted_at" + interval '1 second'
WHERE "issuer_id" = 'fleet-issuer' AND "silo_id" = 'silo-1';

SELECT pg_temp.expect_failure(
    'superseded fleet membership revision remains sealed',
    $statement$
        INSERT INTO "verified_fleet_membership_assertions" (
            "id", "revision_id", "assertion_id", "silo_id", "subject_id", "scope_kind", "organization_id"
        ) VALUES (
            'assertion-after-supersession', 'membership-1', 'assertion-4',
            'silo-1', 'user-3', 'organization', 'org-1'
        )
    $statement$,
    'accepted fleet membership assertions are sealed'
);
SELECT pg_temp.expect_failure(
    'current fleet membership revision is sealed',
    $statement$
        INSERT INTO "verified_fleet_membership_assertions" (
            "id", "revision_id", "assertion_id", "silo_id", "subject_id", "scope_kind", "organization_id"
        ) VALUES (
            'assertion-after-acceptance-2', 'membership-2', 'assertion-5',
            'silo-1', 'user-4', 'organization', 'org-1'
        )
    $statement$,
    'accepted fleet membership assertions are sealed'
);

SELECT pg_temp.expect_failure(
    'membership high-watermark cannot move to an older revision',
    $statement$
        UPDATE "highest_accepted_fleet_memberships"
        SET "revision_id" = 'membership-1', "revision" = 1
        WHERE "issuer_id" = 'fleet-issuer' AND "silo_id" = 'silo-1'
    $statement$,
    'strictly newer verified revision'
);

INSERT INTO "run_outbox_events" (
    "id", "run_id", "attempt", "sequence", "kind", "idempotency_key", "payload"
) VALUES (
    'outbox-1', 'run-action', 1, 1, 'run.accepted', 'outbox-key-1', '{"run":"run-action"}'
);

SELECT pg_temp.expect_failure(
    'outbox payload is immutable',
    $statement$UPDATE "run_outbox_events" SET "payload" = '{}' WHERE "id" = 'outbox-1'$statement$,
    'identity, order, and payload are immutable'
);
SELECT pg_temp.expect_failure(
    'outbox kind is immutable',
    $statement$UPDATE "run_outbox_events" SET "kind" = 'run.resume_requested' WHERE "id" = 'outbox-1'$statement$,
    'identity, order, and payload are immutable'
);
SELECT pg_temp.expect_failure(
    'outbox order is immutable',
    $statement$UPDATE "run_outbox_events" SET "sequence" = 2 WHERE "id" = 'outbox-1'$statement$,
    'identity, order, and payload are immutable'
);

UPDATE "run_outbox_events"
SET "claimed_at" = clock_timestamp(), "delivery_count" = 1
WHERE "id" = 'outbox-1';
UPDATE "run_outbox_events"
SET "published_at" = clock_timestamp()
WHERE "id" = 'outbox-1';

SELECT pg_temp.expect_failure(
    'delivered outbox status cannot reopen',
    $statement$
        UPDATE "run_outbox_events"
        SET "claimed_at" = "claimed_at" + interval '1 second', "delivery_count" = 2
        WHERE "id" = 'outbox-1'
    $statement$,
    'delivered OutboxEvent status is terminal'
);

SELECT pg_temp.expect_failure(
    'delivered outbox cannot be deleted without the retention transaction guard',
    $statement$
        DELETE FROM "run_outbox_events" WHERE "id" = 'outbox-1'
    $statement$,
    'outside successful-delivery retention'
);

BEGIN;
SELECT set_config('opencrane.run_outbox_prune', 'true', true);
DELETE FROM "run_outbox_events" WHERE "id" = 'outbox-1';
COMMIT;
SELECT pg_temp.assert_true(
    'guarded retention transaction can remove a successful delivered outbox record',
    NOT EXISTS (SELECT 1 FROM "run_outbox_events" WHERE "id" = 'outbox-1')
);

INSERT INTO "audit_decisions" (
    "id", "decision_digest", "silo_id", "actor_kind", "actor_id", "audience", "namespace",
    "service_account_name", "workload_kind", "workload_uid", "pod_uid", "run_id", "attempt",
    "agent_service_id", "agent_revision_id", "proof_key_id", "proof_key_thumbprint",
    "resource_kind", "resource_id", "action", "catalog_id", "catalog_revision", "catalog_digest",
    "arguments_digest", "policy_revision_hash", "effective_authorization_digest", "outcome", "reason_code"
) VALUES (
    'audit-1', 'sha256:' || repeat('0', 64), 'silo-1', 'workload', 'pod-uid-1', 'service:email-send', 'tenant-silo-1',
    'runtime', 'job', 'job-uid-1', 'pod-uid-1', 'run-action', 1,
    'svc-main', 'rev-published', 'proof-key-1', repeat('k', 43),
    'message', 'message-1', 'send', 'catalog-1', 1, 'sha256:' || repeat('6', 64),
    'sha256:' || repeat('8', 64), 'sha256:' || repeat('7', 64), 'sha256:' || repeat('9', 64), 'allow', 'authorized'
);

SELECT pg_temp.assert_true(
    'workload audit evidence accepts the exact non-empty PEP audience',
    EXISTS (SELECT 1 FROM "audit_decisions" WHERE "id" = 'audit-1' AND "audience" = 'service:email-send')
);

INSERT INTO "run_input_snapshots" (
    "run_id", "snapshot_version", "silo_id", "agent_service_id", "agent_revision_id",
    "effective_contract_digest", "thread_id", "memory_facts", "identity_snapshot", "model_route",
    "memory_query_policy", "budget_policy", "capability_set_digest", "prompt_compiler_version", "input_digest"
)
SELECT
    "id", 1, "silo_id", "agent_service_id", "agent_revision_id", "effective_contract_digest",
    "thread_id", '[]', '{}', '{}', '{}', '{}', 'sha256:' || repeat('0', 64), 'prompt-v1', "input_snapshot_digest"
FROM "agent_runs"
WHERE "id" IN (
    'run-retry-retirement', 'run-retry-rollover', 'run-state', 'run-action',
    'run-cancel-accepted', 'run-cancel-queued', 'run-cancel-assigned', 'run-cancel-running', 'run-cancel-waiting',
    'run-cancel-event', 'run-cancel-bootstrap', 'run-cancel-proof',
    'run-cancel-invariant-proofkey', 'run-cancel-invariant-outbox', 'run-cancel-invariant-release'
);
SET CONSTRAINTS ALL IMMEDIATE;

ROLLBACK;
