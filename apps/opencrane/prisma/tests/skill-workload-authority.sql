BEGIN;

CREATE FUNCTION pg_temp.expect_failure(test_name TEXT, statement TEXT, expected_message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE actual_message TEXT;
BEGIN
    BEGIN EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual_message = MESSAGE_TEXT;
        IF strpos(actual_message, expected_message) > 0 THEN RAISE NOTICE 'PASS: %', test_name; RETURN; END IF;
        RAISE EXCEPTION 'FAIL: % returned unexpected error: %', test_name, actual_message;
    END;
    RAISE EXCEPTION 'FAIL: % unexpectedly succeeded', test_name;
END;
$$;

CREATE FUNCTION pg_temp.assert_true(test_name TEXT, condition BOOLEAN) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF condition IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', test_name; END IF;
    RAISE NOTICE 'PASS: %', test_name;
END;
$$;

INSERT INTO "artifacts" ("id", "silo_id", "owner_principal_id", "kind", "updated_at")
VALUES ('runner-artifact', 'runner-silo', 'runner-user', 'skill', clock_timestamp());
INSERT INTO "artifact_revisions" ("id", "artifact_id", "revision", "content_address", "byte_length", "media_type", "provenance", "created_by")
VALUES ('runner-artifact-revision', 'runner-artifact', 1, 'sha256:' || repeat('a', 64), 1, 'application/gzip', '{}', 'runner-user');
UPDATE "artifact_revisions" SET "state" = 'published' WHERE "id" = 'runner-artifact-revision';
UPDATE "artifacts" SET "current_revision_id" = 'runner-artifact-revision' WHERE "id" = 'runner-artifact';

INSERT INTO "skills" ("id", "silo_id", "owner_principal_id", "name", "updated_at")
VALUES ('runner-skill', 'runner-silo', 'runner-user', 'runner skill', clock_timestamp());
INSERT INTO "skill_revisions" ("id", "skill_id", "revision", "artifact_id", "artifact_revision_id", "artifact_content_address", "manifest", "requirements", "trust_class", "authored_by")
VALUES ('runner-revision', 'runner-skill', 1, 'runner-artifact', 'runner-artifact-revision', 'sha256:' || repeat('a', 64), '{}', '{}', 'sandboxed_python', 'runner-user');
UPDATE "skill_revisions"
SET "state" = 'review', "reviewed_by" = 'reviewer', "test_report" = '{"passed":true}', "scan_result" = '{"passed":true}'
WHERE "id" = 'runner-revision';
UPDATE "skill_revisions"
SET "state" = 'published', "signature" = 'signature', "signer_key_id" = 'key', "published_at" = clock_timestamp()
WHERE "id" = 'runner-revision';

INSERT INTO "oci_image_validations" ("id", "silo_id", "artifact_id", "artifact_revision_id", "content_address", "byte_length", "media_type", "submission_key_digest", "submission_digest", "state", "index_digest", "image_manifest_digest", "config_digest", "registry_reference", "created_by_principal_id", "completed_at", "updated_at")
VALUES ('runner-oci', 'runner-silo', 'runner-artifact', 'runner-artifact-revision', 'sha256:' || repeat('a', 64), 1, 'application/vnd.oci.image.layout.v1+zip', 'sha256:' || repeat('b', 64), 'sha256:' || repeat('c', 64), 'imported', 'sha256:' || repeat('d', 64), 'sha256:' || repeat('e', 64), 'sha256:' || repeat('f', 64), 'registry.local/opencrane/runner@sha256:' || repeat('1', 64), 'runner-user', clock_timestamp(), clock_timestamp());
INSERT INTO "mcp_servers" ("id", "silo_id", "name", "endpoint", "transport", "status", "updated_at")
VALUES ('runner-server', 'runner-silo', 'runner server', 'oci://runner', 'oci-image', 'active', clock_timestamp());
INSERT INTO "mcp_server_revisions" ("id", "silo_id", "mcp_server_id", "oci_image_validation_id", "revision", "registry_reference", "protocol_version", "state", "completed_at", "updated_at")
VALUES ('runner-server-revision', 'runner-silo', 'runner-server', 'runner-oci', 1, 'registry.local/opencrane/runner@sha256:' || repeat('1', 64), '2026-07-28', 'ready', clock_timestamp(), clock_timestamp());
INSERT INTO "mcp_tool_revisions" ("id", "silo_id", "server_revision_id", "name", "input_schema", "input_schema_digest")
VALUES ('runner-tool-revision', 'runner-silo', 'runner-server-revision', 'run', '{}', 'sha256:' || repeat('2', 64));
INSERT INTO "mcp_tasks" ("id", "silo_id", "principal_id", "request_key_digest", "call_digest", "server_revision_id", "tool_revision_id", "protocol_version", "arguments", "updated_at")
VALUES ('runner-task', 'runner-silo', 'runner-user', 'sha256:' || repeat('3', 64), 'sha256:' || repeat('4', 64), 'runner-server-revision', 'runner-tool-revision', '2026-07-28', '{}', clock_timestamp());
INSERT INTO "tool_invocations" ("id", "silo_id", "mcp_task_id", "subject_id", "runtime_instance_id", "command_id", "candidate_id", "tool_revision_id", "tool_invocation_id", "arguments", "arguments_digest", "effective_arguments", "effective_arguments_digest", "request_fingerprint", "request_identity", "recovery_mode", "retry_deadline_at", "next_preparation_attempt_at", "updated_at")
VALUES ('runner-invocation', 'runner-silo', 'runner-task', 'runner-user', 'runner-runtime', 'runner-command', 'runner-candidate', 'runner-tool-revision', 'runner-public-invocation', '{}', 'sha256:' || repeat('5', 64), '{}', 'sha256:' || repeat('5', 64), 'sha256:' || repeat('6', 64), '{}', 'manual', clock_timestamp() + interval '1 hour', clock_timestamp(), clock_timestamp());
UPDATE "tool_invocations" SET "state" = 'ready', "revision" = 1, "updated_at" = clock_timestamp() WHERE "id" = 'runner-invocation';

SELECT pg_temp.expect_failure('a tool-runner workload requires an invocation anchor', $statement$INSERT INTO "skill_workloads" ("id", "silo_id", "kind", "skill_revision_id") VALUES ('runner-no-anchor', 'runner-silo', 'tool_runner', 'runner-revision')$statement$, 'same-silo Ready ToolInvocation');
INSERT INTO "skill_workloads" ("id", "silo_id", "kind", "skill_revision_id", "tool_invocation_id")
VALUES ('runner-work', 'runner-silo', 'tool_runner', 'runner-revision', 'runner-invocation');
SELECT pg_temp.assert_true('the claim view exposes published tool-runner work', EXISTS (SELECT 1 FROM "skill_workload_claim_candidates" WHERE "id" = 'runner-work' AND "kind" = 'tool_runner'));
SELECT pg_temp.assert_true('the skill clock exposes database time', EXISTS (SELECT 1 FROM "skill_authority_clock" WHERE "singleton" = 1 AND "now" <= clock_timestamp()));

UPDATE "skill_workloads"
SET "claimed_at" = TIMESTAMP '1970-01-01', "claim_expires_at" = TIMESTAMP '1970-01-01 00:01:00', "delivery_count" = 1
WHERE "id" = 'runner-work';
SELECT pg_temp.assert_true('claim timing comes from the database clock', (SELECT "claimed_at" > TIMESTAMP '2026-01-01' AND "claim_expires_at" - "claimed_at" = interval '1 minute' FROM "skill_workloads" WHERE "id" = 'runner-work'));
UPDATE "skill_workloads" SET "state" = 'assigned', "workload_uid" = 'runner-job-uid' WHERE "id" = 'runner-work';

SELECT pg_temp.expect_failure('bootstrap identity is fixed to the tool-runner class', $statement$INSERT INTO "skill_workload_bootstraps" ("id", "skill_workload_id", "reference_hash", "audience", "service_account_name", "namespace", "workload_uid") VALUES ('runner-bad-bootstrap', 'runner-work', 'sha256:' || repeat('7', 64), 'opencrane-skill-authoring', 'skill-authoring-default', 'opencrane-tools', 'runner-job-uid')$statement$, 'tool-runner workload class');
INSERT INTO "skill_workload_bootstraps" ("id", "skill_workload_id", "reference_hash", "audience", "service_account_name", "namespace", "workload_uid")
VALUES ('runner-bootstrap', 'runner-work', 'sha256:' || repeat('8', 64), 'opencrane-tool-runner', 'tool-runner-default', 'opencrane-tools', 'runner-job-uid');
SELECT pg_temp.expect_failure('release requires a prior live claim', $statement$UPDATE "skill_workloads" SET "released_at" = clock_timestamp() WHERE "id" = 'runner-work'$statement$, 'current bootstrap-backed prior release claim');
UPDATE "skill_workloads"
SET "release_claimed_at" = clock_timestamp(), "release_delivery_count" = 1, "release_expires_at" = clock_timestamp() + interval '1 minute'
WHERE "id" = 'runner-work';
UPDATE "skill_workloads" SET "released_at" = clock_timestamp() WHERE "id" = 'runner-work';
UPDATE "skill_workloads" SET "worker_pod_uid" = 'runner-pod-uid' WHERE "id" = 'runner-work';
UPDATE "skill_workload_bootstraps" SET "consumed_at" = TIMESTAMP '1970-01-01', "consumed_by_pod_uid" = 'runner-pod-uid' WHERE "id" = 'runner-bootstrap';
SELECT pg_temp.assert_true('bootstrap consumption uses the database clock', (SELECT "consumed_at" > TIMESTAMP '2026-01-01' FROM "skill_workload_bootstraps" WHERE "id" = 'runner-bootstrap'));

SELECT pg_temp.expect_failure('generic workload authority cannot complete tool execution', $statement$UPDATE "skill_workloads" SET "state" = 'succeeded', "completed_at" = clock_timestamp() WHERE "id" = 'runner-work'$statement$, 'completion belongs to its ToolInvocation authority');
SELECT pg_temp.expect_failure('workload source coordinates are immutable', $statement$UPDATE "skill_workloads" SET "silo_id" = 'other-silo' WHERE "id" = 'runner-work'$statement$, 'source coordinates are immutable');
SELECT pg_temp.expect_failure('workload evidence cannot be deleted', $statement$DELETE FROM "skill_workloads" WHERE "id" = 'runner-work'$statement$, 'SkillWorkload rows cannot be deleted');

UPDATE "tool_invocations"
SET "state" = 'failed', "failure_code" = 'cancelled_by_test', "completed_at" = clock_timestamp(), "revision" = 2, "updated_at" = clock_timestamp()
WHERE "id" = 'runner-invocation';
SELECT pg_temp.assert_true('a terminal invocation cancels its remaining tool-runner workload', (SELECT "state" = 'cancelled' AND "cancelled_at" IS NOT NULL FROM "skill_workloads" WHERE "id" = 'runner-work'));
SELECT pg_temp.expect_failure('cancelled workloads are terminal', $statement$UPDATE "skill_workloads" SET "state" = 'pending', "cancelled_at" = NULL WHERE "id" = 'runner-work'$statement$, 'terminal SkillWorkload is immutable');

ROLLBACK;
