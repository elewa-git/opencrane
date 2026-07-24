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

INSERT INTO "artifacts" ("id", "silo_id", "owner_principal_id", "kind", "updated_at") VALUES ('work-artifact','work-silo','user-1','skill',clock_timestamp());
INSERT INTO "artifact_revisions" ("id", "artifact_id", "revision", "content_address", "byte_length", "media_type", "provenance", "created_by") VALUES ('work-artifact-revision','work-artifact',1,'sha256:'||repeat('a',64),1,'application/gzip','{}','user-1');
UPDATE "artifacts" SET "current_revision_id"='work-artifact-revision' WHERE "id"='work-artifact';
INSERT INTO "skills" ("id", "silo_id", "owner_principal_id", "name", "updated_at") VALUES ('work-skill','work-silo','user-1','work skill',clock_timestamp());
INSERT INTO "skill_revisions" ("id", "skill_id", "revision", "artifact_id", "artifact_revision_id", "artifact_content_address", "manifest", "requirements", "trust_class", "authored_by") VALUES ('work-draft','work-skill',1,'work-artifact','work-artifact-revision','sha256:'||repeat('a',64),'{}','{}','sandboxed_python','user-1');

INSERT INTO "skill_workloads" ("id", "silo_id", "kind", "skill_revision_id") VALUES ('authoring-work','work-silo','authoring','work-draft');
SELECT pg_temp.expect_failure('one authoring workload per revision', $statement$INSERT INTO "skill_workloads" ("id", "silo_id", "kind", "skill_revision_id") VALUES ('authoring-work-duplicate','work-silo','authoring','work-draft')$statement$, 'skill_workloads_one_authoring_per_revision_key');
SELECT pg_temp.expect_failure('authoring workload has no invocation anchor', $statement$INSERT INTO "skill_workloads" ("id", "silo_id", "kind", "skill_revision_id", "tool_invocation_id") VALUES ('authoring-bad-anchor','work-silo','authoring','work-draft','missing-invocation')$statement$, 'authoring SkillWorkload');
SELECT pg_temp.expect_failure('runner workload requires invocation anchor', $statement$INSERT INTO "skill_workloads" ("id", "silo_id", "kind", "skill_revision_id") VALUES ('runner-no-anchor','work-silo','tool_runner','work-draft')$statement$, 'tool-runner SkillWorkload');
UPDATE "skill_workloads" SET "claimed_at"=clock_timestamp(), "delivery_count"=1 WHERE "id"='authoring-work';
UPDATE "skill_workloads" SET "state"='assigned', "workload_uid"='job-uid-1' WHERE "id"='authoring-work';
SELECT pg_temp.expect_failure('release requires a durable release claim', $statement$UPDATE "skill_workloads" SET "released_at"=clock_timestamp() WHERE "id"='authoring-work'$statement$, 'matching claim, assignment, release, registration');
SELECT pg_temp.expect_failure('release cannot fabricate its claim in one transition', $statement$UPDATE "skill_workloads" SET "release_claimed_at"=clock_timestamp(), "release_delivery_count"=1, "released_at"=clock_timestamp() WHERE "id"='authoring-work'$statement$, 'exact prior release claim');
SELECT pg_temp.expect_failure('bootstrap must begin unconsumed', $statement$INSERT INTO "skill_workload_bootstraps" ("id", "skill_workload_id", "reference_hash", "audience", "service_account_name", "namespace", "workload_uid", "expires_at", "consumed_at", "consumed_by_pod_uid") VALUES ('bootstrap-preconsumed','authoring-work','sha256:'||repeat('a',64),'opencrane-skill-authoring','skill-authoring-default','opencrane-skill-authoring','job-uid-1',clock_timestamp()+interval '5 minutes',clock_timestamp(),'pod-uid-1')$statement$, 'begin unconsumed');
INSERT INTO "skill_workload_bootstraps" ("id", "skill_workload_id", "reference_hash", "audience", "service_account_name", "namespace", "workload_uid", "expires_at") VALUES ('bootstrap-1','authoring-work','sha256:'||repeat('b',64),'opencrane-skill-authoring','skill-authoring-default','opencrane-skill-authoring','job-uid-1',clock_timestamp()+interval '5 minutes');
SELECT pg_temp.expect_failure('bootstrap identity follows workload class', $statement$INSERT INTO "skill_workload_bootstraps" ("id", "skill_workload_id", "reference_hash", "audience", "service_account_name", "namespace", "workload_uid", "expires_at") VALUES ('bootstrap-wrong-class','authoring-work','sha256:'||repeat('c',64),'opencrane-tool-runner','tool-runner-default','opencrane-tools','job-uid-1',clock_timestamp()+interval '5 minutes')$statement$, 'SkillWorkloadBootstrap identity');
SELECT pg_temp.expect_failure('bootstrap requires assigned workload UID', $statement$INSERT INTO "skill_workload_bootstraps" ("id", "skill_workload_id", "reference_hash", "audience", "service_account_name", "namespace", "workload_uid", "expires_at") VALUES ('bootstrap-wrong-uid','authoring-work','sha256:'||repeat('d',64),'opencrane-skill-authoring','skill-authoring-default','opencrane-skill-authoring','other-job',clock_timestamp()+interval '5 minutes')$statement$, 'exact assigned workload UID');
SELECT pg_temp.expect_failure('bootstrap consumption must precede expiry', $statement$UPDATE "skill_workload_bootstraps" SET "consumed_at"="expires_at", "consumed_by_pod_uid"='pod-uid-1' WHERE "id"='bootstrap-1'$statement$, 'before expiry');
SELECT pg_temp.expect_failure('bootstrap consumption requires released registered Pod', $statement$UPDATE "skill_workload_bootstraps" SET "consumed_at"=clock_timestamp(), "consumed_by_pod_uid"='pod-uid-1' WHERE "id"='bootstrap-1'$statement$, 'released registered Pod');
UPDATE "skill_workloads" SET "release_claimed_at"=clock_timestamp(), "release_delivery_count"=1 WHERE "id"='authoring-work';
UPDATE "skill_workloads" SET "released_at"=clock_timestamp() WHERE "id"='authoring-work';
UPDATE "skill_workloads" SET "registered_pod_uid"='pod-uid-1' WHERE "id"='authoring-work';
SELECT pg_temp.expect_failure('bootstrap consumption requires exact registered Pod', $statement$UPDATE "skill_workload_bootstraps" SET "consumed_at"=clock_timestamp(), "consumed_by_pod_uid"='other-pod' WHERE "id"='bootstrap-1'$statement$, 'released registered Pod');
UPDATE "skill_workload_bootstraps" SET "consumed_at"=clock_timestamp(), "consumed_by_pod_uid"='pod-uid-1' WHERE "id"='bootstrap-1';
SELECT pg_temp.expect_failure('consumed bootstrap is terminal', $statement$UPDATE "skill_workload_bootstraps" SET "consumed_by_pod_uid"='other-pod' WHERE "id"='bootstrap-1'$statement$, 'consumed SkillWorkloadBootstrap is terminal');
SELECT pg_temp.expect_failure('completion needs passed evidence', $statement$UPDATE "skill_workloads" SET "state"='succeeded', "completed_at"=clock_timestamp() WHERE "id"='authoring-work'$statement$, 'passed draft test and scan reports');
UPDATE "skill_revisions" SET "test_report"='{"passed":true,"summary":"checks passed","checksRun":1,"output":"must not persist"}', "scan_result"='{"passed":true,"summary":"scan passed","checksRun":1,"output":"must not persist"}' WHERE "id"='work-draft';
SELECT pg_temp.expect_failure('completion rejects extended reports', $statement$UPDATE "skill_workloads" SET "state"='succeeded', "completed_at"=clock_timestamp() WHERE "id"='authoring-work'$statement$, 'bounded passed draft test and scan reports');
UPDATE "skill_revisions" SET "test_report"='{"passed":true,"summary":"checks passed","checksRun":1}', "scan_result"='{"passed":true,"summary":"scan passed","checksRun":1}' WHERE "id"='work-draft';
SELECT pg_temp.expect_failure('completion cannot rewrite registered pod', $statement$UPDATE "skill_workloads" SET "state"='succeeded', "completed_at"=clock_timestamp(), "registered_pod_uid"='attacker-pod' WHERE "id"='authoring-work'$statement$, 'registered Pod identity is immutable');
UPDATE "skill_workloads" SET "state"='succeeded', "completed_at"=clock_timestamp() WHERE "id"='authoring-work';
SELECT pg_temp.expect_failure('completed workload is terminal', $statement$UPDATE "skill_workloads" SET "state"='failed', "failure_code"='late_failure' WHERE "id"='authoring-work'$statement$, 'terminal SkillWorkload is immutable');
SELECT pg_temp.expect_failure('workload source is immutable', $statement$UPDATE "skill_workloads" SET "silo_id"='other-silo' WHERE "id"='authoring-work'$statement$, 'source coordinates are immutable');
INSERT INTO "skill_revisions" ("id", "skill_id", "revision", "artifact_id", "artifact_revision_id", "artifact_content_address", "manifest", "requirements", "trust_class", "authored_by") VALUES ('work-draft-2','work-skill',2,'work-artifact','work-artifact-revision','sha256:'||repeat('a',64),'{}','{}','sandboxed_python','user-1');
INSERT INTO "skill_workloads" ("id", "silo_id", "kind", "skill_revision_id") VALUES ('cancelled-work','work-silo','authoring','work-draft-2');
UPDATE "skill_workloads" SET "state"='cancelled', "cancelled_at"=clock_timestamp() WHERE "id"='cancelled-work';
SELECT pg_temp.expect_failure('cancelled workload is terminal', $statement$UPDATE "skill_workloads" SET "state"='pending', "cancelled_at"=NULL WHERE "id"='cancelled-work'$statement$, 'terminal SkillWorkload is immutable');
SELECT pg_temp.expect_failure('workload evidence cannot be deleted', $statement$DELETE FROM "skill_workloads" WHERE "id"='authoring-work'$statement$, 'SkillWorkload rows cannot be deleted');

UPDATE "skill_revisions" SET "state"='review' WHERE "id"='work-draft';
UPDATE "skill_revisions" SET "state"='published', "reviewed_by"='reviewer', "test_report"='{"passed":true}', "scan_result"='{"passed":true}', "signature"='signature', "signer_key_id"='key', "published_at"=clock_timestamp() WHERE "id"='work-draft';
SELECT pg_temp.expect_failure('authoring requires draft revision', $statement$INSERT INTO "skill_workloads" ("id", "silo_id", "kind", "skill_revision_id") VALUES ('authoring-published','work-silo','authoring','work-draft')$statement$, 'authoring SkillWorkload requires Draft');
UPDATE "skill_revisions" SET "state"='revoked', "revoked_at"=clock_timestamp() WHERE "id"='work-draft';
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM "skill_workloads" WHERE "id"='authoring-work') THEN RAISE EXCEPTION 'FAIL: revocation must not invalidate existing workload'; END IF; END; $$;

ROLLBACK;
