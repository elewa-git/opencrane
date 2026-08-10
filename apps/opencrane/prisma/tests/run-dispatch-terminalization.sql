BEGIN;

INSERT INTO "model_definitions" ("id", "scope", "public_model_name", "litellm_model_id", "upstream_model", "updated_at")
VALUES ('dispatch-terminal-model', 'global', 'dispatch-terminal-model', 'litellm-dispatch-terminal-model', 'dispatch-terminal-model', clock_timestamp());

INSERT INTO "agent_services" (
    "id", "silo_id", "kind", "name", "workload_profile", "updated_at"
) VALUES (
    'dispatch-terminal-service', 'dispatch-terminal-silo', 'managed', 'Dispatch terminal service',
    'managed-agent', clock_timestamp()
);
INSERT INTO "agent_revisions" (
    "id", "agent_service_id", "revision", "state", "digest", "prompt_policy_version",
    "model_definition_id", "budget", "authored_by"
) VALUES (
    'dispatch-terminal-revision', 'dispatch-terminal-service', 1, 'draft',
    'sha256:' || repeat('a', 64), 'prompt-v1', 'dispatch-terminal-model', '{}', 'dispatch-terminal-user'
);
UPDATE "agent_revisions"
SET "state" = 'published', "published_at" = clock_timestamp()
WHERE "id" = 'dispatch-terminal-revision';
UPDATE "agent_services"
SET "state" = 'active', "active_revision_id" = 'dispatch-terminal-revision'
WHERE "id" = 'dispatch-terminal-service';

INSERT INTO "conversations" ("id", "silo_id", "agent_service_id", "mode", "updated_at")
VALUES ('dispatch-terminal-conversation', 'dispatch-terminal-silo', 'dispatch-terminal-service', 'agent_session', clock_timestamp());
INSERT INTO "agent_runs" (
    "id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger",
    "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest"
) VALUES (
    'dispatch-terminal-run', 'dispatch-terminal-silo', 'dispatch-terminal-service',
    'dispatch-terminal-revision', 'dispatch-terminal-conversation', 'interactive',
    'dispatch-terminal-request', 'dispatch-terminal-run', 'sha256:' || repeat('b', 64),
    'sha256:' || repeat('c', 64)
);
INSERT INTO "run_input_snapshots" (
    "id", "run_id", "snapshot_version", "silo_id", "agent_service_id", "agent_revision_id",
    "effective_contract_digest", "conversation_id", "memory_facts", "identity_snapshot", "model_route",
    "integration_assignments", "memory_query_policy", "budget_policy", "capability_set_digest", "prompt_compiler_version", "input_digest"
) VALUES (
    'dispatch-terminal-input', 'dispatch-terminal-run', 1, 'dispatch-terminal-silo', 'dispatch-terminal-service',
    'dispatch-terminal-revision', 'sha256:' || repeat('b', 64), 'dispatch-terminal-conversation', '[]',
    '{"executionSubjectId":"dispatch-terminal-user","fleetMembershipTrustedUntil":"2026-07-20T00:00:00.000Z"}',
    '{}', '{}', '{}', '{}', 'sha256:' || repeat('d', 64), 'prompt-v1', 'sha256:' || repeat('c', 64)
);
INSERT INTO "run_outbox_events" (
    "id", "run_id", "attempt", "sequence", "kind", "idempotency_key", "payload"
) VALUES (
    'dispatch-terminal-event', 'dispatch-terminal-run', 1, 1, 'run.attempt_requested',
    'dispatch-terminal-run:attempt:1', '{"runId":"dispatch-terminal-run","attempt":1}'
);

UPDATE "run_outbox_events"
SET "claimed_at" = CURRENT_TIMESTAMP, "delivery_count" = 1,
    "failed_at" = CURRENT_TIMESTAMP, "failure_code" = 'RUN_DISPATCH_MEMBERSHIP_EXPIRED'
WHERE "id" = 'dispatch-terminal-event';
UPDATE "agent_runs"
SET "state" = 'failed', "terminal_reason" = 'policy_denied', "finished_at" = clock_timestamp()
WHERE "id" = 'dispatch-terminal-run';
INSERT INTO "conversation_run_events" ("conversation_id", "run_id", "sequence", "type", "payload", "occurred_at")
VALUES (
    'dispatch-terminal-conversation', 'dispatch-terminal-run', 1, 'run.failed',
    '{"terminalReason":"policy_denied","failureCode":"RUN_DISPATCH_MEMBERSHIP_EXPIRED"}',
    clock_timestamp()
);

SET CONSTRAINTS ALL IMMEDIATE;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "agent_runs" run
        JOIN "run_outbox_events" event ON event."run_id" = run."id"
        JOIN "conversation_run_events" conversation_event ON conversation_event."run_id" = run."id"
        WHERE run."id" = 'dispatch-terminal-run'
          AND run."state" = 'failed' AND run."terminal_reason" = 'policy_denied'
          AND event."claimed_at" IS NOT NULL AND event."delivery_count" = 1
          AND event."failed_at" IS NOT NULL AND event."failure_code" = 'RUN_DISPATCH_MEMBERSHIP_EXPIRED'
          AND conversation_event."sequence" = 1 AND conversation_event."type" = 'run.failed'
    ) THEN
        RAISE EXCEPTION 'FAIL: poisoned dispatch terminalisation did not preserve run, outbox, and conversation invariants';
    END IF;
    RAISE NOTICE 'PASS: poisoned dispatch terminalisation preserves run, outbox, and conversation invariants';
END;
$$;

ROLLBACK;
