BEGIN;

INSERT INTO "model_definitions" ("id", "silo_id", "scope", "public_model_name", "litellm_model_id", "upstream_model", "updated_at")
VALUES ('phase-d-model', 'silo-1', 'global', 'phase-d-model', 'litellm-phase-d-model', 'phase-d-model', clock_timestamp());

INSERT INTO "principals" ("id", "silo_id", "issuer", "subject", "provenance", "updated_at")
VALUES
    ('user-1', 'silo-1', 'https://identity.example.test', 'user-1', 'external', clock_timestamp()),
    ('svc-main-principal', 'silo-1', 'urn:opencrane:agent-service', 'svc-main', 'internal', clock_timestamp()),
    ('svc-invalid-initial-principal', 'silo-1', 'urn:opencrane:agent-service', 'svc-invalid-initial', 'internal', clock_timestamp()),
    ('svc-lifecycle-principal', 'silo-1', 'urn:opencrane:agent-service', 'svc-lifecycle', 'internal', clock_timestamp()),
    ('svc-run-retirement-principal', 'silo-1', 'urn:opencrane:agent-service', 'svc-run-retirement', 'internal', clock_timestamp()),
    ('svc-run-rollover-principal', 'silo-1', 'urn:opencrane:agent-service', 'svc-run-rollover', 'internal', clock_timestamp());

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

CREATE FUNCTION pg_temp.execution_subject(
    scope_silo_id TEXT,
    scope_agent_identity_id TEXT,
    scope_principal_id TEXT,
    scope_run_id TEXT,
    scope_attempt INTEGER,
    scope_agent_service_id TEXT,
    scope_agent_revision_id TEXT,
    scope_request_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT jsonb_build_object(
        'schemaVersion', 1,
        'siloId', scope_silo_id,
        'agentIdentityId', scope_agent_identity_id,
        'principalId', scope_principal_id,
        'identity', jsonb_build_object('agentIdentityId', scope_agent_identity_id, 'principalId', scope_principal_id, 'siloId', scope_silo_id, 'headRevision', '1', 'headDigest', 'sha256:' || repeat('a', 64), 'decisionEvidenceId', 'identity-decision-' || scope_run_id, 'verifiedAt', '2026-09-01T00:00:00.000Z'),
        'membership', jsonb_build_object('principalId', scope_principal_id, 'siloId', scope_silo_id, 'revision', 1, 'assertionId', 'membership-' || scope_run_id, 'payloadDigest', 'sha256:' || repeat('b', 64), 'decisionEvidenceId', 'membership-decision-' || scope_run_id, 'trustedUntil', '2030-01-01T00:00:00.000Z'),
        'capability', jsonb_build_object('agentIdentityId', scope_agent_identity_id, 'computerId', 'computer-' || scope_run_id, 'capabilitySetDigest', 'sha256:' || repeat('c', 64), 'effectiveContractDigest', 'sha256:' || repeat('d', 64), 'decisionEvidenceId', 'capability-decision-' || scope_run_id, 'decidedAt', '2026-09-01T00:00:00.000Z'),
        'runScope', jsonb_build_object('siloId', scope_silo_id, 'runId', scope_run_id, 'attempt', scope_attempt, 'agentServiceId', scope_agent_service_id, 'agentRevisionId', scope_agent_revision_id),
        'computerScope', jsonb_build_object('siloId', scope_silo_id, 'computerId', 'computer-' || scope_run_id, 'leaseId', 'lease-' || scope_run_id, 'leaseGeneration', 1),
        'requester', jsonb_build_object('siloId', scope_silo_id, 'requesterPrincipalId', scope_principal_id, 'requestIdempotencyKey', scope_request_idempotency_key, 'authenticatedAt', '2026-09-01T00:00:00.000Z'),
        'admission', jsonb_build_object('authorizingPrincipalId', scope_principal_id, 'decisionEvidenceId', 'admission-decision-' || scope_run_id, 'admittedAt', '2026-09-01T00:00:00.000Z')
    );
$$;

INSERT INTO "agent_services" (
    "id", "silo_id", "kind", "name",
    "state", "workload_profile", "principal_id", "created_at", "updated_at"
) VALUES (
    'svc-main', 'silo-1', 'managed', 'Main service',
    'draft', 'standard', 'svc-main-principal', clock_timestamp(), clock_timestamp()
);

SELECT pg_temp.expect_failure(
    'new AgentService cannot bypass the Draft initial state',
    $statement$
        INSERT INTO "agent_services" (
            "id", "silo_id", "kind", "name",
            "state", "workload_profile", "principal_id", "created_at", "updated_at"
        ) VALUES (
            'svc-invalid-initial', 'silo-1', 'managed', 'Invalid service',
            'paused', 'standard', 'svc-invalid-initial-principal', clock_timestamp(), clock_timestamp()
        )
    $statement$,
    'must begin Draft without an active revision'
);

INSERT INTO "agent_revisions" (
    "id", "silo_id", "agent_service_id", "revision", "state", "digest",
    "prompt_policy_version", "model_definition_id", "budget", "authored_by"
) VALUES
    ('rev-published', 'silo-1', 'svc-main', 1, 'draft', 'sha256:' || repeat('a', 64),
     'prompt-v1', 'phase-d-model', '{}', 'user-1'),
    ('rev-draft', 'silo-1', 'svc-main', 2, 'draft', 'sha256:' || repeat('b', 64),
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

INSERT INTO "model_definitions" ("id", "silo_id", "scope", "cluster_tenant", "public_model_name", "litellm_model_id", "upstream_model", "updated_at")
VALUES ('foreign-phase-d-model', 'silo-1', 'clusterTenant', 'silo-other', 'foreign-phase-d-model', 'litellm-foreign-phase-d-model', 'foreign-phase-d-model', clock_timestamp());
SELECT pg_temp.expect_failure(
    'foreign tenant model definition is unavailable',
    $statement$
        INSERT INTO "agent_revisions" (
            "id", "silo_id", "agent_service_id", "revision", "state", "digest",
            "prompt_policy_version", "model_definition_id", "budget", "authored_by"
        ) VALUES (
            'foreign-model-revision', 'silo-1', 'svc-main', 3, 'draft', 'sha256:' || repeat('c', 64),
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
            "id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger",
            "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "root_run_id", "input_snapshot_digest"
        ) VALUES (
            'run-wrong-silo', 'silo-other', 'svc-main', 'rev-published', NULL, 'interactive',
            'agent-service:svc-main', 'svc-main-principal', pg_temp.execution_subject('silo-other', 'agent-service:svc-main', 'svc-main-principal', 'run-wrong-silo', 1, 'svc-main', 'rev-published', 'request-wrong-silo'), 'request-wrong-silo', 'run-wrong-silo', 'sha256:' || repeat('f', 64)
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
            "id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger",
            "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "root_run_id",
            "input_snapshot_digest"
        ) VALUES (
            'run-unpublished', 'silo-1', 'svc-main', 'rev-draft', NULL, 'interactive',
            'agent-service:svc-main', 'svc-main-principal', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'svc-main-principal', 'run-unpublished', 1, 'svc-main', 'rev-draft', 'request-unpublished'), 'request-unpublished', 'run-unpublished',
            'sha256:' || repeat('d', 64)
        )
    $statement$,
    'requires the exact silo and active revision of an Active AgentService'
);

SELECT pg_temp.expect_failure(
    'new AgentRun cannot bypass the initial state',
    $statement$
        INSERT INTO "agent_runs" (
            "id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger",
            "request_idempotency_key", "root_run_id", "attempt", "state",
            "agent_identity_id", "principal_id", "execution_subject", "input_snapshot_digest", "finished_at", "terminal_reason"
        ) VALUES (
            'run-terminal-insert', 'silo-1', 'svc-main', 'rev-published', NULL, 'interactive',
            'request-terminal-insert', 'run-terminal-insert', 1, 'completed',
            'agent-service:svc-main', 'svc-main-principal', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'svc-main-principal', 'run-terminal-insert', 1, 'svc-main', 'rev-published', 'request-terminal-insert'), 'sha256:' || repeat('d', 64), clock_timestamp(), 'success'
        )
    $statement$,
    'must begin as accepted attempt 1'
);

INSERT INTO "agent_services" (
    "id", "silo_id", "kind", "name",
    "state", "workload_profile", "principal_id", "created_at", "updated_at"
) VALUES (
    'svc-lifecycle', 'silo-1', 'managed', 'Lifecycle service',
    'draft', 'standard', 'svc-lifecycle-principal', clock_timestamp(), clock_timestamp()
);

INSERT INTO "agent_revisions" (
    "id", "silo_id", "agent_service_id", "revision", "state", "digest",
    "prompt_policy_version", "model_definition_id", "budget", "authored_by", "published_at"
) VALUES
    ('rev-never-published', 'silo-1', 'svc-lifecycle', 1, 'draft', 'sha256:' || repeat('e', 64),
     'prompt-v1', 'phase-d-model', '{}', 'user-1', NULL),
    ('rev-retirable', 'silo-1', 'svc-lifecycle', 2, 'published', 'sha256:' || repeat('f', 64),
     'prompt-v1', 'phase-d-model', '{}', 'user-1', TIMESTAMP '2026-01-01 00:00:00');

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
    (SELECT "published_at" = TIMESTAMP '2026-01-01 00:00:00'
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
    "state", "workload_profile", "principal_id", "created_at", "updated_at"
) VALUES (
    'svc-run-retirement', 'silo-1', 'managed', 'Run retirement service',
    'draft', 'standard', 'svc-run-retirement-principal', clock_timestamp(), clock_timestamp()
);
INSERT INTO "agent_revisions" (
    "id", "silo_id", "agent_service_id", "revision", "state", "digest",
    "prompt_policy_version", "model_definition_id", "budget", "authored_by", "published_at"
) VALUES (
    'rev-run-retirement', 'silo-1', 'svc-run-retirement', 1, 'published', 'sha256:' || repeat('7', 64),
    'prompt-v1', 'phase-d-model', '{}', 'user-1', clock_timestamp()
);
UPDATE "agent_services"
SET "active_revision_id" = 'rev-run-retirement', "state" = 'active'
WHERE "id" = 'svc-run-retirement';
INSERT INTO "conversations" ("id", "silo_id", "agent_service_id", "mode", "updated_at")
VALUES ('conversation-retry-retirement', 'silo-1', 'svc-run-retirement', 'agent_session', clock_timestamp());
INSERT INTO "agent_runs" (
    "id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger",
    "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "root_run_id",
    "input_snapshot_digest"
) VALUES (
    'run-retry-retirement', 'silo-1', 'svc-run-retirement', 'rev-run-retirement', 'conversation-retry-retirement', 'interactive',
    'agent-service:svc-run-retirement', 'svc-run-retirement-principal', pg_temp.execution_subject('silo-1', 'agent-service:svc-run-retirement', 'svc-run-retirement-principal', 'run-retry-retirement', 1, 'svc-run-retirement', 'rev-run-retirement', 'request-retry-retirement'), 'request-retry-retirement', 'run-retry-retirement',
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
            "id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger",
            "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "root_run_id",
            "input_snapshot_digest"
        ) VALUES (
            'run-after-retirement', 'silo-1', 'svc-run-retirement', 'rev-run-retirement', NULL, 'interactive',
            'agent-service:svc-run-retirement', 'svc-run-retirement-principal', pg_temp.execution_subject('silo-1', 'agent-service:svc-run-retirement', 'svc-run-retirement-principal', 'run-after-retirement', 1, 'svc-run-retirement', 'rev-run-retirement', 'request-after-retirement'), 'request-after-retirement', 'run-after-retirement',
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
    "state", "workload_profile", "principal_id", "created_at", "updated_at"
) VALUES (
    'svc-run-rollover', 'silo-1', 'managed', 'Run rollover service',
    'draft', 'standard', 'svc-run-rollover-principal', clock_timestamp(), clock_timestamp()
);
INSERT INTO "agent_revisions" (
    "id", "silo_id", "agent_service_id", "revision", "state", "digest",
    "prompt_policy_version", "model_definition_id", "budget", "authored_by", "published_at"
) VALUES
    ('rev-run-rollover-1', 'silo-1', 'svc-run-rollover', 1, 'published', 'sha256:' || repeat('8', 64),
     'prompt-v1', 'phase-d-model', '{}', 'user-1', clock_timestamp()),
    ('rev-run-rollover-2', 'silo-1', 'svc-run-rollover', 2, 'published', 'sha256:' || repeat('9', 64),
     'prompt-v1', 'phase-d-model', '{}', 'user-1', clock_timestamp());
UPDATE "agent_services"
SET "active_revision_id" = 'rev-run-rollover-1', "state" = 'active'
WHERE "id" = 'svc-run-rollover';
INSERT INTO "conversations" ("id", "silo_id", "agent_service_id", "mode", "updated_at")
VALUES ('conversation-retry-rollover', 'silo-1', 'svc-run-rollover', 'agent_session', clock_timestamp());
INSERT INTO "agent_runs" (
    "id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger",
    "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "root_run_id",
    "input_snapshot_digest"
) VALUES (
    'run-retry-rollover', 'silo-1', 'svc-run-rollover', 'rev-run-rollover-1', 'conversation-retry-rollover', 'interactive',
    'agent-service:svc-run-rollover', 'svc-run-rollover-principal', pg_temp.execution_subject('silo-1', 'agent-service:svc-run-rollover', 'svc-run-rollover-principal', 'run-retry-rollover', 1, 'svc-run-rollover', 'rev-run-rollover-1', 'request-retry-rollover'), 'request-retry-rollover', 'run-retry-rollover',
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
            "id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger",
            "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "root_run_id",
            "input_snapshot_digest"
        ) VALUES (
            'run-superseded-revision', 'silo-1', 'svc-run-rollover', 'rev-run-rollover-1', NULL, 'interactive',
            'agent-service:svc-run-rollover', 'svc-run-rollover-principal', pg_temp.execution_subject('silo-1', 'agent-service:svc-run-rollover', 'svc-run-rollover-principal', 'run-superseded-revision', 1, 'svc-run-rollover', 'rev-run-rollover-1', 'request-superseded-revision'), 'request-superseded-revision', 'run-superseded-revision',
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

INSERT INTO "conversations" ("id", "silo_id", "agent_service_id", "mode", "updated_at") VALUES
    ('conversation-run-state', 'silo-1', 'svc-main', 'agent_session', clock_timestamp()),
    ('conversation-run-action', 'silo-1', 'svc-main', 'agent_session', clock_timestamp());
INSERT INTO "agent_runs" (
    "id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger",
    "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "root_run_id",
    "input_snapshot_digest"
) VALUES (
    'run-state', 'silo-1', 'svc-main', 'rev-published', 'conversation-run-state', 'interactive',
    'agent-service:svc-main', 'svc-main-principal', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'svc-main-principal', 'run-state', 1, 'svc-main', 'rev-published', 'request-state'), 'request-state', 'run-state',
    'sha256:' || repeat('a', 64)
);

UPDATE "agent_runs" SET "state" = 'queued' WHERE "id" = 'run-state';
UPDATE "agent_runs" SET "state" = 'assigned' WHERE "id" = 'run-state';
UPDATE "agent_runs"
SET "state" = 'running', "started_at" = clock_timestamp()
WHERE "id" = 'run-state';
INSERT INTO "conversation_run_events" (
    "conversation_id", "run_id", "attempt", "sequence", "type", "message_id", "payload", "occurred_at"
) VALUES (
    'conversation-run-state', 'run-state', 1, 1, 'message.started', 'retry-message',
    '{"messageId":"retry-message","role":"assistant"}', clock_timestamp()
);
UPDATE "agent_runs"
SET "state" = 'failed', "finished_at" = clock_timestamp(), "terminal_reason" = 'runtime_failure'
WHERE "id" = 'run-state';
INSERT INTO "conversation_run_events" (
    "conversation_id", "run_id", "attempt", "sequence", "type", "payload", "occurred_at"
) VALUES (
    'conversation-run-state', 'run-state', 1, 2, 'run.failed', '{}', clock_timestamp()
);

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

SELECT pg_temp.expect_failure(
    'RunEvent cannot append to a stale attempt after retry',
    $statement$
        INSERT INTO "conversation_run_events" (
            "conversation_id", "run_id", "attempt", "sequence", "type", "payload", "occurred_at"
        ) VALUES (
            'conversation-run-state', 'run-state', 1, 3, 'run.started', '{}', clock_timestamp()
        )
    $statement$,
    'RunEvent must bind the current AgentRun attempt'
);

UPDATE "agent_runs" SET "state" = 'queued' WHERE "id" = 'run-state';
UPDATE "agent_runs" SET "state" = 'assigned' WHERE "id" = 'run-state';
UPDATE "agent_runs"
SET "state" = 'running', "started_at" = clock_timestamp()
WHERE "id" = 'run-state';
INSERT INTO "conversation_run_events" (
    "conversation_id", "run_id", "attempt", "sequence", "type", "payload", "occurred_at"
) VALUES (
    'conversation-run-state', 'run-state', 2, 3, 'run.started', '{}', clock_timestamp()
);
INSERT INTO "conversation_run_events" (
    "conversation_id", "run_id", "attempt", "sequence", "type", "message_id", "payload", "occurred_at"
) VALUES (
    'conversation-run-state', 'run-state', 2, 4, 'message.started', 'retry-message',
    '{"messageId":"retry-message","role":"assistant"}', clock_timestamp()
);
UPDATE "agent_runs"
SET "state" = 'completed', "finished_at" = clock_timestamp(), "terminal_reason" = 'success'
WHERE "id" = 'run-state';
INSERT INTO "conversation_run_events" (
    "conversation_id", "run_id", "attempt", "sequence", "type", "payload", "occurred_at"
) VALUES (
    'conversation-run-state', 'run-state', 2, 5, 'run.completed', '{}', clock_timestamp()
);

SELECT pg_temp.expect_failure(
    'RunEvent cannot append after the same attempt is terminal',
    $statement$
        INSERT INTO "conversation_run_events" (
            "conversation_id", "run_id", "attempt", "sequence", "type", "payload", "occurred_at"
        ) VALUES (
            'conversation-run-state', 'run-state', 2, 6, 'run.completed', '{}', clock_timestamp()
        )
    $statement$,
    'RunEvent attempt stream is terminal'
);

SELECT pg_temp.assert_true(
    'retry RunEvents keep a run-global sequence and bind each attempt',
    (
        SELECT string_agg(
            "attempt"::text || ':' || "sequence"::text || ':' || "type",
            ',' ORDER BY "sequence"
        ) = '1:1:message.started,1:2:run.failed,2:3:run.started,2:4:message.started,2:5:run.completed'
        FROM "conversation_run_events"
        WHERE "run_id" = 'run-state'
    )
);

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
    "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "root_run_id", "input_snapshot_digest"
) VALUES
    ('run-cancel-accepted', 'silo-1', 'svc-main', 'rev-published', 'interactive',
     'agent-service:svc-main', 'user-1', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'user-1', 'run-cancel-accepted', 1, 'svc-main', 'rev-published', 'request-cancel-accepted'), 'request-cancel-accepted', 'run-cancel-accepted', 'sha256:' || repeat('1', 64)),
    ('run-cancel-queued', 'silo-1', 'svc-main', 'rev-published', 'interactive',
     'agent-service:svc-main', 'user-1', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'user-1', 'run-cancel-queued', 1, 'svc-main', 'rev-published', 'request-cancel-queued'), 'request-cancel-queued', 'run-cancel-queued', 'sha256:' || repeat('c2', 32)),
    ('run-cancel-assigned', 'silo-1', 'svc-main', 'rev-published', 'interactive',
     'agent-service:svc-main', 'user-1', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'user-1', 'run-cancel-assigned', 1, 'svc-main', 'rev-published', 'request-cancel-assigned'), 'request-cancel-assigned', 'run-cancel-assigned', 'sha256:' || repeat('3', 64)),
    ('run-cancel-running', 'silo-1', 'svc-main', 'rev-published', 'interactive',
     'agent-service:svc-main', 'user-1', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'user-1', 'run-cancel-running', 1, 'svc-main', 'rev-published', 'request-cancel-running'), 'request-cancel-running', 'run-cancel-running', 'sha256:' || repeat('4', 64)),
    ('run-cancel-waiting', 'silo-1', 'svc-main', 'rev-published', 'interactive',
     'agent-service:svc-main', 'user-1', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'user-1', 'run-cancel-waiting', 1, 'svc-main', 'rev-published', 'request-cancel-waiting'), 'request-cancel-waiting', 'run-cancel-waiting', 'sha256:' || repeat('5', 64));

UPDATE "agent_runs" SET "state" = 'queued'
WHERE "id" IN ('run-cancel-queued', 'run-cancel-assigned', 'run-cancel-running', 'run-cancel-waiting');
UPDATE "agent_runs" SET "state" = 'assigned'
WHERE "id" IN ('run-cancel-assigned', 'run-cancel-running', 'run-cancel-waiting');
UPDATE "agent_runs" SET "state" = 'running', "started_at" = clock_timestamp()
WHERE "id" IN ('run-cancel-running', 'run-cancel-waiting');
UPDATE "agent_runs" SET "state" = 'waiting_for_input' WHERE "id" = 'run-cancel-waiting';

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

UPDATE "agent_runs"
SET "state" = 'cancelled', "finished_at" = clock_timestamp(), "terminal_reason" = 'user_cancelled'
WHERE "id" = 'run-cancel-accepted';

SELECT pg_temp.assert_true(
    'Cancelled finalises without physical work when nothing was ever assigned or claimed',
    (SELECT "state" = 'cancelled' AND "finished_at" IS NOT NULL AND "terminal_reason" = 'user_cancelled'
     FROM "agent_runs" WHERE "id" = 'run-cancel-accepted')
);

INSERT INTO "conversations" ("id", "silo_id", "agent_service_id", "mode", "updated_at")
VALUES ('conversation-cancel-event', 'silo-1', 'svc-main', 'agent_session', clock_timestamp());
INSERT INTO "agent_runs" (
    "id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger",
    "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "root_run_id", "input_snapshot_digest"
) VALUES (
    'run-cancel-event', 'silo-1', 'svc-main', 'rev-published', 'conversation-cancel-event', 'interactive',
    'agent-service:svc-main', 'user-1', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'user-1', 'run-cancel-event', 1, 'svc-main', 'rev-published', 'request-cancel-event'), 'request-cancel-event', 'run-cancel-event', 'sha256:' || repeat('c6', 32)
);
UPDATE "agent_runs" SET "state" = 'cancelling' WHERE "id" = 'run-cancel-event';

SELECT pg_temp.expect_failure(
    'Cancelling cannot publish the terminal cancellation event',
    $statement$
        INSERT INTO "conversation_run_events" ("conversation_id", "run_id", "attempt", "sequence", "type", "payload", "occurred_at")
        VALUES ('conversation-cancel-event', 'run-cancel-event', 1, 1, 'run.cancelled', '{}', clock_timestamp())
    $statement$,
    'requires Cancelled AgentRun authority'
);

UPDATE "agent_runs"
SET "state" = 'cancelled', "finished_at" = clock_timestamp(), "terminal_reason" = 'user_cancelled'
WHERE "id" = 'run-cancel-event';
INSERT INTO "conversation_run_events" ("conversation_id", "run_id", "attempt", "sequence", "type", "payload", "occurred_at")
VALUES ('conversation-cancel-event', 'run-cancel-event', 1, 1, 'run.cancelled', '{}', clock_timestamp());

INSERT INTO "agent_runs" (
    "id", "silo_id", "agent_service_id", "agent_revision_id", "trigger",
    "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "root_run_id", "input_snapshot_digest"
) VALUES
    ('run-cancel-bootstrap', 'silo-1', 'svc-main', 'rev-published', 'interactive',
     'agent-service:svc-main', 'user-1', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'user-1', 'run-cancel-bootstrap', 1, 'svc-main', 'rev-published', 'request-cancel-bootstrap'), 'request-cancel-bootstrap', 'run-cancel-bootstrap', 'sha256:' || repeat('7', 64)),
    ('run-cancel-proof', 'silo-1', 'svc-main', 'rev-published', 'interactive',
     'agent-service:svc-main', 'user-1', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'user-1', 'run-cancel-proof', 1, 'svc-main', 'rev-published', 'request-cancel-proof'), 'request-cancel-proof', 'run-cancel-proof', 'sha256:' || repeat('8', 64));
UPDATE "agent_runs" SET "state" = 'queued' WHERE "id" IN ('run-cancel-bootstrap', 'run-cancel-proof');

INSERT INTO "workload_assignments" (
    "run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "agent_identity_id", "principal_id", "execution_subject",
    "audience", "service_account_name", "namespace", "workload_kind", "workload_uid", "workload_profile", "expires_at"
) VALUES
    ('run-cancel-bootstrap', 1, 'svc-main', 'rev-published', 'silo-1', 'agent-service:svc-main', 'user-1', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'user-1', 'run-cancel-bootstrap', 1, 'svc-main', 'rev-published', 'request-cancel-bootstrap'),
     'opencrane-agent-runtime', 'runtime', 'tenant-silo-1', 'job', 'job-uid-cancel-bootstrap', 'personal-small', clock_timestamp() + interval '1 hour'),
    ('run-cancel-proof', 1, 'svc-main', 'rev-published', 'silo-1', 'agent-service:svc-main', 'user-1', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'user-1', 'run-cancel-proof', 1, 'svc-main', 'rev-published', 'request-cancel-proof'),
     'opencrane-agent-runtime', 'runtime', 'tenant-silo-1', 'job', 'job-uid-cancel-proof', 'personal-small', clock_timestamp() + interval '1 hour');
UPDATE "agent_runs" SET "state" = 'assigned' WHERE "id" IN ('run-cancel-bootstrap', 'run-cancel-proof');

INSERT INTO "warm_runtime_reservations" (
    "run_id", "attempt", "generation", "silo_id", "namespace", "deployment_name", "deployment_uid",
    "pod_name", "pod_uid", "pod_resource_version", "generic_profile", "claimed_profile",
    "service_account_name", "state", "idle_deadline"
) VALUES
    ('run-cancel-bootstrap', 1, 1, 'silo-1', 'tenant-silo-1', 'phase-d-personal-warm',
     'deployment-uid-cancel-bootstrap', 'pod-cancel-bootstrap', 'pod-uid-cancel-bootstrap', '1',
     'generic', 'personal-small', 'runtime', 'reserved', clock_timestamp() + interval '30 minutes'),
    ('run-cancel-proof', 1, 1, 'silo-1', 'tenant-silo-1', 'phase-d-personal-warm',
     'deployment-uid-cancel-proof', 'pod-cancel-proof', 'pod-uid-cancel-proof', '1',
     'generic', 'personal-small', 'runtime', 'reserved', clock_timestamp() + interval '30 minutes');

INSERT INTO "workload_bootstraps" (
    "id", "run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "agent_identity_id", "principal_id", "execution_subject",
    "audience", "service_account_name", "namespace", "workload_kind", "workload_uid", "claim_digest", "expires_at"
) VALUES
    ('bootstrap-cancel-bootstrap', 'run-cancel-bootstrap', 1, 'svc-main', 'rev-published', 'silo-1', 'agent-service:svc-main', 'user-1', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'user-1', 'run-cancel-bootstrap', 1, 'svc-main', 'rev-published', 'request-cancel-bootstrap'),
     'opencrane-agent-runtime', 'runtime', 'tenant-silo-1', 'job', 'job-uid-cancel-bootstrap',
     'sha256:' || repeat('9', 64), clock_timestamp() + interval '30 minutes'),
    ('bootstrap-cancel-proof', 'run-cancel-proof', 1, 'svc-main', 'rev-published', 'silo-1', 'agent-service:svc-main', 'user-1', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'user-1', 'run-cancel-proof', 1, 'svc-main', 'rev-published', 'request-cancel-proof'),
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

UPDATE "workload_bootstraps"
SET "revoked_at" = clock_timestamp()
WHERE "id" = 'bootstrap-cancel-proof';

SELECT pg_temp.assert_true(
    'a consumed WorkloadBootstrap accepts one revocation',
    (SELECT "consumed_at" IS NOT NULL AND "revoked_at" IS NOT NULL
     FROM "workload_bootstraps" WHERE "id" = 'bootstrap-cancel-proof')
);

SELECT pg_temp.expect_failure(
    'a consumed WorkloadBootstrap cannot clear its revocation',
    $statement$
        UPDATE "workload_bootstraps"
        SET "revoked_at" = NULL
        WHERE "id" = 'bootstrap-cancel-proof'
    $statement$,
    'WorkloadBootstrap revocation is irreversible'
);

SELECT pg_temp.expect_failure(
    'a consumed WorkloadBootstrap cannot replace its revocation timestamp',
    $statement$
        UPDATE "workload_bootstraps"
        SET "revoked_at" = "revoked_at" + interval '1 second'
        WHERE "id" = 'bootstrap-cancel-proof'
    $statement$,
    'WorkloadBootstrap revocation is irreversible'
);

SELECT pg_temp.expect_failure(
    'a consumed WorkloadBootstrap cannot record a second revocation',
    $statement$
        UPDATE "workload_bootstraps"
        SET "revoked_at" = "revoked_at"
        WHERE "id" = 'bootstrap-cancel-proof'
    $statement$,
    'WorkloadBootstrap is already revoked'
);

-- A current Registered WorkloadAssignment blocks cancellation finalisation.
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
UPDATE "warm_runtime_reservations"
SET "state" = 'deleted', "delete_requested_at" = clock_timestamp(), "deleted_at" = clock_timestamp()
WHERE "run_id" = 'run-cancel-bootstrap' AND "attempt" = 1 AND "generation" = 1;
UPDATE "workload_bootstraps"
SET "revoked_at" = clock_timestamp()
WHERE "id" = 'bootstrap-cancel-bootstrap';

UPDATE "agent_runs"
SET "state" = 'cancelled', "finished_at" = clock_timestamp(), "terminal_reason" = 'user_cancelled'
WHERE "id" = 'run-cancel-bootstrap';

SELECT pg_temp.assert_true(
    'Cancelled finalises once its assignment is revoked and its reservation is deleted',
    (SELECT "state" = 'cancelled' AND "finished_at" IS NOT NULL AND "terminal_reason" = 'user_cancelled'
     FROM "agent_runs" WHERE "id" = 'run-cancel-bootstrap')
);

SELECT pg_temp.assert_true(
    'an unconsumed WorkloadBootstrap accepts one revocation',
    (SELECT "consumed_at" IS NULL AND "revoked_at" IS NOT NULL
     FROM "workload_bootstraps" WHERE "id" = 'bootstrap-cancel-bootstrap')
);

SELECT pg_temp.expect_failure(
    'an unconsumed WorkloadBootstrap cannot clear its revocation',
    $statement$
        UPDATE "workload_bootstraps"
        SET "revoked_at" = NULL
        WHERE "id" = 'bootstrap-cancel-bootstrap'
    $statement$,
    'WorkloadBootstrap revocation is irreversible'
);

SELECT pg_temp.expect_failure(
    'an unconsumed WorkloadBootstrap cannot replace its revocation timestamp',
    $statement$
        UPDATE "workload_bootstraps"
        SET "revoked_at" = "revoked_at" + interval '1 second'
        WHERE "id" = 'bootstrap-cancel-bootstrap'
    $statement$,
    'WorkloadBootstrap revocation is irreversible'
);

SELECT pg_temp.expect_failure(
    'an unconsumed WorkloadBootstrap cannot record a second revocation',
    $statement$
        UPDATE "workload_bootstraps"
        SET "revoked_at" = "revoked_at"
        WHERE "id" = 'bootstrap-cancel-bootstrap'
    $statement$,
    'WorkloadBootstrap is already revoked'
);

SELECT pg_temp.expect_failure(
    'a revoked WorkloadBootstrap cannot be consumed',
    $statement$
        UPDATE "workload_bootstraps"
        SET "consumed_at" = clock_timestamp(), "consumed_by_pod_uid" = 'pod-uid-cancel-bootstrap',
            "receipt_id" = 'receipt-revoked-bootstrap'
        WHERE "id" = 'bootstrap-cancel-bootstrap'
    $statement$,
    'a revoked WorkloadBootstrap cannot be consumed'
);

-- Cancelling -> Cancelled: an unrevoked RunProofKey blocks finalisation even after its
-- WorkloadAssignment is revoked.
INSERT INTO "agent_runs" (
    "id", "silo_id", "agent_service_id", "agent_revision_id", "trigger",
    "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "root_run_id", "input_snapshot_digest"
) VALUES (
    'run-cancel-invariant-proofkey', 'silo-1', 'svc-main', 'rev-published', 'interactive',
    'agent-service:svc-main', 'user-1', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'user-1', 'run-cancel-invariant-proofkey', 1, 'svc-main', 'rev-published', 'request-cancel-invariant-proofkey'), 'request-cancel-invariant-proofkey', 'run-cancel-invariant-proofkey',
    'sha256:' || repeat('d3', 32)
);
UPDATE "agent_runs" SET "state" = 'queued' WHERE "id" = 'run-cancel-invariant-proofkey';

INSERT INTO "workload_assignments" (
    "run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "agent_identity_id", "principal_id", "execution_subject",
    "audience", "service_account_name", "namespace", "workload_kind", "workload_uid", "workload_profile", "expires_at"
) VALUES (
    'run-cancel-invariant-proofkey', 1, 'svc-main', 'rev-published', 'silo-1', 'agent-service:svc-main', 'user-1', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'user-1', 'run-cancel-invariant-proofkey', 1, 'svc-main', 'rev-published', 'request-cancel-invariant-proofkey'),
    'opencrane-agent-runtime', 'runtime', 'tenant-silo-1', 'job', 'job-uid-cancel-invariant-proofkey', 'personal-small',
    clock_timestamp() + interval '1 hour'
);
UPDATE "agent_runs" SET "state" = 'assigned' WHERE "id" = 'run-cancel-invariant-proofkey';

INSERT INTO "warm_runtime_reservations" (
    "run_id", "attempt", "generation", "silo_id", "namespace", "deployment_name", "deployment_uid",
    "pod_name", "pod_uid", "pod_resource_version", "generic_profile", "claimed_profile",
    "service_account_name", "state", "idle_deadline"
) VALUES (
    'run-cancel-invariant-proofkey', 1, 1, 'silo-1', 'tenant-silo-1', 'phase-d-personal-warm',
    'deployment-uid-cancel-invariant-proofkey', 'pod-cancel-invariant-proofkey',
    'pod-uid-cancel-invariant-proofkey', '1', 'generic', 'personal-small', 'runtime', 'reserved',
    clock_timestamp() + interval '30 minutes'
);

INSERT INTO "workload_bootstraps" (
    "id", "run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "agent_identity_id", "principal_id", "execution_subject",
    "audience", "service_account_name", "namespace", "workload_kind", "workload_uid", "claim_digest", "expires_at"
) VALUES (
    'bootstrap-cancel-invariant-proofkey', 'run-cancel-invariant-proofkey', 1, 'svc-main', 'rev-published', 'silo-1', 'agent-service:svc-main', 'user-1', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'user-1', 'run-cancel-invariant-proofkey', 1, 'svc-main', 'rev-published', 'request-cancel-invariant-proofkey'),
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
UPDATE "warm_runtime_reservations"
SET "state" = 'deleted', "delete_requested_at" = clock_timestamp(), "deleted_at" = clock_timestamp()
WHERE "run_id" = 'run-cancel-invariant-proofkey' AND "attempt" = 1 AND "generation" = 1;

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

UPDATE "agent_runs"
SET "state" = 'cancelled', "finished_at" = clock_timestamp(), "terminal_reason" = 'user_cancelled'
WHERE "id" = 'run-cancel-invariant-proofkey';

SELECT pg_temp.assert_true(
    'Cancelled finalises once every RunProofKey is revoked and its reservation is deleted',
    (SELECT "state" = 'cancelled' AND "finished_at" IS NOT NULL AND "terminal_reason" = 'user_cancelled'
     FROM "agent_runs" WHERE "id" = 'run-cancel-invariant-proofkey')
);

-- A bound workflow task must record exact warm runtime deletion before cancellation finalises.
INSERT INTO "agent_runs" (
    "id", "silo_id", "agent_service_id", "agent_revision_id", "trigger",
    "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "root_run_id", "input_snapshot_digest"
) VALUES (
    'run-cancel-workflow-task', 'silo-1', 'svc-main', 'rev-published', 'interactive',
    'agent-service:svc-main', 'user-1', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'user-1', 'run-cancel-workflow-task', 1, 'svc-main', 'rev-published', 'request-cancel-workflow-task'), 'request-cancel-workflow-task', 'run-cancel-workflow-task',
    'sha256:' || repeat('d2', 32)
);

UPDATE "agent_runs" SET "state" = 'queued' WHERE "id" = 'run-cancel-workflow-task';

INSERT INTO "workload_assignments" (
    "run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "agent_identity_id", "principal_id", "execution_subject",
    "audience", "service_account_name", "namespace", "workload_kind", "workload_uid", "workload_profile",
    "pod_uid", "expires_at"
) VALUES (
    'run-cancel-workflow-task', 1, 'svc-main', 'rev-published', 'silo-1', 'agent-service:svc-main', 'user-1', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'user-1', 'run-cancel-workflow-task', 1, 'svc-main', 'rev-published', 'request-cancel-workflow-task'),
    'opencrane-agent-runtime', 'runtime', 'tenant-silo-1', 'deployment', 'pod-uid-cancel-workflow', 'personal-small',
    'pod-uid-cancel-workflow', clock_timestamp() + interval '1 hour'
);

INSERT INTO "warm_runtime_reservations" (
    "run_id", "attempt", "generation", "silo_id", "namespace", "deployment_name", "deployment_uid",
    "pod_name", "pod_uid", "pod_resource_version", "generic_profile", "claimed_profile",
    "service_account_name", "state", "idle_deadline"
) VALUES (
    'run-cancel-workflow-task', 1, 1, 'silo-1', 'tenant-silo-1', 'personal-warm', 'deployment-uid-cancel-workflow',
    'pod-cancel-workflow', 'pod-uid-cancel-workflow', '1', 'generic', 'personal-small',
    'runtime', 'reserved', clock_timestamp() + interval '30 minutes'
);

INSERT INTO "agent_run_workflow_tasks" (
    "run_id", "attempt", "silo_id", "task_key", "task_name", "task_id", "receipt_bound_at"
) VALUES (
    'run-cancel-workflow-task', 1, 'silo-1', 'agent-run:silo-1:run-cancel-workflow-task:attempt:1',
    'agent-runs.execute/v1', 'workflow-task-cancel', clock_timestamp()
);

UPDATE "workload_assignments"
SET "state" = 'revoked', "revoked_at" = clock_timestamp()
WHERE "run_id" = 'run-cancel-workflow-task';
UPDATE "agent_runs" SET "state" = 'cancelling' WHERE "id" = 'run-cancel-workflow-task';

SELECT pg_temp.expect_failure(
    'Cancelled requires a reserved warm runtime deleted',
    $statement$
        UPDATE "agent_runs"
        SET "state" = 'cancelled', "finished_at" = clock_timestamp(), "terminal_reason" = 'user_cancelled'
        WHERE "id" = 'run-cancel-workflow-task'
    $statement$,
    'requires every warm runtime reservation deleted'
);

UPDATE "warm_runtime_reservations" SET "state" = 'ready' WHERE "run_id" = 'run-cancel-workflow-task';
SELECT pg_temp.expect_failure(
    'Cancelled requires a ready warm runtime deleted',
    $statement$
        UPDATE "agent_runs"
        SET "state" = 'cancelled', "finished_at" = clock_timestamp(), "terminal_reason" = 'user_cancelled'
        WHERE "id" = 'run-cancel-workflow-task'
    $statement$,
    'requires every warm runtime reservation deleted'
);

UPDATE "warm_runtime_reservations" SET "state" = 'claimed' WHERE "run_id" = 'run-cancel-workflow-task';
SELECT pg_temp.expect_failure(
    'Cancelled requires a claimed warm runtime deleted',
    $statement$
        UPDATE "agent_runs"
        SET "state" = 'cancelled', "finished_at" = clock_timestamp(), "terminal_reason" = 'user_cancelled'
        WHERE "id" = 'run-cancel-workflow-task'
    $statement$,
    'requires every warm runtime reservation deleted'
);

UPDATE "warm_runtime_reservations"
SET "state" = 'delete_requested', "delete_requested_at" = clock_timestamp()
WHERE "run_id" = 'run-cancel-workflow-task';
SELECT pg_temp.expect_failure(
    'Cancelled requires a deletion-requested warm runtime deleted',
    $statement$
        UPDATE "agent_runs"
        SET "state" = 'cancelled', "finished_at" = clock_timestamp(), "terminal_reason" = 'user_cancelled'
        WHERE "id" = 'run-cancel-workflow-task'
    $statement$,
    'requires every warm runtime reservation deleted'
);

UPDATE "warm_runtime_reservations"
SET "state" = 'deleted', "deleted_at" = clock_timestamp()
WHERE "run_id" = 'run-cancel-workflow-task';
UPDATE "agent_runs"
SET "state" = 'cancelled', "finished_at" = clock_timestamp(), "terminal_reason" = 'user_cancelled'
WHERE "id" = 'run-cancel-workflow-task';

SELECT pg_temp.assert_true(
    'Cancelled finalises after the bound workflow records warm runtime deletion',
    (SELECT "state" = 'cancelled' AND "finished_at" IS NOT NULL AND "terminal_reason" = 'user_cancelled'
     FROM "agent_runs" WHERE "id" = 'run-cancel-workflow-task')
);

INSERT INTO "agent_runs" (
    "id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger",
    "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "root_run_id",
    "input_snapshot_digest"
) VALUES (
    'run-action', 'silo-1', 'svc-main', 'rev-published', 'conversation-run-action', 'interactive',
    'agent-service:svc-main', 'user-1', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'user-1', 'run-action', 1, 'svc-main', 'rev-published', 'request-action'), 'request-action', 'run-action',
    'sha256:' || repeat('b', 64)
);

UPDATE "agent_runs" SET "state" = 'queued' WHERE "id" = 'run-action';

SELECT pg_temp.expect_failure(
    'new WorkloadAssignment cannot begin registered',
    $statement$
        INSERT INTO "workload_assignments" (
            "run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "agent_identity_id", "principal_id", "execution_subject",
            "audience", "service_account_name", "namespace", "workload_kind", "workload_uid", "workload_profile",
            "pod_uid", "state", "expires_at", "registered_at"
        ) VALUES (
            'run-action', 1, 'svc-main', 'rev-published', 'silo-1', 'agent-service:svc-main', 'user-1', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'user-1', 'run-action', 1, 'svc-main', 'rev-published', 'request-action'),
            'opencrane-agent-runtime', 'runtime', 'tenant-silo-1', 'job', 'job-uid-invalid', 'personal-small',
            'pod-uid-invalid', 'registered', clock_timestamp() + interval '1 hour', clock_timestamp()
        )
    $statement$,
    'must begin pending_pod'
);

INSERT INTO "workload_assignments" (
    "run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "agent_identity_id", "principal_id", "execution_subject",
    "audience", "service_account_name", "namespace", "workload_kind", "workload_uid", "workload_profile", "expires_at"
) VALUES (
    'run-action', 1, 'svc-main', 'rev-published', 'silo-1', 'agent-service:svc-main', 'user-1', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'user-1', 'run-action', 1, 'svc-main', 'rev-published', 'request-action'),
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
            "id", "run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "agent_identity_id", "principal_id", "execution_subject",
            "audience", "service_account_name", "namespace", "workload_kind", "workload_uid",
            "claim_digest", "expires_at"
        ) VALUES (
            'bootstrap-too-early', 'run-action', 1, 'svc-main', 'rev-published', 'silo-1', 'agent-service:svc-main', 'user-1', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'user-1', 'run-action', 1, 'svc-main', 'rev-published', 'request-action'),
            'opencrane-agent-runtime', 'runtime', 'tenant-silo-1', 'job', 'job-uid-1',
            'sha256:' || repeat('0', 64), clock_timestamp() + interval '30 minutes'
        )
    $statement$,
    'requires the current Assigned attempt'
);

UPDATE "agent_runs" SET "state" = 'assigned' WHERE "id" = 'run-action';

INSERT INTO "warm_runtime_reservations" (
    "run_id", "attempt", "generation", "silo_id", "namespace", "deployment_name", "deployment_uid",
    "pod_name", "pod_uid", "pod_resource_version", "generic_profile", "claimed_profile",
    "service_account_name", "state", "idle_deadline"
) VALUES (
    'run-action', 1, 1, 'silo-1', 'tenant-silo-1', 'phase-d-personal-warm',
    'deployment-uid-action', 'pod-action', 'pod-uid-1', '1', 'generic', 'personal-small',
    'runtime', 'reserved', clock_timestamp() + interval '30 minutes'
);

SELECT pg_temp.expect_failure(
    'new WorkloadBootstrap cannot begin consumed',
    $statement$
        INSERT INTO "workload_bootstraps" (
            "id", "run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "agent_identity_id", "principal_id", "execution_subject",
            "audience", "service_account_name", "namespace", "workload_kind", "workload_uid",
            "claim_digest", "expires_at", "consumed_at", "consumed_by_pod_uid", "receipt_id"
        ) VALUES (
            'bootstrap-consumed', 'run-action', 1, 'svc-main', 'rev-published', 'silo-1', 'agent-service:svc-main', 'user-1', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'user-1', 'run-action', 1, 'svc-main', 'rev-published', 'request-action'),
            'opencrane-agent-runtime', 'runtime', 'tenant-silo-1', 'job', 'job-uid-1',
            'sha256:' || repeat('f', 64), clock_timestamp() + interval '30 minutes',
            clock_timestamp(), 'pod-uid-1', 'receipt-invalid'
        )
    $statement$,
    'must begin unconsumed'
);

INSERT INTO "workload_bootstraps" (
    "id", "run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "agent_identity_id", "principal_id", "execution_subject",
    "audience", "service_account_name", "namespace", "workload_kind", "workload_uid",
    "claim_digest", "expires_at"
) VALUES (
    'bootstrap-1', 'run-action', 1, 'svc-main', 'rev-published', 'silo-1', 'agent-service:svc-main', 'user-1', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'user-1', 'run-action', 1, 'svc-main', 'rev-published', 'request-action'),
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

-- A managed runtime uses the same generation-bound chain with its distinct projected-token audience.
INSERT INTO "agent_runs" (
    "id", "silo_id", "agent_service_id", "agent_revision_id", "trigger",
    "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "root_run_id", "input_snapshot_digest"
) VALUES (
    'run-managed-bootstrap', 'silo-1', 'svc-main', 'rev-published', 'interactive',
    'agent-service:svc-main', 'svc-main-principal', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'svc-main-principal', 'run-managed-bootstrap', 1, 'svc-main', 'rev-published', 'request-managed-bootstrap'), 'request-managed-bootstrap', 'run-managed-bootstrap',
    'sha256:' || repeat('f', 64)
);
UPDATE "agent_runs" SET "state" = 'queued' WHERE "id" = 'run-managed-bootstrap';

INSERT INTO "workload_assignments" (
    "run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "agent_identity_id", "principal_id", "execution_subject",
    "audience", "service_account_name", "namespace", "workload_kind", "workload_uid", "workload_profile",
    "pod_uid", "expires_at"
) VALUES (
    'run-managed-bootstrap', 1, 'svc-main', 'rev-published', 'silo-1', 'agent-service:svc-main', 'svc-main-principal', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'svc-main-principal', 'run-managed-bootstrap', 1, 'svc-main', 'rev-published', 'request-managed-bootstrap'),
    'opencrane-managed-agent-runtime', 'runtime', 'managed-runtime', 'deployment',
    'pod-uid-managed-bootstrap', 'standard', 'pod-uid-managed-bootstrap', clock_timestamp() + interval '1 hour'
);
UPDATE "agent_runs" SET "state" = 'assigned' WHERE "id" = 'run-managed-bootstrap';

INSERT INTO "warm_runtime_reservations" (
    "run_id", "attempt", "generation", "silo_id", "namespace", "deployment_name", "deployment_uid",
    "pod_name", "pod_uid", "pod_resource_version", "generic_profile", "claimed_profile",
    "service_account_name", "state", "idle_deadline"
) VALUES (
    'run-managed-bootstrap', 1, 1, 'silo-1', 'managed-runtime', 'phase-d-managed-warm',
    'deployment-uid-managed-bootstrap', 'pod-managed-bootstrap', 'pod-uid-managed-bootstrap', '1',
    'generic', 'standard', 'runtime', 'reserved', clock_timestamp() + interval '30 minutes'
);

INSERT INTO "workload_bootstraps" (
    "id", "run_id", "attempt", "generation", "agent_service_id", "agent_revision_id", "silo_id", "agent_identity_id", "principal_id", "execution_subject",
    "audience", "service_account_name", "namespace", "workload_kind", "workload_uid", "claim_digest", "expires_at"
) VALUES (
    'bootstrap-managed', 'run-managed-bootstrap', 1, 1, 'svc-main', 'rev-published', 'silo-1',
    'agent-service:svc-main', 'svc-main-principal', pg_temp.execution_subject('silo-1', 'agent-service:svc-main', 'svc-main-principal', 'run-managed-bootstrap', 1, 'svc-main', 'rev-published', 'request-managed-bootstrap'), 'opencrane-managed-agent-runtime', 'runtime', 'managed-runtime', 'deployment',
    'pod-uid-managed-bootstrap', 'sha256:' || repeat('e', 64), clock_timestamp() + interval '30 minutes'
);

UPDATE "warm_runtime_reservations"
SET "state" = 'ready', "profile_activated_at" = clock_timestamp(), "readiness_observed_at" = clock_timestamp()
WHERE "run_id" = 'run-managed-bootstrap' AND "attempt" = 1 AND "generation" = 1;
UPDATE "workload_assignments"
SET "state" = 'registered', "registered_at" = clock_timestamp()
WHERE "run_id" = 'run-managed-bootstrap' AND "attempt" = 1;
UPDATE "workload_bootstraps"
SET "consumed_at" = clock_timestamp(), "consumed_by_pod_uid" = 'pod-uid-managed-bootstrap',
    "receipt_id" = 'receipt-managed-bootstrap'
WHERE "id" = 'bootstrap-managed';
INSERT INTO "run_proof_keys" (
    "id", "bootstrap_id", "run_id", "attempt", "generation", "workload_kind", "workload_uid", "pod_uid",
    "public_key_jwk", "key_thumbprint", "expires_at"
) VALUES (
    'proof-key-managed', 'bootstrap-managed', 'run-managed-bootstrap', 1, 1, 'deployment',
    'pod-uid-managed-bootstrap', 'pod-uid-managed-bootstrap', '{}', repeat('w', 43),
    clock_timestamp() + interval '20 minutes'
);
UPDATE "warm_runtime_reservations"
SET "state" = 'claimed', "proof_key_thumbprint" = repeat('w', 43), "bound_at" = clock_timestamp()
WHERE "run_id" = 'run-managed-bootstrap' AND "attempt" = 1 AND "generation" = 1;

SELECT pg_temp.assert_true(
    'managed runtime audience binds assignment, reservation, bootstrap, and proof in one transaction',
    EXISTS (
        SELECT 1
        FROM "workload_assignments" assignment
        JOIN "warm_runtime_reservations" reservation
          ON reservation."run_id" = assignment."run_id" AND reservation."attempt" = assignment."attempt"
         AND reservation."generation" = assignment."binding_generation"
        JOIN "workload_bootstraps" bootstrap
          ON bootstrap."run_id" = reservation."run_id" AND bootstrap."attempt" = reservation."attempt"
         AND bootstrap."generation" = reservation."generation"
        JOIN "run_proof_keys" proof_key
          ON proof_key."bootstrap_id" = bootstrap."id" AND proof_key."run_id" = bootstrap."run_id"
         AND proof_key."attempt" = bootstrap."attempt" AND proof_key."generation" = bootstrap."generation"
        WHERE assignment."run_id" = 'run-managed-bootstrap'
          AND assignment."audience" = 'opencrane-managed-agent-runtime'
          AND bootstrap."audience" = assignment."audience"
          AND reservation."state" = 'claimed'
          AND assignment."state" = 'registered'
          AND bootstrap."consumed_by_pod_uid" = reservation."pod_uid"
          AND proof_key."pod_uid" = reservation."pod_uid"
    )
);

INSERT INTO "capability_catalog_revisions" (
    "id", "catalog_id", "revision", "digest", "capabilities", "created_by"
) VALUES (
    'catalog-revision-1', 'catalog-1', 1, 'sha256:' || repeat('6', 64), '{}', 'user-1'
);

UPDATE "agent_runs"
SET "state" = 'running', "started_at" = clock_timestamp()
WHERE "id" = 'run-action';
UPDATE "agent_runs" SET "state" = 'waiting_for_input' WHERE "id" = 'run-action';

SELECT pg_temp.assert_true(
    'ApprovalRequest requires exact live tool and elicitation coordinates',
    (SELECT count(*) = 7 AND bool_and("is_nullable" = 'NO')
       FROM information_schema.columns
      WHERE "table_schema" = current_schema()
        AND "table_name" = 'approval_requests'
        AND "column_name" IN (
            'elicitation_request_id', 'tool_invocation_row_id', 'reviewed_tool_arguments',
            'reviewed_tool_schema', 'reviewed_tool_schema_digest', 'safe_proposed_arguments',
            'response_schema'
        ))
);

SELECT pg_temp.assert_true(
    'ApprovalRequest no longer duplicates capability-catalog coordinates',
    NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE "table_schema" = current_schema()
           AND "table_name" = 'approval_requests'
           AND "column_name" IN ('catalog_id', 'catalog_revision', 'catalog_digest', 'capability_id')
    )
);

SELECT pg_temp.assert_true(
    'central authorization rows do not retain callerless approval flags or resume tokens',
    NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE "table_schema" = current_schema()
           AND (("table_name" = 'authorization_grants' AND "column_name" = 'require_approval')
             OR ("table_name" = 'approval_requests' AND "column_name" = 'resume_token_hash'))
    )
);

INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
    "catalog_id", "catalog_revision", "catalog_digest", "capability_id", "resource_kind",
    "resource_id", "effect", "priority", "created_by"
) VALUES (
    'grant-personal-1', 'silo-1', 'principal', NULL, 'user-1',
    'personal', NULL, 'user-1', 'exact',
    'catalog-1', 1, 'sha256:' || repeat('6', 64), 'email.send', 'message',
    'message-1', 'allow', 100, 'user-1'
);

SELECT pg_temp.expect_failure(
    'duplicate active personal-boundary grant is rejected',
    $statement$
        INSERT INTO "authorization_grants" (
            "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
            "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
            "catalog_id", "catalog_revision", "catalog_digest", "capability_id", "resource_kind",
            "resource_id", "effect", "priority", "created_by"
        ) VALUES (
            'grant-personal-2', 'silo-1', 'principal', NULL, 'user-1',
            'personal', NULL, 'user-1', 'exact',
            'catalog-1', 1, 'sha256:' || repeat('6', 64), 'email.send', 'message',
            'message-1', 'allow', 100, 'user-1'
        )
    $statement$,
    'authorization_grant_exact_authority_key'
);

UPDATE "authorization_grants"
   SET "revoked_at" = clock_timestamp()
 WHERE "id" = 'grant-personal-1';

INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
    "catalog_id", "catalog_revision", "catalog_digest", "capability_id", "resource_kind",
    "resource_id", "effect", "priority", "created_by"
) VALUES (
    'grant-personal-2', 'silo-1', 'principal', NULL, 'user-1',
    'personal', NULL, 'user-1', 'exact',
    'catalog-1', 1, 'sha256:' || repeat('6', 64), 'email.send', 'message',
    'message-1', 'allow', 100, 'user-1'
);

SELECT pg_temp.expect_failure(
    'a new active duplicate is rejected after revoke and recreate',
    $statement$
        INSERT INTO "authorization_grants" (
            "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
            "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
            "catalog_id", "catalog_revision", "catalog_digest", "capability_id", "resource_kind",
            "resource_id", "effect", "priority", "created_by"
        ) VALUES (
            'grant-personal-3', 'silo-1', 'principal', NULL, 'user-1',
            'personal', NULL, 'user-1', 'exact',
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
    "id", "revision_id", "assertion_id", "silo_id", "subject_id"
) VALUES (
    'assertion-before-acceptance-1', 'membership-1', 'assertion-1', 'silo-1', 'user-1'
), (
    'assertion-before-acceptance-2', 'membership-2', 'assertion-2', 'silo-1', 'user-1'
);

INSERT INTO "highest_accepted_fleet_memberships" (
    "issuer_id", "silo_id", "revision_id", "revision", "accepted_at"
) VALUES ('fleet-issuer', 'silo-1', 'membership-1', 1, clock_timestamp());

SELECT pg_temp.expect_failure(
    'accepted fleet membership revision cannot receive another assertion',
    $statement$
        INSERT INTO "verified_fleet_membership_assertions" (
            "id", "revision_id", "assertion_id", "silo_id", "subject_id"
        ) VALUES (
            'assertion-after-acceptance-1', 'membership-1', 'assertion-3',
            'silo-1', 'user-2'
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
            "id", "revision_id", "assertion_id", "silo_id", "subject_id"
        ) VALUES (
            'assertion-after-supersession', 'membership-1', 'assertion-4',
            'silo-1', 'user-3'
        )
    $statement$,
    'accepted fleet membership assertions are sealed'
);
SELECT pg_temp.expect_failure(
    'current fleet membership revision is sealed',
    $statement$
        INSERT INTO "verified_fleet_membership_assertions" (
            "id", "revision_id", "assertion_id", "silo_id", "subject_id"
        ) VALUES (
            'assertion-after-acceptance-2', 'membership-2', 'assertion-5',
            'silo-1', 'user-4'
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

INSERT INTO "conversation_run_events" ("conversation_id", "run_id", "attempt", "sequence", "type", "payload", "occurred_at") VALUES
    ('conversation-retry-retirement', 'run-retry-retirement', 1, 1, 'run.failed', '{}', clock_timestamp()),
    ('conversation-retry-rollover', 'run-retry-rollover', 1, 1, 'run.failed', '{}', clock_timestamp());

INSERT INTO "run_input_snapshots" (
    "id", "run_id", "attempt", "snapshot_version", "silo_id", "agent_service_id", "agent_revision_id",
    "agent_identity_id", "principal_id", "execution_subject", "conversation_id", "memory_facts", "model_route",
    "mcp_tools", "memory_query_policy", "budget_policy", "prompt_compiler_version", "input_digest"
)
SELECT
    'snapshot-' || "id", "id", "attempt", 1, "silo_id", "agent_service_id", "agent_revision_id",
    "agent_identity_id", "principal_id", "execution_subject", "conversation_id", '[]', '{}', '[]', '{}', '{}', 'prompt-v1', "input_snapshot_digest"
FROM "agent_runs"
WHERE "id" IN (
    'run-retry-retirement', 'run-retry-rollover', 'run-state', 'run-action', 'run-managed-bootstrap',
    'run-cancel-accepted', 'run-cancel-queued', 'run-cancel-assigned', 'run-cancel-running', 'run-cancel-waiting',
    'run-cancel-event', 'run-cancel-bootstrap', 'run-cancel-proof',
    'run-cancel-invariant-proofkey', 'run-cancel-workflow-task'
);
SET CONSTRAINTS ALL IMMEDIATE;

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

ROLLBACK;
