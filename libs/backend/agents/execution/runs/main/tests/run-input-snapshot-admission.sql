BEGIN;

INSERT INTO "model_definitions" ("id", "scope", "public_model_name", "litellm_model_id", "upstream_model", "updated_at")
VALUES ('execution-snapshot-model', 'global', 'execution-snapshot-model', 'litellm-execution-snapshot-model', 'execution-snapshot-model', clock_timestamp());

INSERT INTO "principals" ("id", "silo_id", "issuer", "subject", "provenance", "updated_at")
VALUES ('snapshot-service-principal', 'silo-snapshot', 'urn:opencrane:agent-service', 'snapshot-service', 'internal', clock_timestamp());
INSERT INTO "agent_services" ("id", "silo_id", "kind", "name", "workload_profile", "principal_id", "updated_at")
VALUES ('snapshot-service', 'silo-snapshot', 'managed', 'Snapshot test', 'managed-agent', 'snapshot-service-principal', clock_timestamp());
INSERT INTO "agent_revisions" ("id", "agent_service_id", "revision", "state", "digest", "prompt_policy_version", "model_definition_id", "budget", "authored_by")
VALUES ('snapshot-revision', 'snapshot-service', 1, 'draft', 'sha256:' || repeat('a', 64), 'prompt-v1', 'execution-snapshot-model', '{}', 'user-snapshot');
UPDATE "agent_revisions" SET "state" = 'published', "published_at" = clock_timestamp() WHERE "id" = 'snapshot-revision';
UPDATE "agent_services" SET "state" = 'active', "active_revision_id" = 'snapshot-revision' WHERE "id" = 'snapshot-service';
INSERT INTO "conversations" ("id", "silo_id", "agent_service_id", "mode", "updated_at")
VALUES ('snapshot-conversation', 'silo-snapshot', 'snapshot-service', 'agent_session', clock_timestamp());
INSERT INTO "conversations" ("id", "silo_id", "agent_service_id", "mode", "updated_at")
VALUES ('snapshot-other-conversation', 'silo-snapshot', 'snapshot-service', 'agent_session', clock_timestamp());
INSERT INTO "conversations" ("id", "silo_id", "agent_service_id", "mode", "updated_at")
VALUES ('snapshot-missing-conversation', 'silo-snapshot', 'snapshot-service', 'agent_session', clock_timestamp());

INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger", "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest")
VALUES ('snapshot-run', 'silo-snapshot', 'snapshot-service', 'snapshot-revision', 'snapshot-conversation', 'interactive', 'snapshot-request', 'snapshot-run', 'sha256:' || repeat('b', 64), 'sha256:' || repeat('c', 64));
INSERT INTO "run_input_snapshots" ("id", "run_id", "snapshot_version", "silo_id", "agent_service_id", "agent_revision_id", "effective_contract_digest", "conversation_id", "identity_snapshot", "model_route", "mcp_tools", "memory_query_policy", "budget_policy", "capability_set_digest", "prompt_compiler_version", "input_digest")
VALUES ('snapshot-run-input', 'snapshot-run', 1, 'silo-snapshot', 'snapshot-service', 'snapshot-revision', 'sha256:' || repeat('b', 64), 'snapshot-conversation', '{}', '{}', '[]', '{}', '{}', 'sha256:' || repeat('d', 64), 'prompt-v1', 'sha256:' || repeat('c', 64));
INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger", "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest")
VALUES ('snapshot-scheduled-run', 'silo-snapshot', 'snapshot-service', 'snapshot-revision', NULL, 'schedule', 'snapshot-scheduled-request', 'snapshot-scheduled-run', 'sha256:' || repeat('e', 64), 'sha256:' || repeat('f', 64));
INSERT INTO "run_input_snapshots" ("id", "run_id", "snapshot_version", "silo_id", "agent_service_id", "agent_revision_id", "effective_contract_digest", "conversation_id", "identity_snapshot", "model_route", "mcp_tools", "memory_query_policy", "budget_policy", "capability_set_digest", "prompt_compiler_version", "input_digest")
VALUES ('snapshot-scheduled-run-input', 'snapshot-scheduled-run', 1, 'silo-snapshot', 'snapshot-service', 'snapshot-revision', 'sha256:' || repeat('e', 64), NULL, '{}', '{}', '[]', '{}', '{}', 'sha256:' || repeat('1', 64), 'prompt-v1', 'sha256:' || repeat('f', 64));
SET CONSTRAINTS ALL IMMEDIATE;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "run_input_snapshots" WHERE "run_id" = 'snapshot-scheduled-run' AND "conversation_id" IS NULL) THEN
        RAISE EXCEPTION 'FAIL: a non-conversational run did not preserve its null conversation binding';
    END IF;
    RAISE NOTICE 'PASS: a non-conversational run can bind a null conversation to its immutable snapshot';
END;
$$;
SET CONSTRAINTS ALL DEFERRED;
DO $$
DECLARE
    actual_message TEXT;
BEGIN
    BEGIN
        INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger", "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest")
        VALUES ('snapshot-missing', 'silo-snapshot', 'snapshot-service', 'snapshot-revision', 'snapshot-missing-conversation', 'interactive', 'snapshot-missing-request', 'snapshot-missing', 'sha256:' || repeat('e', 64), 'sha256:' || repeat('f', 64));
        SET CONSTRAINTS agent_runs_input_snapshot_complete IMMEDIATE;
    EXCEPTION WHEN foreign_key_violation THEN
        GET STACKED DIAGNOSTICS actual_message = MESSAGE_TEXT;
        IF strpos(actual_message, 'AgentRun requires its exact immutable RunInputSnapshot') = 0 THEN RAISE EXCEPTION 'FAIL: expected run completeness rejection, got %', actual_message; END IF;
        RAISE NOTICE 'PASS: a committed AgentRun requires its unique immutable input snapshot';
        SET CONSTRAINTS ALL DEFERRED;
        RETURN;
    END;
    RAISE EXCEPTION 'FAIL: a committed AgentRun unexpectedly succeeded without a snapshot';
END;
$$;
SET CONSTRAINTS ALL DEFERRED;
DO $$
DECLARE
    actual_message TEXT;
BEGIN
    BEGIN
        INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger", "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest")
        VALUES ('snapshot-mismatch', 'silo-snapshot', 'snapshot-service', 'snapshot-revision', 'snapshot-other-conversation', 'interactive', 'snapshot-mismatch-request', 'snapshot-mismatch', 'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64));
        INSERT INTO "run_input_snapshots" ("id", "run_id", "snapshot_version", "silo_id", "agent_service_id", "agent_revision_id", "effective_contract_digest", "conversation_id", "identity_snapshot", "model_route", "mcp_tools", "memory_query_policy", "budget_policy", "capability_set_digest", "prompt_compiler_version", "input_digest")
        VALUES ('snapshot-mismatch-input', 'snapshot-mismatch', 1, 'silo-snapshot', 'snapshot-service', 'snapshot-revision', 'sha256:' || repeat('1', 64), 'snapshot-conversation', '{}', '{}', '[]', '{}', '{}', 'sha256:' || repeat('3', 64), 'prompt-v1', 'sha256:' || repeat('2', 64));
        SET CONSTRAINTS run_input_snapshots_run_binding IMMEDIATE;
    EXCEPTION WHEN foreign_key_violation THEN
        GET STACKED DIAGNOSTICS actual_message = MESSAGE_TEXT;
        IF strpos(actual_message, 'run_input_snapshots_run_id_input_digest_conversation_id_si_fkey') = 0 THEN RAISE EXCEPTION 'FAIL: expected snapshot run-binding rejection, got %', actual_message; END IF;
        RAISE NOTICE 'PASS: an input snapshot must bind the exact admitted run conversation';
        SET CONSTRAINTS ALL DEFERRED;
        RETURN;
    END;
RAISE EXCEPTION 'FAIL: a mismatched snapshot conversation unexpectedly succeeded';
END;
$$;
SET CONSTRAINTS ALL DEFERRED;
DO $$
DECLARE
    actual_message TEXT;
BEGIN
    BEGIN
        INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger", "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest")
        VALUES ('snapshot-null-mismatch', 'silo-snapshot', 'snapshot-service', 'snapshot-revision', NULL, 'schedule', 'snapshot-null-mismatch-request', 'snapshot-null-mismatch', 'sha256:' || repeat('e', 64), 'sha256:' || repeat('7', 64));
        INSERT INTO "run_input_snapshots" ("id", "run_id", "snapshot_version", "silo_id", "agent_service_id", "agent_revision_id", "effective_contract_digest", "conversation_id", "identity_snapshot", "model_route", "mcp_tools", "memory_query_policy", "budget_policy", "capability_set_digest", "prompt_compiler_version", "input_digest")
        VALUES ('snapshot-null-mismatch-input', 'snapshot-null-mismatch', 1, 'silo-snapshot', 'snapshot-service', 'snapshot-revision', 'sha256:' || repeat('e', 64), 'snapshot-conversation', '{}', '{}', '[]', '{}', '{}', 'sha256:' || repeat('8', 64), 'prompt-v1', 'sha256:' || repeat('7', 64));
        SET CONSTRAINTS run_input_snapshots_run_binding IMMEDIATE;
    EXCEPTION WHEN foreign_key_violation THEN
        GET STACKED DIAGNOSTICS actual_message = MESSAGE_TEXT;
        IF strpos(actual_message, 'run_input_snapshots_run_id_input_digest_conversation_id_si_fkey') = 0 THEN RAISE EXCEPTION 'FAIL: expected null-safe snapshot run-binding rejection, got %', actual_message; END IF;
        RAISE NOTICE 'PASS: a null-conversation run cannot bind a conversationed snapshot';
        SET CONSTRAINTS ALL DEFERRED;
        RETURN;
    END;
    RAISE EXCEPTION 'FAIL: a null-conversation run unexpectedly accepted a conversationed snapshot';
END;
$$;

ROLLBACK;
