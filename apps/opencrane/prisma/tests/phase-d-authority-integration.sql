BEGIN;

SELECT pg_temp.seed_silo_model('silo-1', 'phase-d-model');
SELECT pg_temp.seed_external_user('silo-1', 'user-1');
SELECT pg_temp.seed_service_principal('silo-1', 'svc-main');
SELECT pg_temp.seed_service_principal('silo-1', 'svc-invalid-initial');
SELECT pg_temp.seed_service_principal('silo-1', 'svc-lifecycle');

CREATE FUNCTION pg_temp.seed_run_snapshot(run_identifier TEXT, snapshot_identifier TEXT, snapshot_attempt INTEGER, snapshot_digest TEXT, snapshot_subject JSONB)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO "run_input_snapshots" (
        "id", "run_id", "attempt", "snapshot_version", "silo_id", "agent_service_id", "agent_revision_id",
        "agent_identity_id", "principal_id", "execution_subject", "conversation_id", "model_route", "mcp_tools",
        "memory_query_policy", "budget_policy", "prompt_compiler_version", "input_digest"
    )
    SELECT snapshot_identifier, "id", snapshot_attempt, 1, "silo_id", "agent_service_id", "agent_revision_id",
        "agent_identity_id", "principal_id", snapshot_subject, "conversation_id", '{}', '[]', '{}', '{}',
        'prompt-v1', snapshot_digest
    FROM "agent_runs"
    WHERE "id" = run_identifier;
END;
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
            "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "input_snapshot_digest"
        ) VALUES (
            'run-wrong-silo', 'silo-other', 'svc-main', 'rev-published', NULL, 'interactive',
            'identity-1', 'user-1', '{"runScope":{"attempt":1}}', 'request-wrong-silo', 'sha256:' || repeat('f', 64)
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
            "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "input_snapshot_digest"
        ) VALUES (
            'run-unpublished', 'silo-1', 'svc-main', 'rev-draft', NULL, 'interactive',
            'identity-1', 'user-1', '{"runScope":{"attempt":1}}', 'request-unpublished', 'sha256:' || repeat('d', 64)
        )
    $statement$,
    'requires the exact silo and active revision of an Active AgentService'
);

SELECT pg_temp.expect_failure(
    'new AgentRun cannot bypass the initial state',
    $statement$
        INSERT INTO "agent_runs" (
            "id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger",
            "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "attempt", "state",
            "input_snapshot_digest", "finished_at", "terminal_reason"
        ) VALUES (
            'run-terminal-insert', 'silo-1', 'svc-main', 'rev-published', NULL, 'interactive',
            'identity-1', 'user-1', '{"runScope":{"attempt":1}}', 'request-terminal-insert', 1, 'completed',
            'sha256:' || repeat('d', 64), clock_timestamp(), 'success'
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

SELECT pg_temp.seed_managed_service('silo-1', 'svc-run-retirement', 'phase-d-model', 'rev-run-retirement');
SELECT pg_temp.seed_agent_conversation('conversation-retry-retirement', 'silo-1', 'svc-run-retirement');
INSERT INTO "agent_runs" (
    "id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger",
    "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "input_snapshot_digest"
) VALUES (
    'run-retry-retirement', 'silo-1', 'svc-run-retirement', 'rev-run-retirement', 'conversation-retry-retirement', 'interactive',
    'identity-1', 'user-1', '{"runScope":{"attempt":1}}', 'request-retry-retirement', 'sha256:' || repeat('2', 64)
);
SELECT pg_temp.seed_run_snapshot('run-retry-retirement', 'run-retry-retirement-input-1', 1, 'sha256:' || repeat('2', 64), '{"runScope":{"attempt":1}}');
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
            "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "input_snapshot_digest"
        ) VALUES (
            'run-after-retirement', 'silo-1', 'svc-run-retirement', 'rev-run-retirement', NULL, 'interactive',
            'identity-1', 'user-1', '{"runScope":{"attempt":1}}', 'request-after-retirement', 'sha256:' || repeat('4', 64)
        )
    $statement$,
    'requires the exact silo and active revision of an Active AgentService'
);

-- 0.11 seals one attempt per AgentRun row; a retry is a new admitted run, never an in-place bump.
SELECT pg_temp.expect_failure(
    'AgentRun retry cannot bump the attempt in place',
    $statement$
        UPDATE "agent_runs"
        SET "attempt" = 2, "state" = 'accepted', "accepted_at" = "accepted_at" + interval '1 second',
            "execution_subject" = '{"runScope":{"attempt":2}}', "input_snapshot_digest" = 'sha256:' || repeat('3', 64),
            "started_at" = NULL, "finished_at" = NULL, "terminal_reason" = NULL,
            "cost_amount" = NULL, "cost_currency" = NULL
        WHERE "id" = 'run-retry-retirement'
    $statement$,
    'AgentRun attempt is immutable'
);

SELECT pg_temp.seed_managed_service('silo-1', 'svc-run-rollover', 'phase-d-model', 'rev-run-rollover-1');
INSERT INTO "agent_revisions" ("id", "silo_id", "agent_service_id", "revision", "state", "digest", "prompt_policy_version", "model_definition_id", "budget", "authored_by", "published_at")
VALUES ('rev-run-rollover-2', 'silo-1', 'svc-run-rollover', 2, 'published', 'sha256:' || repeat('9', 64), 'prompt-v1', 'phase-d-model', '{}', 'user-1', clock_timestamp());
SELECT pg_temp.seed_agent_conversation('conversation-retry-rollover', 'silo-1', 'svc-run-rollover');
INSERT INTO "agent_runs" (
    "id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger",
    "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "input_snapshot_digest"
) VALUES (
    'run-retry-rollover', 'silo-1', 'svc-run-rollover', 'rev-run-rollover-1', 'conversation-retry-rollover', 'interactive',
    'identity-1', 'user-1', '{"runScope":{"attempt":1}}', 'request-retry-rollover', 'sha256:' || repeat('6', 64)
);
SELECT pg_temp.seed_run_snapshot('run-retry-rollover', 'run-retry-rollover-input-1', 1, 'sha256:' || repeat('6', 64), '{"runScope":{"attempt":1}}');
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
            "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "input_snapshot_digest"
        ) VALUES (
            'run-superseded-revision', 'silo-1', 'svc-run-rollover', 'rev-run-rollover-1', NULL, 'interactive',
            'identity-1', 'user-1', '{"runScope":{"attempt":1}}', 'request-superseded-revision', 'sha256:' || repeat('8', 64)
        )
    $statement$,
    'requires the exact silo and active revision of an Active AgentService'
);

SELECT pg_temp.expect_failure(
    'AgentRun retry cannot bump the attempt in place after revision rollover',
    $statement$
        UPDATE "agent_runs"
        SET "attempt" = 2, "state" = 'accepted', "accepted_at" = "accepted_at" + interval '1 second',
            "execution_subject" = '{"runScope":{"attempt":2}}', "input_snapshot_digest" = 'sha256:' || repeat('7', 64),
            "started_at" = NULL, "finished_at" = NULL, "terminal_reason" = NULL,
            "cost_amount" = NULL, "cost_currency" = NULL
        WHERE "id" = 'run-retry-rollover'
    $statement$,
    'AgentRun attempt is immutable'
);

SELECT pg_temp.seed_agent_conversation('conversation-run-state', 'silo-1', 'svc-main');
INSERT INTO "agent_runs" (
    "id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger",
    "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "input_snapshot_digest"
) VALUES (
    'run-state', 'silo-1', 'svc-main', 'rev-published', 'conversation-run-state', 'interactive',
    'identity-1', 'user-1', '{"runScope":{"attempt":1}}', 'request-state', 'sha256:' || repeat('a', 64)
);
SELECT pg_temp.seed_run_snapshot('run-state', 'run-state-input-1', 1, 'sha256:' || repeat('a', 64), '{"runScope":{"attempt":1}}');

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

-- 0.11 seals one attempt per AgentRun row; a retry admits a new run instead of reviving this one.
SELECT pg_temp.expect_failure(
    'terminal run cannot start another attempt in place',
    $statement$
        UPDATE "agent_runs"
        SET "attempt" = 2, "state" = 'accepted', "accepted_at" = "accepted_at" + interval '1 second',
            "execution_subject" = '{"runScope":{"attempt":2}}', "input_snapshot_digest" = 'sha256:' || repeat('b', 64),
            "started_at" = NULL, "finished_at" = NULL, "terminal_reason" = NULL,
            "cost_amount" = NULL, "cost_currency" = NULL
        WHERE "id" = 'run-state'
    $statement$,
    'AgentRun attempt is immutable'
);

INSERT INTO "capability_catalog_revisions" (
    "id", "catalog_id", "revision", "digest", "capabilities", "created_by"
) VALUES (
    'catalog-revision-1', 'catalog-1', 1, 'sha256:' || repeat('6', 64), '{}', 'user-1'
);

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

-- Every run above already sealed its single attempt snapshot through seed_run_snapshot.
SET CONSTRAINTS ALL IMMEDIATE;

INSERT INTO "audit_decisions" (
    "id", "decision_digest", "silo_id", "actor_kind", "actor_id", "audience", "namespace",
    "service_account_name", "workload_kind", "workload_uid", "pod_uid", "run_id", "attempt",
    "agent_service_id", "agent_revision_id",
    "resource_kind", "resource_id", "action", "catalog_id", "catalog_revision", "catalog_digest",
    "arguments_digest", "policy_revision_hash", "effective_authorization_digest", "outcome", "reason_code"
) VALUES (
    'audit-1', 'sha256:' || repeat('0', 64), 'silo-1', 'workload', 'pod-uid-1', 'service:email-send', 'tenant-silo-1',
	'runtime', 'job', 'job-uid-1', 'pod-uid-1', 'run-state', 1,
    'svc-main', 'rev-published',
    'message', 'message-1', 'send', 'catalog-1', 1, 'sha256:' || repeat('6', 64),
    'sha256:' || repeat('8', 64), 'sha256:' || repeat('7', 64), 'sha256:' || repeat('9', 64), 'allow', 'authorized'
);

SELECT pg_temp.assert_true(
    'workload audit evidence accepts the exact non-empty PEP audience',
    EXISTS (SELECT 1 FROM "audit_decisions" WHERE "id" = 'audit-1' AND "audience" = 'service:email-send')
);

-- Conversation updated_at orders lists, so it moves only with a participant-visible append in the same transaction or a lifecycle change.
SELECT pg_temp.seed_direct_conversation('conversation-activity-plain', 'silo-1');
SELECT pg_temp.seed_direct_conversation('conversation-activity-append', 'silo-1');
SELECT pg_temp.seed_participant('conversation-activity-append', 'user-1');
INSERT INTO "conversation_private_payloads" ("id", "silo_id", "conversation_id", "author_subject", "idempotency_key", "key_id", "nonce", "auth_tag", "ciphertext", "ciphertext_digest")
VALUES ('payload-activity-1', 'silo-1', 'conversation-activity-append', 'user-1', 'retry-activity-1', 'key-1', decode(repeat('00', 12), 'hex'), decode(repeat('00', 16), 'hex'), decode('01', 'hex'), 'sha256:' || repeat('a', 64));

SELECT pg_temp.expect_failure(
    'plain UPDATE of Conversation updated_at is rejected without an append for that conversation',
    $statement$ UPDATE "conversations" SET "updated_at" = clock_timestamp() WHERE "id" = 'conversation-activity-plain' $statement$,
    'Conversation updated_at moves only with a participant-visible append or a lifecycle change'
);

UPDATE "conversations" SET "updated_at" = TIMESTAMP '2000-01-01 00:00:00' WHERE "id" = 'conversation-activity-append';
SELECT pg_temp.assert_true(
    'an append in the same transaction moves Conversation updated_at to the database clock, not the caller value',
    (SELECT "updated_at" <> TIMESTAMP '2000-01-01 00:00:00' AND "updated_at" > clock_timestamp() - interval '1 minute' AND "updated_at" <= clock_timestamp()
       FROM "conversations" WHERE "id" = 'conversation-activity-append')
);

UPDATE "conversations" SET "lifecycle" = 'closed', "closed_at" = clock_timestamp(), "updated_at" = clock_timestamp() WHERE "id" = 'conversation-activity-plain';
SELECT pg_temp.assert_true(
    'a lifecycle change may move Conversation updated_at without an append',
    (SELECT "lifecycle" = 'closed' AND "updated_at" > clock_timestamp() - interval '1 minute' FROM "conversations" WHERE "id" = 'conversation-activity-plain')
);

-- ApprovalRequest expiry outlives the computer lease; every other decision still needs the live run and lease.
CREATE FUNCTION pg_temp.approval_execution_subject() RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
    SELECT ('{"siloId":"silo-1","agentIdentityId":"identity-conversation-approval","principalId":"user-1",'
        || '"identity":{"agentIdentityId":"identity-conversation-approval","principalId":"user-1"},'
        || '"membership":{"principalId":"user-1"},'
        || '"capability":{"agentIdentityId":"identity-conversation-approval","capabilitySetDigest":"sha256:' || repeat('e', 64) || '"},'
        || '"runScope":{"runId":"run-approval","attempt":1,"agentServiceId":"svc-approval","agentRevisionId":"rev-approval"},'
        || '"computerScope":{"computerId":"computer-conversation-approval","leaseId":"lease-approval","leaseGeneration":1}}')::jsonb;
$$;
SELECT pg_temp.seed_managed_service('silo-1', 'svc-approval', 'phase-d-model', 'rev-approval');
SELECT pg_temp.seed_agent_conversation('conversation-approval', 'silo-1', 'svc-approval');
SELECT pg_temp.seed_participant('conversation-approval', 'user-1');
-- The audit block above forced every constraint immediate; the run and its snapshot reference each other, so defer the pair again.
SET CONSTRAINTS "agent_runs_input_snapshot_fkey", agent_runs_input_snapshot_complete DEFERRED;
INSERT INTO "agent_runs" (
    "id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger",
    "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "input_snapshot_digest"
) VALUES (
    'run-approval', 'silo-1', 'svc-approval', 'rev-approval', 'conversation-approval', 'interactive',
    'identity-conversation-approval', 'user-1', pg_temp.approval_execution_subject(), 'request-approval', 'sha256:' || repeat('d', 64)
);
SELECT pg_temp.seed_run_snapshot('run-approval', 'run-approval-input-1', 1, 'sha256:' || repeat('d', 64), pg_temp.approval_execution_subject());
UPDATE "agent_runs" SET "state" = 'running', "started_at" = clock_timestamp() WHERE "id" = 'run-approval';
UPDATE "agent_runs" SET "state" = 'waiting_for_input' WHERE "id" = 'run-approval';
INSERT INTO "tool_invocations" (
    "id", "silo_id", "run_id", "attempt", "agent_service_id", "agent_revision_id", "agent_identity_id", "principal_id",
    "authorization_actor_kind", "authorization_execution_subject", "authorization_coordinates", "authorization_decision_digests",
    "authorization_assignment_digest", "authorization_evidence_digest",
    "runtime_instance_id", "command_id", "candidate_id", "tool_revision_id", "tool_invocation_id",
    "arguments", "arguments_digest", "effective_arguments", "effective_arguments_digest", "request_fingerprint", "request_identity",
    "approval_required", "recovery_mode", "retry_deadline_at", "next_preparation_attempt_at", "updated_at"
) VALUES (
    'invocation-approval', 'silo-1', 'run-approval', 1, 'svc-approval', 'rev-approval', 'identity-conversation-approval', 'user-1',
    'workload', pg_temp.approval_execution_subject(), '[{"resource":{"kind":"tool","id":"tool-rev-1"},"action":"invoke"}]', ARRAY['sha256:' || repeat('1', 64)],
    'sha256:' || repeat('2', 64), 'sha256:' || repeat('3', 64),
    'runtime-approval', 'command-approval', 'candidate-approval', 'tool-rev-1', 'tool-invocation-approval',
    '{}', 'sha256:' || repeat('4', 64), '{}', 'sha256:' || repeat('4', 64), 'sha256:' || repeat('5', 64), '{}',
    true, 'manual', clock_timestamp() + interval '1 hour', clock_timestamp(), clock_timestamp()
);
UPDATE "tool_invocations" SET "state" = 'awaiting_approval', "revision" = 1, "updated_at" = clock_timestamp() WHERE "id" = 'invocation-approval';
INSERT INTO "conversation_computer_active_leases" ("computer_id", "silo_id", "conversation_id", "agent_identity_id", "lease_id", "lease_generation", "expires_at", "updated_at")
VALUES ('computer-conversation-approval', 'silo-1', 'conversation-approval', 'identity-conversation-approval', 'lease-approval', 1, clock_timestamp() + interval '1 hour', clock_timestamp());
INSERT INTO "elicitation_requests" ("id", "silo_id", "conversation_id", "run_id", "attempt", "assigned_participant_id", "request_key", "purpose", "body_kind", "body", "body_digest", "purpose_payload_digest", "expires_at")
VALUES ('approval-lapsed-lease', 'silo-1', 'conversation-approval', 'run-approval', 1, 'user-1', 'sha256:' || repeat('6', 64), 'tool_approval', 'approval', '{}', 'sha256:' || repeat('7', 64), 'sha256:' || repeat('8', 64), clock_timestamp() + interval '1 hour');
INSERT INTO "approval_requests" (
    "id", "run_id", "attempt", "agent_revision_id", "agent_service_id", "silo_id", "agent_identity_id", "principal_id",
    "resource_kind", "resource_id", "action", "arguments_digest", "action_digest", "approver_policy_revision", "effective_policy_digest",
    "expires_at", "elicitation_request_id", "tool_invocation_row_id", "reviewed_tool_arguments", "reviewed_tool_schema",
    "reviewed_tool_schema_digest", "safe_proposed_arguments", "response_schema"
) VALUES (
    'approval-lapsed-lease', 'run-approval', 1, 'rev-approval', 'svc-approval', 'silo-1', 'identity-conversation-approval', 'user-1',
    'tool', 'tool-rev-1', 'invoke', 'sha256:' || repeat('4', 64), 'sha256:' || repeat('6', 64), 'policy-1', 'sha256:' || repeat('9', 64),
    clock_timestamp() + interval '500 milliseconds', 'approval-lapsed-lease', 'invocation-approval', '{}', '{}',
    'sha256:' || repeat('a', 64), '{}', '{}'
);

-- The lease lapses (the row is gone) while the approval is still pending.
DELETE FROM "conversation_computer_active_leases" WHERE "computer_id" = 'computer-conversation-approval';

SELECT pg_temp.expect_failure(
    'ApprovalRequest approval still requires the active computer lease',
    $statement$ UPDATE "approval_requests" SET "state" = 'approved', "decided_by" = 'user-1', "final_arguments" = '{}', "final_arguments_digest" = 'sha256:' || repeat('4', 64) WHERE "id" = 'approval-lapsed-lease' $statement$,
    'ApprovalRequest requires its exact active conversation computer lease'
);
SELECT pg_temp.expect_failure(
    'ApprovalRequest expiry without a lease still waits for its deadline',
    $statement$ UPDATE "approval_requests" SET "state" = 'expired', "decided_at" = clock_timestamp() WHERE "id" = 'approval-lapsed-lease' $statement$,
    'ApprovalRequest may expire only after its deadline'
);
SELECT pg_sleep(0.6);
SELECT pg_temp.expect_failure(
    'ApprovalRequest expiry cannot change identity or action bindings',
    $statement$ UPDATE "approval_requests" SET "state" = 'expired', "decided_at" = clock_timestamp(), "action" = 'other' WHERE "id" = 'approval-lapsed-lease' $statement$,
    'ApprovalRequest identity and action bindings are immutable'
);
SELECT pg_temp.expect_failure(
    'ApprovalRequest expiry cannot record a decider',
    $statement$ UPDATE "approval_requests" SET "state" = 'expired', "decided_at" = clock_timestamp(), "decided_by" = 'user-1' WHERE "id" = 'approval-lapsed-lease' $statement$,
    'ApprovalRequest expiry records no decider and no final arguments'
);
UPDATE "approval_requests" SET "state" = 'expired', "decided_at" = clock_timestamp(), "decided_by" = NULL WHERE "id" = 'approval-lapsed-lease';
SELECT pg_temp.assert_true(
    'ApprovalRequest expires after its lease lapsed and carries a database decision time without a decider',
    (SELECT "state" = 'expired' AND "decided_at" IS NOT NULL AND "decided_by" IS NULL FROM "approval_requests" WHERE "id" = 'approval-lapsed-lease')
);
SELECT pg_temp.expect_failure(
    'ApprovalRequest expiry of a non-pending row is rejected',
    $statement$ UPDATE "approval_requests" SET "state" = 'expired', "decided_at" = clock_timestamp() WHERE "id" = 'approval-lapsed-lease' $statement$,
    'ApprovalRequest may be decided exactly once'
);

ROLLBACK;
