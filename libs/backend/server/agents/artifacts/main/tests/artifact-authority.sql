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

INSERT INTO "artifacts" ("id", "silo_id", "owner_principal_id", "kind", "updated_at") VALUES ('artifact-1','silo-artifact','user-1','upload',clock_timestamp());
INSERT INTO "artifact_upload_leases" ("id", "artifact_id", "silo_id", "capability_jti", "media_type", "expires_at") VALUES ('lease-1','artifact-1','silo-artifact','capability-lease-1','text/plain',clock_timestamp() + interval '5 minutes');
SELECT pg_temp.expect_failure('artifact upload lease cannot cross its artifact silo', $statement$INSERT INTO "artifact_upload_leases" ("id", "artifact_id", "silo_id", "capability_jti", "media_type", "expires_at") VALUES ('lease-cross-silo','artifact-1','other-silo','capability-lease-cross-silo','text/plain',clock_timestamp() + interval '5 minutes')$statement$, 'must stay inside its Artifact silo');
SELECT pg_temp.expect_failure('artifact upload lease promotion needs an authenticated receipt', $statement$UPDATE "artifact_upload_leases" SET "state"='promoted' WHERE "id"='lease-1'$statement$, 'artifact_upload_leases_promotion_check');
SELECT pg_temp.expect_failure('artifact upload lease capability is immutable', $statement$UPDATE "artifact_upload_leases" SET "capability_jti"='other-capability' WHERE "id"='lease-1'$statement$, 'authority coordinates are immutable');
UPDATE "artifact_upload_leases" SET "state"='promoted', "promotion_receipt_digest"='sha256:'||repeat('d',64), "promoted_content_address"='sha256:'||repeat('a',64), "promoted_byte_length"=12, "promoted_at"=clock_timestamp() WHERE "id"='lease-1';
SELECT pg_temp.expect_failure('artifact upload lease promotion receipt cannot be rebound', $statement$UPDATE "artifact_upload_leases" SET "promoted_content_address"='sha256:'||repeat('b',64) WHERE "id"='lease-1'$statement$, 'promotion receipt is immutable');
SELECT pg_temp.expect_failure('artifact upload lease cannot be deleted to replay its capability jti', $statement$DELETE FROM "artifact_upload_leases" WHERE "id"='lease-1'$statement$, 'rows cannot be deleted');
INSERT INTO "artifact_revisions" ("id", "artifact_id", "revision", "content_address", "byte_length", "media_type", "provenance", "created_by") VALUES ('artifact-revision-1','artifact-1',1,'sha256:'||repeat('a',64),12,'text/plain','{"source":"upload"}','user-1');
UPDATE "artifacts" SET "current_revision_id"='artifact-revision-1' WHERE "id"='artifact-1';
INSERT INTO "artifact_outbox_events" ("id", "artifact_id", "revision_id", "kind", "idempotency_key", "payload") VALUES ('artifact-event-1','artifact-1','artifact-revision-1','artifact.revision_published','artifact-finalize-1','{}');
SELECT pg_temp.expect_failure('artifact bytes reference is immutable', $statement$UPDATE "artifact_revisions" SET "content_address"='sha256:'||repeat('b',64) WHERE "id"='artifact-revision-1'$statement$, 'content and provenance are immutable');
SELECT pg_temp.expect_failure('current revision cannot enter deletion lifecycle', $statement$UPDATE "artifact_revisions" SET "state"='deletion_pending', "deletion_requested_at"=clock_timestamp() WHERE "id"='artifact-revision-1'$statement$, 'must remain Published');
INSERT INTO "artifacts" ("id", "silo_id", "owner_principal_id", "kind", "updated_at") VALUES ('artifact-foreign','other-silo','user-2','upload',clock_timestamp());
INSERT INTO "artifact_revisions" ("id", "artifact_id", "revision", "content_address", "byte_length", "media_type", "provenance", "created_by") VALUES ('artifact-revision-foreign','artifact-foreign',1,'sha256:'||repeat('c',64),8,'text/plain','{"source":"upload"}','user-2');
SELECT pg_temp.expect_failure('artifact lineage cannot cross silos', $statement$INSERT INTO "artifact_revision_parents" ("child_revision_id", "parent_revision_id") VALUES ('artifact-revision-1','artifact-revision-foreign')$statement$, 'cannot cross silos');

INSERT INTO "artifacts" ("id", "silo_id", "owner_principal_id", "kind", "updated_at") VALUES ('artifact-pdf','silo-artifact','user-1','upload',clock_timestamp());
INSERT INTO "artifact_revisions" ("id", "artifact_id", "revision", "content_address", "byte_length", "media_type", "provenance", "created_by") VALUES ('artifact-pdf-revision','artifact-pdf',1,'sha256:'||repeat('e',64),42,'application/pdf','{"source":"upload"}','user-1');
UPDATE "artifacts" SET "current_revision_id"='artifact-pdf-revision' WHERE "id"='artifact-pdf';
SELECT pg_temp.expect_failure('unsupported preprocessing pipeline is rejected', $statement$INSERT INTO "artifact_preprocess_jobs" ("id", "source_revision_id", "pipeline_version", "updated_at") VALUES ('preprocess-invalid','artifact-pdf-revision','image-ocr/v1',clock_timestamp())$statement$, 'requires the supported PDF pipeline');
INSERT INTO "artifact_preprocess_jobs" ("id", "source_revision_id", "pipeline_version", "updated_at") VALUES ('preprocess-pdf','artifact-pdf-revision','pdf-to-text/v1',clock_timestamp());
SELECT pg_temp.expect_failure('pending preprocessing cannot fabricate a retry failure', $statement$UPDATE "artifact_preprocess_jobs" SET "state"='retryable_failed', "claim_fence"='synthetic-fence', "derived_artifact_id"='artifact-pdf', "failure_code"='synthetic', "next_attempt_at"=clock_timestamp() WHERE "id"='preprocess-pdf'$statement$, 'invalid ArtifactPreprocessJob lifecycle transition');
SELECT pg_temp.expect_failure('pending preprocessing cannot carry a synthetic claim', $statement$UPDATE "artifact_preprocess_jobs" SET "claim_fence"='synthetic-fence' WHERE "id"='preprocess-pdf'$statement$, 'pending state cannot carry claim or output facts');
SELECT pg_temp.expect_failure('preprocessing source revision must remain published', $statement$UPDATE "artifact_revisions" SET "state"='deletion_pending', "deletion_requested_at"=clock_timestamp() WHERE "id"='artifact-pdf-revision'$statement$, 'required by preprocessing');
INSERT INTO "artifacts" ("id", "silo_id", "owner_principal_id", "kind", "updated_at") VALUES ('artifact-pdf-other-owner','silo-artifact','user-2','generated',clock_timestamp());
SELECT pg_temp.expect_failure('preprocessing cannot re-home a source under another owner', $statement$UPDATE "artifact_preprocess_jobs" SET "state"='claimed', "attempt"=1, "claim_fence"='fence-other-owner', "claim_expires_at"=clock_timestamp() + interval '5 minutes', "derived_artifact_id"='artifact-pdf-other-owner' WHERE "id"='preprocess-pdf'$statement$, 'must retain the active source owner and silo');
INSERT INTO "artifacts" ("id", "silo_id", "owner_principal_id", "kind", "updated_at") VALUES ('artifact-pdf-text','silo-artifact','user-1','generated',clock_timestamp());
UPDATE "artifact_preprocess_jobs" SET "state"='claimed', "attempt"=1, "claim_fence"='fence-1', "claim_expires_at"=clock_timestamp() + interval '5 minutes', "derived_artifact_id"='artifact-pdf-text' WHERE "id"='preprocess-pdf';
INSERT INTO "artifact_upload_leases" ("id", "artifact_id", "silo_id", "capability_jti", "expected_content_address", "expected_byte_length", "media_type", "expires_at") VALUES ('preprocess-output-lease','artifact-pdf-text','silo-artifact','capability-preprocess-output','sha256:'||repeat('f',64),12,'text/plain',clock_timestamp() + interval '4 minutes');
UPDATE "artifact_preprocess_jobs" SET "output_lease_id"='preprocess-output-lease' WHERE "id"='preprocess-pdf';
INSERT INTO "artifact_revisions" ("id", "artifact_id", "revision", "content_address", "byte_length", "media_type", "provenance", "created_by") VALUES ('artifact-pdf-text-revision','artifact-pdf-text',1,'sha256:'||repeat('f',64),12,'text/plain','{"source":"pdf-to-text/v1"}','system:artifact-preprocessor');
UPDATE "artifacts" SET "current_revision_id"='artifact-pdf-text-revision' WHERE "id"='artifact-pdf-text';
SELECT pg_temp.expect_failure('preprocess completion requires its finalized output lease', $statement$UPDATE "artifact_preprocess_jobs" SET "state"='completed', "derived_revision_id"='artifact-pdf-text-revision', "completed_at"=clock_timestamp() WHERE "id"='preprocess-pdf'$statement$, 'requires its finalized exact output lease');
UPDATE "artifact_upload_leases" SET "state"='promoted', "promotion_receipt_digest"='sha256:'||repeat('c',64), "promoted_content_address"='sha256:'||repeat('f',64), "promoted_byte_length"=12, "promoted_at"=clock_timestamp() WHERE "id"='preprocess-output-lease';
UPDATE "artifact_upload_leases" SET "state"='finalized', "finalized_at"=clock_timestamp() WHERE "id"='preprocess-output-lease';
SELECT pg_temp.expect_failure('preprocess output lease cannot finalize ahead of its job', $statement$SET CONSTRAINTS "artifact_preprocess_output_lease_finalization" IMMEDIATE$statement$, 'may finalize only with its completed job');
SELECT pg_temp.expect_failure('preprocess completion requires source lineage', $statement$UPDATE "artifact_preprocess_jobs" SET "state"='completed', "derived_revision_id"='artifact-pdf-text-revision', "completed_at"=clock_timestamp() WHERE "id"='preprocess-pdf'$statement$, 'requires immutable source lineage');
INSERT INTO "artifact_revision_parents" ("child_revision_id", "parent_revision_id") VALUES ('artifact-pdf-text-revision','artifact-pdf-revision');
UPDATE "artifact_preprocess_jobs" SET "state"='completed', "derived_revision_id"='artifact-pdf-text-revision', "completed_at"=clock_timestamp() WHERE "id"='preprocess-pdf';
UPDATE "artifacts" SET "current_revision_id"=NULL WHERE "id"='artifact-pdf';
UPDATE "artifact_revisions" SET "state"='deletion_pending', "deletion_requested_at"=clock_timestamp() WHERE "id"='artifact-pdf-revision';
SELECT pg_temp.assert_true(
    'terminal preprocessing evidence does not block source deletion',
    (SELECT "state" = 'deletion_pending' FROM "artifact_revisions" WHERE "id" = 'artifact-pdf-revision')
);

INSERT INTO "artifacts" ("id", "silo_id", "owner_principal_id", "kind", "updated_at") VALUES ('artifact-pdf-stale','silo-artifact','user-1','upload',clock_timestamp()), ('artifact-pdf-stale-text','silo-artifact','user-1','generated',clock_timestamp());
INSERT INTO "artifact_revisions" ("id", "artifact_id", "revision", "content_address", "byte_length", "media_type", "provenance", "created_by") VALUES ('artifact-pdf-stale-revision','artifact-pdf-stale',1,'sha256:'||repeat('9',64),42,'application/pdf','{"source":"upload"}','user-1');
INSERT INTO "artifact_preprocess_jobs" ("id", "source_revision_id", "pipeline_version", "updated_at") VALUES ('preprocess-stale','artifact-pdf-stale-revision','pdf-to-text/v1',clock_timestamp());
UPDATE "artifact_preprocess_jobs" SET "state"='claimed', "attempt"=1, "claim_fence"='expired-fence', "claim_expires_at"=clock_timestamp() + interval '1 millisecond', "derived_artifact_id"='artifact-pdf-stale-text' WHERE "id"='preprocess-stale';
INSERT INTO "artifact_upload_leases" ("id", "artifact_id", "silo_id", "capability_jti", "expected_content_address", "expected_byte_length", "media_type", "expires_at") VALUES ('preprocess-stale-output-lease','artifact-pdf-stale-text','silo-artifact','capability-preprocess-stale','sha256:'||repeat('8',64),12,'text/plain',clock_timestamp() + interval '1 millisecond');
UPDATE "artifact_preprocess_jobs" SET "output_lease_id"='preprocess-stale-output-lease' WHERE "id"='preprocess-stale';
SELECT pg_sleep(0.01);
SELECT pg_temp.expect_failure('expired preprocessing claim cannot report a result', $statement$UPDATE "artifact_preprocess_jobs" SET "state"='terminal_failed', "failure_code"='late_result' WHERE "id"='preprocess-stale'$statement$, 'requires its live claim fence');
UPDATE "artifact_preprocess_jobs" SET "state"='retryable_failed', "failure_code"='claim_expired', "next_attempt_at"=clock_timestamp() WHERE "id"='preprocess-stale';
SELECT pg_temp.expect_failure('failed preprocessing cancels its stale output lease', $statement$UPDATE "artifact_upload_leases" SET "state"='promoted', "promotion_receipt_digest"='sha256:'||repeat('8',64), "promoted_content_address"='sha256:'||repeat('8',64), "promoted_byte_length"=12, "promoted_at"=clock_timestamp() WHERE "id"='preprocess-stale-output-lease'$statement$, 'invalid ArtifactUploadLease lifecycle transition');
SELECT pg_temp.expect_failure('preprocessing reclaim must rotate the fence', $statement$UPDATE "artifact_preprocess_jobs" SET "state"='claimed', "attempt"=2, "claim_expires_at"=clock_timestamp() + interval '5 minutes', "next_attempt_at"=NULL, "failure_code"=NULL WHERE "id"='preprocess-stale'$statement$, 'fresh fenced output attempt');
UPDATE "artifact_preprocess_jobs" SET "state"='claimed', "attempt"=2, "claim_fence"='reclaimed-fence', "claim_expires_at"=clock_timestamp() + interval '5 minutes', "next_attempt_at"=NULL, "failure_code"=NULL WHERE "id"='preprocess-stale';

ROLLBACK;
