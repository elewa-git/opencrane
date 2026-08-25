BEGIN;

CREATE FUNCTION pg_temp.expect_failure(test_name TEXT, statement TEXT, expected_message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE actual_message TEXT;
BEGIN
    BEGIN EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual_message = MESSAGE_TEXT;
        IF strpos(actual_message, expected_message) > 0 THEN RAISE NOTICE 'PASS: %', test_name; RETURN; END IF;
        RAISE EXCEPTION 'FAIL: % returned unexpected error: %', test_name, actual_message;
    END;
    RAISE EXCEPTION 'FAIL: % unexpectedly succeeded';
END;
$$;

CREATE FUNCTION pg_temp.assert_true(test_name TEXT, condition BOOLEAN) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF condition IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', test_name; END IF;
    RAISE NOTICE 'PASS: %', test_name;
END;
$$;

INSERT INTO "artifacts" ("id", "silo_id", "owner_principal_id", "kind", "updated_at")
VALUES ('validation-artifact', 'validation-silo', 'validation-user', 'skill', clock_timestamp());
INSERT INTO "artifact_revisions" ("id", "artifact_id", "revision", "content_address", "byte_length", "media_type", "provenance", "created_by")
VALUES ('validation-artifact-revision', 'validation-artifact', 1, 'sha256:' || repeat('a', 64), 1, 'application/gzip', '{}', 'validation-user');
UPDATE "artifact_revisions" SET "state" = 'published' WHERE "id" = 'validation-artifact-revision';
UPDATE "artifacts" SET "current_revision_id" = 'validation-artifact-revision' WHERE "id" = 'validation-artifact';
INSERT INTO "skills" ("id", "silo_id", "owner_principal_id", "name", "updated_at")
VALUES ('validation-skill', 'validation-silo', 'validation-user', 'validation skill', clock_timestamp());
INSERT INTO "skill_revisions" ("id", "skill_id", "revision", "artifact_id", "artifact_revision_id", "artifact_content_address", "manifest", "requirements", "trust_class", "authored_by")
VALUES ('validation-revision', 'validation-skill', 1, 'validation-artifact', 'validation-artifact-revision', 'sha256:' || repeat('a', 64), '{}', '{}', 'sandboxed_python', 'validation-user');

INSERT INTO "skill_authoring_validations" ("id", "silo_id", "skill_revision_id", "artifact_revision_id", "artifact_content_address", "task_key")
VALUES ('validation-1', 'validation-silo', 'validation-revision', 'validation-artifact-revision', 'sha256:' || repeat('a', 64), 'workflows:skill-authoring-validation:' || repeat('b', 64));

SELECT pg_temp.expect_failure(
    'validation cannot become successful without task, job, pod, and inbox evidence',
    $statement$UPDATE "skill_authoring_validations" SET "state" = 'succeeded' WHERE "id" = 'validation-1'$statement$,
    'invalid transition from pending'
);
INSERT INTO "artifact_revisions" ("id", "artifact_id", "revision", "content_address", "byte_length", "media_type", "provenance", "created_by")
VALUES ('validation-artifact-unpublished', 'validation-artifact', 2, 'sha256:' || repeat('c', 64), 1, 'application/gzip', '{}', 'validation-user');
INSERT INTO "skill_revisions" ("id", "skill_id", "revision", "artifact_id", "artifact_revision_id", "artifact_content_address", "manifest", "requirements", "trust_class", "authored_by")
VALUES ('validation-revision-unpublished', 'validation-skill', 2, 'validation-artifact', 'validation-artifact-unpublished', 'sha256:' || repeat('c', 64), '{}', '{}', 'sandboxed_python', 'validation-user');
SELECT pg_temp.expect_failure(
    'validation rejects an unpublished pinned artifact',
    $statement$
        INSERT INTO "skill_authoring_validations" ("id", "silo_id", "skill_revision_id", "artifact_revision_id", "artifact_content_address", "task_key")
        VALUES ('validation-unpublished', 'validation-silo', 'validation-revision-unpublished', 'validation-artifact-unpublished', 'sha256:' || repeat('c', 64), 'workflows:skill-authoring-validation:' || repeat('c', 64))
    $statement$,
    'active pinned artifact'
);

UPDATE "skill_authoring_validations"
SET "task_id" = 'validation-task-1', "task_name" = 'skills.authoring.validate/v1'
WHERE "id" = 'validation-1';
INSERT INTO "skill_authoring_validation_workload_claims" ("id", "validation_id", "workload_class", "profile_name", "idempotency_key", "execution_reference")
VALUES ('validation-claim-1', 'validation-1', 'skill_authoring_validation', 'authoring', 'workflows:skill-authoring-validation-workload:' || repeat('d', 64), 'validation-1');
UPDATE "skill_authoring_validation_workload_claims"
SET "claimed_at" = date_trunc('milliseconds', clock_timestamp())::TIMESTAMP(3), "expires_at" = date_trunc('milliseconds', clock_timestamp())::TIMESTAMP(3) + interval '5 minutes', "delivery_count" = 1
WHERE "id" = 'validation-claim-1';
UPDATE "skill_authoring_validation_workload_claims" SET "workload_uid" = 'validation-job-1' WHERE "id" = 'validation-claim-1';
UPDATE "skill_authoring_validations" SET "state" = 'running' WHERE "id" = 'validation-1';
INSERT INTO "skill_authoring_validation_bootstraps" ("id", "validation_id", "reference_hash", "namespace", "service_account", "expires_at")
VALUES ('validation-bootstrap-1', 'validation-1', 'sha256:' || repeat('d', 64), 'validation-authoring', 'skill-authoring-default', clock_timestamp() + interval '5 minutes');
SELECT pg_temp.expect_failure(
    'completion requires the exact consumed bootstrap',
    $statement$
        UPDATE "skill_authoring_validation_workload_claims" SET "first_pod_uid" = 'validation-pod-1' WHERE "id" = 'validation-claim-1';
        INSERT INTO "skill_authoring_validation_completion_inbox" ("id", "validation_id", "completion_digest", "outcome", "test_report", "scan_result")
        VALUES ('validation-inbox-without-bootstrap', 'validation-1', 'sha256:' || repeat('e', 64), 'succeeded', '{"passed":true}', '{"passed":true}')
    $statement$,
    'requires a running validation and digest'
);
UPDATE "skill_authoring_validation_workload_claims" SET "first_pod_uid" = 'validation-pod-1' WHERE "id" = 'validation-claim-1';
UPDATE "skill_authoring_validation_bootstraps"
SET "consumed_at" = TIMESTAMP '1970-01-01', "consumed_by_pod_uid" = 'validation-pod-1'
WHERE "id" = 'validation-bootstrap-1';
SELECT pg_temp.assert_true(
    'bootstrap consumption uses the database clock',
    (SELECT "consumed_at" > TIMESTAMP '2026-01-01' FROM "skill_authoring_validation_bootstraps" WHERE "id" = 'validation-bootstrap-1')
);
INSERT INTO "skill_authoring_validation_completion_inbox" ("id", "validation_id", "completion_digest", "outcome", "test_report", "scan_result")
VALUES ('validation-inbox-1', 'validation-1', 'sha256:' || repeat('e', 64), 'succeeded', '{"passed":true}', '{"passed":true}');
SELECT pg_temp.expect_failure(
    'wake-up event must name its saved completion',
    $statement$
        INSERT INTO "skill_authoring_validation_workflow_event_outbox" ("id", "completion_inbox_id", "event_name", "payload")
        VALUES ('validation-outbox-invalid', 'validation-inbox-1', 'skill-authoring-completed', '{}')
    $statement$,
    'payload must name its saved completion'
);
INSERT INTO "skill_authoring_validation_workflow_event_outbox" ("id", "completion_inbox_id", "event_name", "payload")
VALUES ('validation-outbox-1', 'validation-inbox-1', 'skill-authoring-completed', jsonb_build_object('validationId', 'validation-1', 'completionDigest', 'sha256:' || repeat('e', 64)));
UPDATE "skill_authoring_validations" SET "state" = 'succeeded' WHERE "id" = 'validation-1';

INSERT INTO "skill_revisions" ("id", "skill_id", "revision", "artifact_id", "artifact_revision_id", "artifact_content_address", "manifest", "requirements", "trust_class", "authored_by")
VALUES ('validation-revision-2', 'validation-skill', 3, 'validation-artifact', 'validation-artifact-revision', 'sha256:' || repeat('a', 64), '{}', '{}', 'sandboxed_python', 'validation-user');
INSERT INTO "skill_authoring_validations" ("id", "silo_id", "skill_revision_id", "artifact_revision_id", "artifact_content_address", "task_key")
VALUES ('validation-2', 'validation-silo', 'validation-revision-2', 'validation-artifact-revision', 'sha256:' || repeat('a', 64), 'workflows:skill-authoring-validation:' || repeat('f', 64));
UPDATE "skill_authoring_validations" SET "task_id" = 'validation-task-2', "task_name" = 'skills.authoring.validate/v1' WHERE "id" = 'validation-2';
INSERT INTO "skill_authoring_validation_workload_claims" ("id", "validation_id", "workload_class", "profile_name", "idempotency_key", "execution_reference")
VALUES ('validation-claim-2', 'validation-2', 'skill_authoring_validation', 'authoring', 'workflows:skill-authoring-validation-workload:' || repeat('e', 64), 'validation-2');
UPDATE "skill_authoring_validation_workload_claims"
SET "claimed_at" = date_trunc('milliseconds', clock_timestamp())::TIMESTAMP(3), "expires_at" = date_trunc('milliseconds', clock_timestamp())::TIMESTAMP(3) + interval '5 minutes', "delivery_count" = 1
WHERE "id" = 'validation-claim-2';
UPDATE "skill_authoring_validation_workload_claims" SET "workload_uid" = 'validation-job-2' WHERE "id" = 'validation-claim-2';
UPDATE "skill_authoring_validations" SET "state" = 'running' WHERE "id" = 'validation-2';
INSERT INTO "skill_authoring_validation_bootstraps" ("id", "validation_id", "reference_hash", "namespace", "service_account", "expires_at")
VALUES ('validation-bootstrap-2', 'validation-2', 'sha256:' || repeat('f', 64), 'validation-authoring', 'skill-authoring-default', clock_timestamp() + interval '5 minutes');
UPDATE "skill_authoring_validation_workload_claims" SET "first_pod_uid" = 'validation-pod-2' WHERE "id" = 'validation-claim-2';
UPDATE "skill_authoring_validation_bootstraps" SET "consumed_at" = clock_timestamp(), "consumed_by_pod_uid" = 'validation-pod-2' WHERE "id" = 'validation-bootstrap-2';
INSERT INTO "skill_authoring_validation_completion_inbox" ("id", "validation_id", "completion_digest", "outcome", "test_report", "scan_result")
VALUES ('validation-inbox-2', 'validation-2', 'sha256:' || repeat('e', 64), 'succeeded', '{"passed":true}', '{"passed":true}');
SELECT pg_temp.assert_true(
    'matching completion digests remain valid for distinct validations',
    (SELECT count(*) = 2 FROM "skill_authoring_validation_completion_inbox" WHERE "completion_digest" = 'sha256:' || repeat('e', 64))
);

INSERT INTO "skill_revisions" ("id", "skill_id", "revision", "artifact_id", "artifact_revision_id", "artifact_content_address", "manifest", "requirements", "trust_class", "authored_by")
VALUES ('validation-revision-3', 'validation-skill', 4, 'validation-artifact', 'validation-artifact-revision', 'sha256:' || repeat('a', 64), '{}', '{}', 'sandboxed_python', 'validation-user');
INSERT INTO "skill_authoring_validations" ("id", "silo_id", "skill_revision_id", "artifact_revision_id", "artifact_content_address", "task_key")
VALUES ('validation-3', 'validation-silo', 'validation-revision-3', 'validation-artifact-revision', 'sha256:' || repeat('a', 64), 'workflows:skill-authoring-validation:' || repeat('d', 64));
UPDATE "skill_authoring_validations" SET "task_id" = 'validation-task-3', "task_name" = 'skills.authoring.validate/v1' WHERE "id" = 'validation-3';
INSERT INTO "skill_authoring_validation_workload_claims" ("id", "validation_id", "workload_class", "profile_name", "idempotency_key", "execution_reference")
VALUES ('validation-claim-3', 'validation-3', 'skill_authoring_validation', 'authoring', 'workflows:skill-authoring-validation-workload:' || repeat('f', 64), 'validation-3');
UPDATE "skill_authoring_validation_workload_claims"
SET "claimed_at" = date_trunc('milliseconds', clock_timestamp())::TIMESTAMP(3), "expires_at" = date_trunc('milliseconds', clock_timestamp())::TIMESTAMP(3) + interval '50 milliseconds', "delivery_count" = 1
WHERE "id" = 'validation-claim-3';
UPDATE "skill_authoring_validation_workload_claims" SET "workload_uid" = 'validation-job-3' WHERE "id" = 'validation-claim-3';
UPDATE "skill_authoring_validations" SET "state" = 'running' WHERE "id" = 'validation-3';
SELECT pg_sleep(0.1);
UPDATE "skill_authoring_validation_workload_claims"
SET "claimed_at" = date_trunc('milliseconds', clock_timestamp())::TIMESTAMP(3), "expires_at" = date_trunc('milliseconds', clock_timestamp())::TIMESTAMP(3) + interval '5 minutes', "delivery_count" = 2
WHERE "id" = 'validation-claim-3';
SELECT pg_temp.assert_true(
    'an expired workload lease may recover the same Job before its first Pod binds',
    (SELECT "workload_uid" = 'validation-job-3' AND "first_pod_uid" IS NULL AND "delivery_count" = 2 FROM "skill_authoring_validation_workload_claims" WHERE "id" = 'validation-claim-3')
);

ROLLBACK;
