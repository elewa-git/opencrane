BEGIN;

SELECT pg_temp.seed_silo_model('silo-snapshot', 'execution-snapshot-model');
SELECT pg_temp.seed_managed_service('silo-snapshot', 'snapshot-service', 'execution-snapshot-model', 'snapshot-revision');
SELECT pg_temp.seed_agent_conversation('snapshot-conversation', 'silo-snapshot', 'snapshot-service');
SELECT pg_temp.seed_agent_conversation('snapshot-other-conversation', 'silo-snapshot', 'snapshot-service');
SELECT pg_temp.seed_agent_conversation('snapshot-missing-conversation', 'silo-snapshot', 'snapshot-service');

INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger", "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "input_snapshot_digest") VALUES
('snapshot-run', 'silo-snapshot', 'snapshot-service', 'snapshot-revision', 'snapshot-conversation', 'interactive', 'snapshot-identity', 'snapshot-service-principal', '{"runScope":{"attempt":1}}', 'snapshot-request', 'sha256:' || repeat('c', 64));
INSERT INTO "run_input_snapshots" ("id", "run_id", "attempt", "snapshot_version", "silo_id", "agent_service_id", "agent_revision_id", "agent_identity_id", "principal_id", "execution_subject", "conversation_id", "model_route", "mcp_tools", "memory_query_policy", "budget_policy", "prompt_compiler_version", "input_digest") VALUES
('snapshot-run-input', 'snapshot-run', 1, 1, 'silo-snapshot', 'snapshot-service', 'snapshot-revision', 'snapshot-identity', 'snapshot-service-principal', '{"runScope":{"attempt":1}}', 'snapshot-conversation', '{}', '[]', '{}', '{}', 'prompt-v1', 'sha256:' || repeat('c', 64));
SET CONSTRAINTS ALL IMMEDIATE;

SET CONSTRAINTS ALL DEFERRED;
DO $$
DECLARE actual_message TEXT;
BEGIN
    BEGIN
        INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger", "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "input_snapshot_digest")
        VALUES ('snapshot-missing', 'silo-snapshot', 'snapshot-service', 'snapshot-revision', 'snapshot-missing-conversation', 'interactive', 'snapshot-identity', 'snapshot-service-principal', '{"runScope":{"attempt":1}}', 'snapshot-missing-request', 'sha256:' || repeat('1', 64));
        SET CONSTRAINTS agent_runs_input_snapshot_complete IMMEDIATE;
    EXCEPTION WHEN foreign_key_violation THEN
        GET STACKED DIAGNOSTICS actual_message = MESSAGE_TEXT;
        IF strpos(actual_message, 'AgentRun requires its exact immutable RunInputSnapshot') = 0 THEN RAISE EXCEPTION 'FAIL: expected run completeness rejection, got %', actual_message; END IF;
        RAISE NOTICE 'PASS: a committed AgentRun requires its exact input snapshot';
        SET CONSTRAINTS ALL DEFERRED;
        RETURN;
    END;
    RAISE EXCEPTION 'FAIL: a committed AgentRun unexpectedly succeeded without a snapshot';
END;
$$;

SET CONSTRAINTS ALL DEFERRED;
DO $$
DECLARE actual_message TEXT;
BEGIN
    BEGIN
        INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger", "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "input_snapshot_digest")
        VALUES ('snapshot-subject-mismatch', 'silo-snapshot', 'snapshot-service', 'snapshot-revision', 'snapshot-other-conversation', 'interactive', 'snapshot-identity', 'snapshot-service-principal', '{"runScope":{"attempt":1},"authority":"run"}', 'snapshot-subject-mismatch-request', 'sha256:' || repeat('2', 64));
        INSERT INTO "run_input_snapshots" ("id", "run_id", "attempt", "snapshot_version", "silo_id", "agent_service_id", "agent_revision_id", "agent_identity_id", "principal_id", "execution_subject", "conversation_id", "model_route", "mcp_tools", "memory_query_policy", "budget_policy", "prompt_compiler_version", "input_digest")
        VALUES ('snapshot-subject-mismatch-input', 'snapshot-subject-mismatch', 1, 1, 'silo-snapshot', 'snapshot-service', 'snapshot-revision', 'snapshot-identity', 'snapshot-service-principal', '{"runScope":{"attempt":1},"authority":"snapshot"}', 'snapshot-other-conversation', '{}', '[]', '{}', '{}', 'prompt-v1', 'sha256:' || repeat('2', 64));
        SET CONSTRAINTS run_input_snapshots_run_binding IMMEDIATE;
    EXCEPTION WHEN foreign_key_violation THEN
        GET STACKED DIAGNOSTICS actual_message = MESSAGE_TEXT;
        IF strpos(actual_message, 'RunInputSnapshot must bind the exact AgentRun conversation and authority') = 0 THEN RAISE EXCEPTION 'FAIL: expected execution-subject rejection, got %', actual_message; END IF;
        RAISE NOTICE 'PASS: a snapshot must bind the exact admitted execution subject';
        SET CONSTRAINTS ALL DEFERRED;
        RETURN;
    END;
    RAISE EXCEPTION 'FAIL: mismatched execution subjects unexpectedly succeeded';
END;
$$;

ROLLBACK;
