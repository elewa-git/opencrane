BEGIN;

INSERT INTO "model_definitions" ("id", "scope", "public_model_name", "litellm_model_id", "upstream_model", "updated_at")
VALUES ('conversation-model', 'global', 'conversation-model', 'litellm-conversation-model', 'conversation-model', clock_timestamp());

CREATE FUNCTION pg_temp.expect_failure(test_name TEXT, statement TEXT, expected_message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE actual_message TEXT;
BEGIN
    BEGIN EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS actual_message = MESSAGE_TEXT;
        IF strpos(actual_message, expected_message) > 0 THEN RAISE NOTICE 'PASS: %', test_name; RETURN; END IF;
        RAISE EXCEPTION 'FAIL: % returned unexpected error: %', test_name, actual_message;
    END;
    RAISE EXCEPTION 'FAIL: % unexpectedly succeeded', test_name;
END;
$$;

INSERT INTO "agent_services" ("id", "silo_id", "kind", "name", "workload_profile", "updated_at")
VALUES ('conversation-service', 'silo-conversation', 'managed', 'Conversation test', 'managed-agent', clock_timestamp());
INSERT INTO "agent_revisions" ("id", "agent_service_id", "revision", "state", "digest", "prompt_policy_version", "model_definition_id", "budget", "authored_by")
VALUES ('conversation-agent-revision', 'conversation-service', 1, 'draft', 'sha256:' || repeat('a', 64), 'prompt-v1', 'conversation-model', '{}', 'user-1');
UPDATE "agent_revisions" SET "state" = 'published', "published_at" = clock_timestamp() WHERE "id" = 'conversation-agent-revision';
UPDATE "agent_services" SET "state" = 'active', "active_revision_id" = 'conversation-agent-revision' WHERE "id" = 'conversation-service';
SELECT pg_temp.expect_failure('thread must bind its exact agent service', $statement$INSERT INTO "conversation_threads" ("id", "silo_id", "agent_service_id", "updated_at") VALUES ('thread-missing-service','silo-conversation','missing-service',clock_timestamp())$statement$, 'conversation_threads_agent_service_id_silo_id_fkey');
INSERT INTO "conversation_threads" ("id", "silo_id", "agent_service_id", "updated_at") VALUES ('thread-1', 'silo-conversation', 'conversation-service', clock_timestamp());
INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "thread_id", "trigger", "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest")
VALUES ('conversation-run', 'silo-conversation', 'conversation-service', 'conversation-agent-revision', 'thread-1', 'interactive', 'conversation-request', 'conversation-run', 'sha256:' || repeat('b', 64), 'sha256:' || repeat('c', 64));
INSERT INTO "run_input_snapshots" ("run_id", "snapshot_version", "silo_id", "agent_service_id", "agent_revision_id", "effective_contract_digest", "thread_id", "memory_facts", "identity_snapshot", "model_route", "memory_query_policy", "budget_policy", "capability_set_digest", "prompt_compiler_version", "input_digest")
VALUES ('conversation-run', 1, 'silo-conversation', 'conversation-service', 'conversation-agent-revision', 'sha256:' || repeat('b', 64), 'thread-1', '[]', '{}', '{}', '{}', '{}', 'sha256:' || repeat('d', 64), 'prompt-v1', 'sha256:' || repeat('c', 64));
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT pg_temp.expect_failure('run must bind its exact conversation thread', $statement$INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "thread_id", "trigger", "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest") VALUES ('missing-thread-run','silo-conversation','conversation-service','conversation-agent-revision','missing-thread','interactive','missing-thread-request','missing-thread-run','sha256:'||repeat('e',64),'sha256:'||repeat('f',64))$statement$, 'agent_runs_conversation_thread_fkey');
INSERT INTO "conversation_run_events" ("run_id", "sequence", "type", "payload") VALUES ('conversation-run', 1, 'run.accepted', '{}');

SELECT pg_temp.expect_failure('event sequence cannot skip', $statement$INSERT INTO "conversation_run_events" ("run_id", "sequence", "type", "payload") VALUES ('conversation-run', 3, 'run.started', '{}')$statement$, 'must be contiguous');
SELECT pg_temp.expect_failure('terminal event requires matching run authority', $statement$INSERT INTO "conversation_run_events" ("run_id", "sequence", "type", "payload") VALUES ('conversation-run', 2, 'run.completed', '{}')$statement$, 'requires Completed AgentRun authority');
UPDATE "agent_runs" SET "state"='failed', "finished_at"=clock_timestamp(), "terminal_reason"='runtime_failure' WHERE "id"='conversation-run';
INSERT INTO "conversation_run_events" ("run_id", "sequence", "type", "payload") VALUES ('conversation-run', 2, 'run.failed', '{}');
SELECT pg_temp.expect_failure('terminal event fences later append', $statement$INSERT INTO "conversation_run_events" ("run_id", "sequence", "type", "payload") VALUES ('conversation-run', 3, 'run.usage', '{}')$statement$, 'stream is terminal');
SELECT pg_temp.expect_failure('events are append only', $statement$UPDATE "conversation_run_events" SET "payload" = '{"changed":true}' WHERE "run_id" = 'conversation-run' AND "sequence" = 1$statement$, 'history is immutable');
SELECT pg_temp.expect_failure('model output requires run provenance', $statement$INSERT INTO "conversation_messages" ("id", "thread_id", "role", "state", "source", "blocks", "completed_at") VALUES ('bad-model-message','thread-1','assistant','completed','model_output','[]',clock_timestamp())$statement$, 'exact run provenance');
INSERT INTO "conversation_threads" ("id", "silo_id", "agent_service_id", "updated_at") VALUES ('thread-2', 'silo-conversation', 'conversation-service', clock_timestamp());
SELECT pg_temp.expect_failure('message run cannot cross threads', $statement$INSERT INTO "conversation_messages" ("id", "thread_id", "run_id", "role", "state", "source", "blocks", "completed_at") VALUES ('cross-thread-message','thread-2','conversation-run','assistant','completed','model_output','[]',clock_timestamp())$statement$, 'exact thread and silo');

ROLLBACK;
