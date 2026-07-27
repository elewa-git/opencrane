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

INSERT INTO "artifacts" ("id", "silo_id", "owner_principal_id", "kind", "updated_at") VALUES ('memory-artifact','silo-memory','user-1','document',clock_timestamp());
INSERT INTO "artifact_revisions" ("id", "artifact_id", "revision", "content_address", "byte_length", "media_type", "provenance", "created_by") VALUES ('memory-artifact-revision','memory-artifact',1,'sha256:'||repeat('c',64),12,'text/plain','{"source":"memory-test"}','user-1');
INSERT INTO "memory_datasets" ("id", "silo_id", "scope_kind", "organization_id", "scope_resource_id", "cognee_dataset_id", "created_by") VALUES ('memory-project','silo-memory','project','org-1','project-cross-functional','cognee-project','user-1');
INSERT INTO "memory_fact_catalog" ("id", "dataset_id", "cognee_external_id", "content_digest", "consent_state", "sensitivity", "provenance", "recorded_by") VALUES ('fact-1','memory-project','cognee-fact-1','sha256:'||repeat('d',64),'explicit','ordinary','{"user_statement":true}','user-1');
INSERT INTO "memory_fact_catalog" ("id", "dataset_id", "cognee_external_id", "content_digest", "consent_state", "sensitivity", "provenance", "supersedes_fact_id", "recorded_by") VALUES ('fact-2','memory-project','cognee-fact-2','sha256:'||repeat('e',64),'explicit','ordinary','{"user_statement":true}','fact-1','user-1');
SELECT pg_temp.expect_failure('one fact cannot have two active corrections', $statement$INSERT INTO "memory_fact_catalog" ("id", "dataset_id", "cognee_external_id", "content_digest", "consent_state", "sensitivity", "provenance", "supersedes_fact_id", "recorded_by") VALUES ('fact-3','memory-project','cognee-fact-3','sha256:'||repeat('f',64),'explicit','ordinary','{"user_statement":true}','fact-1','user-1')$statement$, 'must supersede an active fact');
SELECT pg_temp.expect_failure('false user statement is not provenance', $statement$INSERT INTO "memory_fact_catalog" ("id", "dataset_id", "cognee_external_id", "content_digest", "consent_state", "sensitivity", "provenance", "recorded_by") VALUES ('fact-false','memory-project','cognee-false','sha256:'||repeat('a',64),'explicit','ordinary','{"user_statement":false}','user-1')$statement$, 'memory_fact_catalog_valid_check');
SELECT pg_temp.expect_failure('memory fact requires exactly one provenance source', $statement$INSERT INTO "memory_fact_catalog" ("id", "dataset_id", "cognee_external_id", "content_digest", "consent_state", "sensitivity", "provenance", "source_artifact_revision_id", "recorded_by") VALUES ('fact-ambiguous','memory-project','cognee-ambiguous','sha256:'||repeat('b',64),'explicit','ordinary','{"user_statement":true}','memory-artifact-revision','user-1')$statement$, 'memory_fact_catalog_valid_check');
SELECT pg_temp.expect_failure('memory content digest is immutable', $statement$UPDATE "memory_fact_catalog" SET "content_digest"='sha256:'||repeat('f',64) WHERE "id"='fact-2'$statement$, 'content and provenance are immutable');
SELECT pg_temp.expect_failure('corrected fact cannot reactivate', $statement$UPDATE "memory_fact_catalog" SET "state"='active' WHERE "id"='fact-1'$statement$, 'invalid MemoryFact forget lifecycle');
UPDATE "memory_fact_catalog" SET "state"='forget_pending', "forget_requested_at"=clock_timestamp() WHERE "id"='fact-1';
SELECT pg_temp.expect_failure('forget request evidence cannot move after it is recorded', $statement$UPDATE "memory_fact_catalog" SET "forget_requested_at"=clock_timestamp() + interval '1 second' WHERE "id"='fact-1'$statement$, 'forget request evidence is immutable');
UPDATE "memory_fact_catalog" SET "state"='forgotten', "forgotten_at"=clock_timestamp() WHERE "id"='fact-1';
SELECT pg_temp.expect_failure('forget completion evidence cannot move after it is recorded', $statement$UPDATE "memory_fact_catalog" SET "forgotten_at"=clock_timestamp() + interval '1 second' WHERE "id"='fact-1'$statement$, 'forget completion evidence is immutable');
SELECT pg_temp.expect_failure('forgotten fact cannot reactivate', $statement$UPDATE "memory_fact_catalog" SET "state"='active', "forget_requested_at"=NULL, "forgotten_at"=NULL WHERE "id"='fact-1'$statement$, 'invalid MemoryFact forget lifecycle');

ROLLBACK;
