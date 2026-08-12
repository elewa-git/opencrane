BEGIN;

CREATE FUNCTION pg_temp.expect_tool_result_delivery_failure(statement TEXT, expected_message TEXT) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    failure_message TEXT;
BEGIN
    BEGIN
        EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS failure_message = MESSAGE_TEXT;
    END;
    IF failure_message IS NULL THEN
        RAISE EXCEPTION 'ToolResultDelivery authority unexpectedly accepted: %', statement;
    END IF;
    IF strpos(failure_message, expected_message) = 0 THEN
        RAISE EXCEPTION 'ToolResultDelivery authority returned unexpected failure: %', failure_message;
    END IF;
END;
$$;

-- These invocation fixtures deliberately use different internal row and public protocol ids.
-- Replica mode bypasses unrelated AgentRun fixture setup; every delivery assertion runs with
-- foreign keys, checks, and authority triggers enabled.
SET LOCAL session_replication_role = replica;
INSERT INTO "tool_invocations" (
    "id", "silo_id", "run_id", "attempt", "agent_service_id", "agent_revision_id", "subject_id",
    "runtime_instance_id", "command_id", "candidate_id", "tool_revision_id", "tool_invocation_id",
    "arguments", "arguments_digest", "effective_arguments", "effective_arguments_digest",
    "request_fingerprint", "request_identity", "recovery_mode", "retry_deadline_at",
    "next_preparation_attempt_at", "created_at", "updated_at"
) VALUES
    (
        'delivery-test-invocation-success', 'delivery-test-silo', 'delivery-test-run', 1,
        'delivery-test-service', 'delivery-test-revision', 'delivery-test-subject',
        'delivery-test-runtime', 'delivery-test-command', 'delivery-test-candidate-success',
        'integration:test:success', 'delivery-test-public-call-success', '{}'::JSONB,
        'sha256:' || repeat('1', 64), '{}'::JSONB, 'sha256:' || repeat('1', 64),
        'sha256:' || repeat('2', 64), '{}'::JSONB, 'manual',
        '2026-08-11T10:05:00.000Z', '2026-08-11T10:00:00.000Z',
        '2026-08-11T10:00:00.000Z', '2026-08-11T10:00:00.000Z'
    ),
    (
        'delivery-test-invocation-failure', 'delivery-test-silo', 'delivery-test-run', 1,
        'delivery-test-service', 'delivery-test-revision', 'delivery-test-subject',
        'delivery-test-runtime', 'delivery-test-command', 'delivery-test-candidate-failure',
        'integration:test:failure', 'delivery-test-public-call-failure', '{}'::JSONB,
        'sha256:' || repeat('3', 64), '{}'::JSONB, 'sha256:' || repeat('3', 64),
        'sha256:' || repeat('4', 64), '{}'::JSONB, 'manual',
        '2026-08-11T10:05:00.000Z', '2026-08-11T10:00:00.000Z',
        '2026-08-11T10:00:00.000Z', '2026-08-11T10:00:00.000Z'
    );
SET LOCAL session_replication_role = origin;

SELECT pg_temp.expect_tool_result_delivery_failure(
    $statement$
    INSERT INTO "tool_result_deliveries" ("id", "tool_invocation_id", "payload", "payload_digest")
    VALUES (
        'delivery-test-mismatch', 'delivery-test-invocation-success',
        '{"toolInvocationId":"delivery-test-wrong-public-call","outcome":"succeeded","result":{"ok":true}}'::JSONB,
        'sha256:' || repeat('5', 64)
    )
    $statement$,
    'ToolResultDelivery payload must name the related ToolInvocation public id'
);

SELECT pg_temp.expect_tool_result_delivery_failure(
    $statement$
    INSERT INTO "tool_result_deliveries" ("id", "tool_invocation_id", "payload", "payload_digest")
    VALUES (
        'delivery-test-missing-parent', 'delivery-test-missing-invocation',
        '{"toolInvocationId":"delivery-test-public-call-missing","outcome":"failed","failureCode":"missing_parent"}'::JSONB,
        'sha256:' || repeat('6', 64)
    )
    $statement$,
    'ToolResultDelivery requires its related ToolInvocation'
);

INSERT INTO "tool_result_deliveries" ("id", "tool_invocation_id", "payload", "payload_digest") VALUES
    (
        'delivery-test-success', 'delivery-test-invocation-success',
        '{"toolInvocationId":"delivery-test-public-call-success","outcome":"succeeded","result":{"ok":true}}'::JSONB,
        'sha256:' || repeat('7', 64)
    ),
    (
        'delivery-test-failure', 'delivery-test-invocation-failure',
        '{"toolInvocationId":"delivery-test-public-call-failure","outcome":"failed","failureCode":"provider_rejected"}'::JSONB,
        'sha256:' || repeat('8', 64)
    );

SELECT pg_temp.expect_tool_result_delivery_failure(
    $statement$
    UPDATE "tool_result_deliveries"
       SET "payload" = '{"toolInvocationId":"delivery-test-wrong-public-call","outcome":"succeeded","result":{"ok":true}}'::JSONB
     WHERE "id" = 'delivery-test-success'
    $statement$,
    'ToolResultDelivery payload must name the related ToolInvocation public id'
);

UPDATE "tool_result_deliveries"
   SET "state" = 'consumed', "consumed_at" = '2026-08-11T10:01:00.000Z'
 WHERE "id" = 'delivery-test-success';

DO $$
BEGIN
    IF (SELECT count(*) FROM "tool_result_deliveries" WHERE "id" IN ('delivery-test-success', 'delivery-test-failure')) <> 2 THEN
        RAISE EXCEPTION 'ToolResultDelivery positive fixtures did not persist';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM "tool_result_deliveries"
         WHERE "id" = 'delivery-test-success'
           AND "tool_invocation_id" = 'delivery-test-invocation-success'
           AND "payload"->>'toolInvocationId' = 'delivery-test-public-call-success'
           AND "state" = 'consumed'
    ) THEN
        RAISE EXCEPTION 'ToolResultDelivery did not preserve distinct internal and public invocation ids';
    END IF;
END;
$$;

ROLLBACK;
