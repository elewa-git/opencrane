BEGIN;

INSERT INTO "model_definitions" ("id", "silo_id", "scope", "public_model_name", "litellm_model_id", "upstream_model", "updated_at")
VALUES ('execution-snapshot-model', 'silo-snapshot', 'global', 'execution-snapshot-model', 'litellm-execution-snapshot-model', 'execution-snapshot-model', clock_timestamp());
INSERT INTO "principals" ("id", "silo_id", "issuer", "subject", "provenance", "updated_at")
VALUES ('snapshot-principal', 'silo-snapshot', 'urn:opencrane:test', 'snapshot-principal', 'internal', clock_timestamp());
INSERT INTO "agent_services" ("id", "silo_id", "kind", "name", "workload_profile", "principal_id", "updated_at")
VALUES ('snapshot-service', 'silo-snapshot', 'managed', 'Snapshot test', 'managed-agent', 'snapshot-principal', clock_timestamp());
INSERT INTO "agent_revisions" ("id", "silo_id", "agent_service_id", "revision", "state", "digest", "prompt_policy_version", "model_definition_id", "budget", "authored_by")
VALUES ('snapshot-revision', 'silo-snapshot', 'snapshot-service', 1, 'draft', 'sha256:' || repeat('a', 64), 'prompt-v1', 'execution-snapshot-model', '{}', 'snapshot-principal');
UPDATE "agent_revisions" SET "state" = 'published', "published_at" = clock_timestamp() WHERE "id" = 'snapshot-revision';
UPDATE "agent_services" SET "state" = 'active', "active_revision_id" = 'snapshot-revision' WHERE "id" = 'snapshot-service';
INSERT INTO "conversations" ("id", "silo_id", "agent_service_id", "mode", "updated_at") VALUES
('snapshot-conversation', 'silo-snapshot', 'snapshot-service', 'agent_session', clock_timestamp()),
('snapshot-other-conversation', 'silo-snapshot', 'snapshot-service', 'agent_session', clock_timestamp()),
('snapshot-missing-conversation', 'silo-snapshot', 'snapshot-service', 'agent_session', clock_timestamp());

INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger", "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "input_snapshot_digest") VALUES
('snapshot-run', 'silo-snapshot', 'snapshot-service', 'snapshot-revision', 'snapshot-conversation', 'interactive', 'snapshot-identity', 'snapshot-principal', '{"runScope":{"attempt":1}}', 'snapshot-request', 'sha256:' || repeat('c', 64));
INSERT INTO "run_input_snapshots" ("id", "run_id", "attempt", "snapshot_version", "silo_id", "agent_service_id", "agent_revision_id", "agent_identity_id", "principal_id", "execution_subject", "conversation_id", "model_route", "mcp_tools", "memory_query_policy", "budget_policy", "prompt_compiler_version", "input_digest") VALUES
('snapshot-run-input', 'snapshot-run', 1, 1, 'silo-snapshot', 'snapshot-service', 'snapshot-revision', 'snapshot-identity', 'snapshot-principal', '{"runScope":{"attempt":1}}', 'snapshot-conversation', '{}', '[]', '{}', '{}', 'prompt-v1', 'sha256:' || repeat('c', 64));
SET CONSTRAINTS ALL IMMEDIATE;

SET CONSTRAINTS ALL DEFERRED;
DO $$
DECLARE actual_message TEXT;
BEGIN
    BEGIN
        INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger", "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "input_snapshot_digest")
        VALUES ('snapshot-missing', 'silo-snapshot', 'snapshot-service', 'snapshot-revision', 'snapshot-missing-conversation', 'interactive', 'snapshot-identity', 'snapshot-principal', '{"runScope":{"attempt":1}}', 'snapshot-missing-request', 'snapshot-missing', 'sha256:' || repeat('1', 64));
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
        VALUES ('snapshot-subject-mismatch', 'silo-snapshot', 'snapshot-service', 'snapshot-revision', 'snapshot-other-conversation', 'interactive', 'snapshot-identity', 'snapshot-principal', '{"runScope":{"attempt":1},"authority":"run"}', 'snapshot-subject-mismatch-request', 'snapshot-subject-mismatch', 'sha256:' || repeat('2', 64));
        INSERT INTO "run_input_snapshots" ("id", "run_id", "attempt", "snapshot_version", "silo_id", "agent_service_id", "agent_revision_id", "agent_identity_id", "principal_id", "execution_subject", "conversation_id", "model_route", "mcp_tools", "memory_query_policy", "budget_policy", "prompt_compiler_version", "input_digest")
        VALUES ('snapshot-subject-mismatch-input', 'snapshot-subject-mismatch', 1, 1, 'silo-snapshot', 'snapshot-service', 'snapshot-revision', 'snapshot-identity', 'snapshot-principal', '{"runScope":{"attempt":1},"authority":"snapshot"}', 'snapshot-other-conversation', '{}', '[]', '{}', '{}', 'prompt-v1', 'sha256:' || repeat('2', 64));
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
