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
SELECT pg_temp.expect_failure('workload source is immutable', $statement$UPDATE "skill_workloads" SET "silo_id"='other-silo' WHERE "id"='authoring-work'$statement$, 'source coordinates are immutable');
UPDATE "skill_workloads" SET "state"='cancelled', "cancelled_at"=clock_timestamp() WHERE "id"='authoring-work';
SELECT pg_temp.expect_failure('cancelled workload is terminal', $statement$UPDATE "skill_workloads" SET "state"='pending', "cancelled_at"=NULL WHERE "id"='authoring-work'$statement$, 'cancelled SkillWorkload is terminal');
SELECT pg_temp.expect_failure('workload evidence cannot be deleted', $statement$DELETE FROM "skill_workloads" WHERE "id"='authoring-work'$statement$, 'SkillWorkload rows cannot be deleted');

UPDATE "skill_revisions" SET "state"='review' WHERE "id"='work-draft';
UPDATE "skill_revisions" SET "state"='published', "reviewed_by"='reviewer', "test_report"='{"passed":true}', "scan_result"='{"passed":true}', "signature"='signature', "signer_key_id"='key', "published_at"=clock_timestamp() WHERE "id"='work-draft';
SELECT pg_temp.expect_failure('authoring requires draft revision', $statement$INSERT INTO "skill_workloads" ("id", "silo_id", "kind", "skill_revision_id") VALUES ('authoring-published','work-silo','authoring','work-draft')$statement$, 'authoring SkillWorkload requires Draft');
UPDATE "skill_revisions" SET "state"='revoked', "revoked_at"=clock_timestamp() WHERE "id"='work-draft';
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM "skill_workloads" WHERE "id"='authoring-work') THEN RAISE EXCEPTION 'FAIL: revocation must not invalidate existing workload'; END IF; END; $$;

ROLLBACK;
