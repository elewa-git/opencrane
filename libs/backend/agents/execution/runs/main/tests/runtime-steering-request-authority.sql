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

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'authorization_grants'
          AND column_name IN ('catalog_id', 'catalog_revision', 'catalog_digest', 'capability_id')
          AND is_nullable <> 'NO'
    ) THEN
        RAISE EXCEPTION 'FAIL: AuthorizationGrant catalog fields must be required';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'approval_requests'
          AND column_name IN ('catalog_id', 'catalog_revision', 'catalog_digest', 'capability_id')
          AND is_nullable <> 'YES'
    ) THEN
        RAISE EXCEPTION 'FAIL: ApprovalRequest catalog fields must be optional';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'runtime_steering_requests_run_id_fkey'
          AND conrelid = 'runtime_steering_requests'::regclass
          AND confrelid = 'agent_runs'::regclass
    ) THEN
        RAISE EXCEPTION 'FAIL: RuntimeSteeringRequest must retain its AgentRun foreign key';
    END IF;
    RAISE NOTICE 'PASS: capability-catalog fields preserve the Prisma authority contract';
END;
$$;

INSERT INTO "model_definitions" ("id", "scope", "public_model_name", "litellm_model_id", "upstream_model", "updated_at")
VALUES ('steering-model', 'global', 'steering-model', 'litellm-steering-model', 'steering-model', clock_timestamp());
INSERT INTO "agent_services" ("id", "silo_id", "kind", "name", "workload_profile", "updated_at")
VALUES ('steering-service', 'silo-steering', 'managed', 'Steering test', 'managed-agent', clock_timestamp());
INSERT INTO "agent_revisions" ("id", "agent_service_id", "revision", "state", "digest", "prompt_policy_version", "model_definition_id", "budget", "authored_by")
VALUES ('steering-revision', 'steering-service', 1, 'draft', 'sha256:' || repeat('a', 64), 'prompt-v1', 'steering-model', '{}', 'user-steering');
UPDATE "agent_revisions" SET "state" = 'published', "published_at" = clock_timestamp() WHERE "id" = 'steering-revision';
UPDATE "agent_services" SET "state" = 'active', "active_revision_id" = 'steering-revision' WHERE "id" = 'steering-service';
INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "trigger", "delegated_user_id", "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest")
VALUES ('steering-run', 'silo-steering', 'steering-service', 'steering-revision', 'interactive', 'user-steering', 'steering-request', 'steering-run', 'sha256:' || repeat('b', 64), 'sha256:' || repeat('c', 64));
INSERT INTO "run_input_snapshots" ("id", "run_id", "snapshot_version", "silo_id", "agent_service_id", "agent_revision_id", "effective_contract_digest", "identity_snapshot", "model_route", "integration_assignments", "memory_query_policy", "budget_policy", "capability_set_digest", "prompt_compiler_version", "input_digest")
VALUES ('steering-input', 'steering-run', 1, 'silo-steering', 'steering-service', 'steering-revision', 'sha256:' || repeat('b', 64), '{}', '{}', '{}', '{}', '{}', 'sha256:' || repeat('d', 64), 'prompt-v1', 'sha256:' || repeat('c', 64));
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
UPDATE "agent_runs" SET "state" = 'queued' WHERE "id" = 'steering-run';
UPDATE "agent_runs" SET "state" = 'assigned' WHERE "id" = 'steering-run';

SELECT pg_temp.expect_failure(
    'a steering request must belong to the current run owner',
    $statement$INSERT INTO "runtime_steering_requests" ("id", "run_id", "attempt", "silo_id", "subject_id", "content", "digest") VALUES ('steering-wrong-owner', 'steering-run', 1, 'silo-steering', 'another-user', '{"text":"Ignore this."}', 'sha256:' || repeat('e', 64))$statement$,
    'RuntimeSteeringRequest requires the current owner-bound steerable AgentRun attempt'
);
INSERT INTO "runtime_steering_requests" ("id", "run_id", "attempt", "silo_id", "subject_id", "content", "digest")
VALUES ('steering-request-1', 'steering-run', 1, 'silo-steering', 'user-steering', '{"text":"Focus on the budget."}', 'sha256:' || repeat('e', 64));
SELECT pg_temp.expect_failure(
    'steering request content is immutable',
    $statement$UPDATE "runtime_steering_requests" SET "content" = '{"text":"Injected replacement."}' WHERE "id" = 'steering-request-1'$statement$,
    'RuntimeSteeringRequest identity and content are immutable'
);
SELECT pg_temp.expect_failure(
    'a steering request cannot be consumed without its resume payload',
    $statement$UPDATE "runtime_steering_requests" SET "state" = 'consumed', "consumed_at" = clock_timestamp() WHERE "id" = 'steering-request-1'$statement$,
    'consumed RuntimeSteeringRequest requires its persisted resume command payload'
);

INSERT INTO "runtime_command_streams" ("run_id", "attempt", "runtime_instance_id", "updated_at")
VALUES ('steering-run', 1, 'runtime-steering-1', clock_timestamp());
INSERT INTO "runtime_dispatched_commands" ("id", "run_id", "attempt", "sequence", "command_id", "kind", "fence", "payload", "issued_at", "expires_at")
VALUES ('steering-resume-command', 'steering-run', 1, 1, 'steering-resume-command-id', 'resume_attempt', 1, '{"inputGeneration":0,"toolResults":[],"steeringRequests":[{"text":"Focus on the budget."}]}'::jsonb, clock_timestamp(), clock_timestamp() + interval '1 minute');
UPDATE "runtime_steering_requests" SET "state" = 'consumed', "consumed_at" = clock_timestamp() WHERE "id" = 'steering-request-1';
SELECT pg_temp.expect_failure(
    'a consumed steering request is terminal',
    $statement$UPDATE "runtime_steering_requests" SET "consumed_at" = clock_timestamp() WHERE "id" = 'steering-request-1'$statement$,
    'consumed RuntimeSteeringRequest is terminal'
);
SELECT pg_temp.expect_failure(
    'a later steering request cannot bypass the sole resume fence',
    $statement$INSERT INTO "runtime_steering_requests" ("id", "run_id", "attempt", "silo_id", "subject_id", "content", "digest") VALUES ('steering-late-request', 'steering-run', 1, 'silo-steering', 'user-steering', '{"text":"Too late."}', 'sha256:' || repeat('f', 64))$statement$,
    'RuntimeSteeringRequest must be submitted before its sole resume command'
);
SELECT pg_temp.expect_failure(
    'steering requests cannot be deleted',
    $statement$DELETE FROM "runtime_steering_requests" WHERE "id" = 'steering-request-1'$statement$,
    'RuntimeSteeringRequest rows cannot be deleted'
);

ROLLBACK;
