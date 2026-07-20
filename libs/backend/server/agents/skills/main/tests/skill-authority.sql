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

INSERT INTO "artifacts" ("id", "silo_id", "owner_principal_id", "kind", "updated_at") VALUES ('skill-artifact','silo-skill','user-1','skill',clock_timestamp());
INSERT INTO "artifact_revisions" ("id", "artifact_id", "revision", "content_address", "byte_length", "media_type", "provenance", "created_by") VALUES ('skill-artifact-revision','skill-artifact',1,'sha256:'||repeat('c',64),100,'application/gzip','{"source":"skill-authoring"}','user-1');
UPDATE "artifacts" SET "current_revision_id"='skill-artifact-revision' WHERE "id"='skill-artifact';
INSERT INTO "skills" ("id", "silo_id", "owner_principal_id", "name", "updated_at") VALUES ('skill-1','silo-skill','user-1','document-helper',clock_timestamp());
INSERT INTO "skill_revisions" ("id", "skill_id", "revision", "artifact_id", "artifact_revision_id", "artifact_content_address", "manifest", "requirements", "trust_class", "authored_by") VALUES ('skill-revision-1','skill-1',1,'skill-artifact','skill-artifact-revision','sha256:'||repeat('c',64),'{}','{}','sandboxed_python','user-1');
UPDATE "skill_revisions" SET "state"='review' WHERE "id"='skill-revision-1';
SELECT pg_temp.expect_failure('failed scan cannot publish', $statement$UPDATE "skill_revisions" SET "state"='published', "reviewed_by"='reviewer-1', "test_report"='{"passed":true}', "scan_result"='{"passed":false}', "signature"='signature', "signer_key_id"='key-1', "published_at"=clock_timestamp() WHERE "id"='skill-revision-1'$statement$, 'skill_revisions_review_check');
UPDATE "skill_revisions" SET "state"='published', "reviewed_by"='reviewer-1', "test_report"='{"passed":true}', "scan_result"='{"passed":true}', "signature"='signature', "signer_key_id"='key-1', "published_at"=clock_timestamp() WHERE "id"='skill-revision-1';
UPDATE "skills" SET "current_revision_id"='skill-revision-1' WHERE "id"='skill-1';
SELECT pg_temp.expect_failure('published skill content is immutable', $statement$UPDATE "skill_revisions" SET "manifest"='{"changed":true}' WHERE "id"='skill-revision-1'$statement$, 'content is immutable');
SELECT pg_temp.expect_failure('published skill signature evidence is immutable', $statement$UPDATE "skill_revisions" SET "signature"='replacement-signature' WHERE "id"='skill-revision-1'$statement$, 'review and signature evidence is immutable');
INSERT INTO "artifact_revisions" ("id", "artifact_id", "revision", "content_address", "byte_length", "media_type", "provenance", "created_by") VALUES ('skill-artifact-revision-2','skill-artifact',2,'sha256:'||repeat('d',64),101,'application/gzip','{"source":"skill-authoring"}','user-1');
UPDATE "artifacts" SET "current_revision_id"='skill-artifact-revision-2' WHERE "id"='skill-artifact';
SELECT pg_temp.expect_failure('published skill keeps pinned artifact bytes', $statement$UPDATE "artifact_revisions" SET "state"='deletion_pending', "deletion_requested_at"=clock_timestamp() WHERE "id"='skill-artifact-revision'$statement$, 'keeps its ArtifactRevision Published');

INSERT INTO "artifacts" ("id", "silo_id", "owner_principal_id", "kind", "updated_at") VALUES ('foreign-skill-artifact','other-silo','user-2','skill',clock_timestamp());
INSERT INTO "artifact_revisions" ("id", "artifact_id", "revision", "content_address", "byte_length", "media_type", "provenance", "created_by") VALUES ('foreign-skill-artifact-revision','foreign-skill-artifact',1,'sha256:'||repeat('e',64),100,'application/gzip','{"source":"skill-authoring"}','user-2');
SELECT pg_temp.expect_failure('skill artifact cannot cross silos', $statement$INSERT INTO "skill_revisions" ("id", "skill_id", "revision", "artifact_id", "artifact_revision_id", "artifact_content_address", "manifest", "requirements", "trust_class", "authored_by") VALUES ('foreign-skill-revision','skill-1',2,'foreign-skill-artifact','foreign-skill-artifact-revision','sha256:'||repeat('e',64),'{}','{}','sandboxed_python','user-1')$statement$, 'inside the Skill silo');

ROLLBACK;
