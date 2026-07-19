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

INSERT INTO "artifacts" ("id", "silo_id", "owner_principal_id", "kind", "updated_at") VALUES ('artifact-1','silo-artifact','user-1','upload',clock_timestamp());
INSERT INTO "artifact_upload_leases" ("id", "artifact_id", "silo_id", "capability_jti", "media_type", "expires_at") VALUES ('lease-1','artifact-1','silo-artifact','capability-lease-1','text/plain',clock_timestamp() + interval '5 minutes');
SELECT pg_temp.expect_failure('artifact upload lease cannot cross its artifact silo', $statement$INSERT INTO "artifact_upload_leases" ("id", "artifact_id", "silo_id", "capability_jti", "media_type", "expires_at") VALUES ('lease-cross-silo','artifact-1','other-silo','capability-lease-cross-silo','text/plain',clock_timestamp() + interval '5 minutes')$statement$, 'must stay inside its Artifact silo');
SELECT pg_temp.expect_failure('artifact upload lease promotion needs an authenticated receipt', $statement$UPDATE "artifact_upload_leases" SET "state"='promoted' WHERE "id"='lease-1'$statement$, 'artifact_upload_leases_promotion_check');
SELECT pg_temp.expect_failure('artifact upload lease capability is immutable', $statement$UPDATE "artifact_upload_leases" SET "capability_jti"='other-capability' WHERE "id"='lease-1'$statement$, 'authority coordinates are immutable');
UPDATE "artifact_upload_leases" SET "state"='promoted', "promotion_receipt_digest"='sha256:'||repeat('d',64), "promoted_content_address"='sha256:'||repeat('a',64), "promoted_byte_length"=12, "promoted_at"=clock_timestamp() WHERE "id"='lease-1';
SELECT pg_temp.expect_failure('artifact upload lease promotion receipt cannot be rebound', $statement$UPDATE "artifact_upload_leases" SET "promoted_content_address"='sha256:'||repeat('b',64) WHERE "id"='lease-1'$statement$, 'promotion receipt is immutable');
INSERT INTO "artifact_revisions" ("id", "artifact_id", "revision", "content_address", "byte_length", "media_type", "provenance", "created_by") VALUES ('artifact-revision-1','artifact-1',1,'sha256:'||repeat('a',64),12,'text/plain','{"source":"upload"}','user-1');
UPDATE "artifacts" SET "current_revision_id"='artifact-revision-1' WHERE "id"='artifact-1';
INSERT INTO "artifact_outbox_events" ("id", "artifact_id", "revision_id", "kind", "idempotency_key", "payload") VALUES ('artifact-event-1','artifact-1','artifact-revision-1','artifact.revision_published','artifact-finalize-1','{}');
SELECT pg_temp.expect_failure('artifact bytes reference is immutable', $statement$UPDATE "artifact_revisions" SET "content_address"='sha256:'||repeat('b',64) WHERE "id"='artifact-revision-1'$statement$, 'content and provenance are immutable');
SELECT pg_temp.expect_failure('current revision cannot enter deletion lifecycle', $statement$UPDATE "artifact_revisions" SET "state"='deletion_pending', "deletion_requested_at"=clock_timestamp() WHERE "id"='artifact-revision-1'$statement$, 'must remain Published');
INSERT INTO "artifacts" ("id", "silo_id", "owner_principal_id", "kind", "updated_at") VALUES ('artifact-foreign','other-silo','user-2','upload',clock_timestamp());
INSERT INTO "artifact_revisions" ("id", "artifact_id", "revision", "content_address", "byte_length", "media_type", "provenance", "created_by") VALUES ('artifact-revision-foreign','artifact-foreign',1,'sha256:'||repeat('c',64),8,'text/plain','{"source":"upload"}','user-2');
SELECT pg_temp.expect_failure('artifact lineage cannot cross silos', $statement$INSERT INTO "artifact_revision_parents" ("child_revision_id", "parent_revision_id") VALUES ('artifact-revision-1','artifact-revision-foreign')$statement$, 'cannot cross silos');

ROLLBACK;
