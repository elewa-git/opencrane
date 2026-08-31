BEGIN;

CREATE FUNCTION pg_temp.expect_failure(test_name TEXT, statement TEXT, expected_message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE actual_message TEXT;
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

INSERT INTO "model_definitions" ("id", "scope", "public_model_name", "litellm_model_id", "upstream_model", "updated_at")
VALUES ('run-event-model', 'global', 'run-event-model', 'litellm-run-event-model', 'run-event-model', clock_timestamp());
INSERT INTO "principals" ("id", "silo_id", "issuer", "subject", "provenance", "updated_at")
VALUES ('run-event-service-principal', 'silo-run-event', 'urn:opencrane:agent-service', 'run-event-service', 'internal', clock_timestamp());
INSERT INTO "agent_services" ("id", "silo_id", "kind", "name", "workload_profile", "principal_id", "updated_at")
VALUES ('run-event-service', 'silo-run-event', 'managed', 'Run event test', 'managed-agent', 'run-event-service-principal', clock_timestamp());
INSERT INTO "agent_revisions" ("id", "agent_service_id", "revision", "state", "digest", "prompt_policy_version", "model_definition_id", "budget", "authored_by")
VALUES ('run-event-revision', 'run-event-service', 1, 'draft', 'sha256:' || repeat('a', 64), 'prompt-v1', 'run-event-model', '{}', 'user-run-event');
UPDATE "agent_revisions" SET "state" = 'published', "published_at" = clock_timestamp() WHERE "id" = 'run-event-revision';
UPDATE "agent_services" SET "state" = 'active', "active_revision_id" = 'run-event-revision' WHERE "id" = 'run-event-service';
INSERT INTO "conversations" ("id", "silo_id", "agent_service_id", "mode", "updated_at")
VALUES ('run-event-conversation', 'silo-run-event', 'run-event-service', 'agent_session', clock_timestamp());
INSERT INTO "conversations" ("id", "silo_id", "mode", "updated_at")
VALUES ('direct-conversation', 'silo-run-event', 'direct', clock_timestamp());
SELECT pg_temp.expect_failure(
    'an agent run cannot bind a direct conversation',
    $statement$INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger", "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest") VALUES ('direct-conversation-run', 'silo-run-event', 'run-event-service', 'run-event-revision', 'direct-conversation', 'interactive', 'direct-conversation-request', 'direct-conversation-run', 'sha256:' || repeat('b', 64), 'sha256:' || repeat('e', 64))$statement$,
    'AgentRun requires the exact agent-session Conversation authority'
);
INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger", "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest")
VALUES ('run-event-run', 'silo-run-event', 'run-event-service', 'run-event-revision', 'run-event-conversation', 'interactive', 'run-event-request', 'run-event-run', 'sha256:' || repeat('b', 64), 'sha256:' || repeat('c', 64));
INSERT INTO "run_input_snapshots" ("id", "run_id", "snapshot_version", "silo_id", "agent_service_id", "agent_revision_id", "effective_contract_digest", "conversation_id", "identity_snapshot", "model_route", "mcp_tools", "memory_query_policy", "budget_policy", "capability_set_digest", "prompt_compiler_version", "input_digest")
VALUES ('run-event-input', 'run-event-run', 1, 'silo-run-event', 'run-event-service', 'run-event-revision', 'sha256:' || repeat('b', 64), 'run-event-conversation', '{}', '{}', '[]', '{}', '{}', 'sha256:' || repeat('d', 64), 'prompt-v1', 'sha256:' || repeat('c', 64));
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

INSERT INTO "conversation_participants" ("conversation_id", "user_id", "visible_from_position", "read_through_position") VALUES
    ('run-event-conversation', 'user-run-event', 1, 0),
    ('direct-conversation', 'user-run-event', 1, 0);
SELECT pg_temp.expect_failure(
    'conversation mode is immutable after creation',
    $statement$UPDATE "conversations" SET "mode" = 'group' WHERE "id" = 'direct-conversation'$statement$,
    'Conversation identity, mode, and agent binding are immutable'
);
SELECT pg_temp.expect_failure(
    'agent-session user input requires run provenance',
    $statement$INSERT INTO "conversation_messages" ("id", "conversation_id", "user_id", "idempotency_key", "role", "state", "source", "blocks", "completed_at") VALUES ('missing-run-message', 'run-event-conversation', 'user-run-event', 'missing-run-message', 'user', 'completed', 'user_input', '[]', clock_timestamp())$statement$,
    'user input run provenance must match persisted Conversation mode'
);
SELECT pg_temp.expect_failure(
    'direct user input rejects run provenance',
    $statement$INSERT INTO "conversation_messages" ("id", "conversation_id", "run_id", "user_id", "idempotency_key", "role", "state", "source", "blocks", "completed_at") VALUES ('direct-run-message', 'direct-conversation', 'run-event-run', 'user-run-event', 'direct-run-message', 'user', 'completed', 'user_input', '[]', clock_timestamp())$statement$,
    'user input run provenance must match persisted Conversation mode'
);
INSERT INTO "conversation_messages" ("id", "conversation_id", "user_id", "idempotency_key", "role", "state", "source", "blocks", "completed_at")
VALUES ('direct-message', 'direct-conversation', 'user-run-event', 'direct-message', 'user', 'completed', 'user_input', '[]', clock_timestamp());

INSERT INTO "conversation_run_events" ("conversation_id", "run_id", "sequence", "type", "payload")
VALUES ('run-event-conversation', 'run-event-run', 1, 'run.accepted', '{}');

SELECT pg_temp.expect_failure(
    'run events cannot skip a sequence',
    $statement$INSERT INTO "conversation_run_events" ("conversation_id", "run_id", "sequence", "type", "payload") VALUES ('run-event-conversation', 'run-event-run', 3, 'run.started', '{}')$statement$,
    'RunEvent sequence must be contiguous'
);
SELECT pg_temp.expect_failure(
    'child completion events require a canonical delivery',
    $statement$INSERT INTO "conversation_run_events" ("conversation_id", "run_id", "sequence", "type", "payload") VALUES ('run-event-conversation', 'run-event-run', 2, 'child.run.completed', '{"childRunId":"forged-child"}')$statement$,
    'child RunEvent requires child completion delivery authority'
);
SELECT pg_temp.expect_failure(
    'completed events require a completed run',
    $statement$INSERT INTO "conversation_run_events" ("conversation_id", "run_id", "sequence", "type", "payload") VALUES ('run-event-conversation', 'run-event-run', 2, 'run.completed', '{}')$statement$,
    'run.completed event requires Completed AgentRun authority'
);

ROLLBACK;
