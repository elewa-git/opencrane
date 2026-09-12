BEGIN;

SELECT pg_temp.seed_external_user('memory-silo-1', 'memory-principal-1');
SELECT pg_temp.seed_external_user('memory-silo-2', 'memory-principal-2');

SELECT pg_temp.expect_failure(
  'active personal dataset requires a provider UUID',
  $statement$
    INSERT INTO "memory_datasets" (
      "id", "silo_id", "boundary_kind", "boundary_principal_id", "cognee_dataset_id", "state", "created_by"
    ) VALUES ('dataset-invalid-active', 'memory-silo-1', 'personal', 'memory-principal-1', NULL, 'active', 'memory-principal-1')
  $statement$,
  'memory_datasets_retirement_check'
);

INSERT INTO "memory_datasets" (
  "id", "silo_id", "boundary_kind", "boundary_principal_id", "cognee_dataset_id", "state", "created_by"
) VALUES (
  'dataset-provisioning', 'memory-silo-1', 'personal', 'memory-principal-1', NULL, 'provisioning', 'memory-principal-1'
);

SELECT pg_temp.expect_failure(
  'personal dataset rejects a different creator',
  $statement$
    INSERT INTO "memory_datasets" (
      "id", "silo_id", "boundary_kind", "boundary_principal_id", "cognee_dataset_id", "state", "created_by"
    ) VALUES ('dataset-cross-actor', 'memory-silo-1', 'personal', 'memory-principal-1', NULL, 'provisioning', 'memory-principal-2')
  $statement$,
  'MemoryDataset must bind its creating personal principal'
);

INSERT INTO "personal_memory_operations" (
  "id", "silo_id", "dataset_id", "actor_principal_id", "idempotency_key_digest", "command_digest",
  "kind", "phase", "revision", "source_conversation_id", "source_message_id", "source_message_position",
  "source_payload_ref", "source_ciphertext_digest", "source_author_principal_id", "content_digest",
  "workflow_task_id", "workflow_task_name", "workflow_task_key"
) VALUES (
  '10000000-0000-4000-8000-000000000001', 'memory-silo-1', 'dataset-provisioning', 'memory-principal-1',
  'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64), 'remember', 'dataset_ensure_pending', 1,
  'conversation-1', 'message-1', 1, 'payload-1', 'sha256:' || repeat('3', 64), 'memory-principal-1',
  'sha256:' || repeat('4', 64), '20000000-0000-4000-8000-000000000001', 'personal-memory-operation', 'remember-1'
);

SELECT pg_temp.expect_failure(
  'operation rejects a cross-principal actor',
  $statement$
    INSERT INTO "personal_memory_operations" (
      "id", "silo_id", "dataset_id", "actor_principal_id", "idempotency_key_digest", "command_digest",
      "kind", "phase", "source_conversation_id", "source_message_id", "source_message_position", "source_payload_ref",
      "source_ciphertext_digest", "source_author_principal_id", "content_digest", "workflow_task_id", "workflow_task_name", "workflow_task_key"
    ) VALUES (
      '10000000-0000-4000-8000-000000000002', 'memory-silo-1', 'dataset-provisioning', 'memory-principal-2',
      'sha256:' || repeat('5', 64), 'sha256:' || repeat('6', 64), 'remember', 'dataset_ensure_pending',
      'conversation-2', 'message-2', 2, 'payload-2', 'sha256:' || repeat('7', 64), 'memory-principal-2',
      'sha256:' || repeat('8', 64), '20000000-0000-4000-8000-000000000002', 'personal-memory-operation', 'remember-2'
    )
  $statement$,
  'PersonalMemoryOperation requires its actor-owned personal dataset'
);

SELECT pg_temp.expect_failure(
  'operation rejects a skipped initial phase',
  $statement$
    INSERT INTO "personal_memory_operations" (
      "id", "silo_id", "dataset_id", "actor_principal_id", "idempotency_key_digest", "command_digest",
      "kind", "phase", "source_conversation_id", "source_message_id", "source_message_position", "source_payload_ref",
      "source_ciphertext_digest", "source_author_principal_id", "content_digest", "workflow_task_id", "workflow_task_name", "workflow_task_key"
    ) VALUES (
      '10000000-0000-4000-8000-000000000003', 'memory-silo-1', 'dataset-provisioning', 'memory-principal-1',
      'sha256:' || repeat('9', 64), 'sha256:' || repeat('a', 64), 'remember', 'document_add_pending',
      'conversation-3', 'message-3', 3, 'payload-3', 'sha256:' || repeat('b', 64), 'memory-principal-1',
      'sha256:' || repeat('c', 64), '20000000-0000-4000-8000-000000000003', 'personal-memory-operation', 'remember-3'
    )
  $statement$,
  'PersonalMemoryOperation must begin at revision 1 in its exact initial phase'
);

UPDATE "memory_datasets"
SET "state" = 'active', "cognee_dataset_id" = '30000000-0000-4000-8000-000000000001'
WHERE "id" = 'dataset-provisioning';
UPDATE "personal_memory_operations"
SET "phase" = 'document_add_pending', "provider_dataset_id" = '30000000-0000-4000-8000-000000000001', "revision" = 2
WHERE "id" = '10000000-0000-4000-8000-000000000001';

SELECT pg_temp.assert_true(
  'dataset adoption and DatasetEnsured bind the same provider UUID',
  (SELECT "state" = 'active' AND "cognee_dataset_id" = '30000000-0000-4000-8000-000000000001' FROM "memory_datasets" WHERE "id" = 'dataset-provisioning')
  AND (SELECT "phase" = 'document_add_pending' AND "provider_dataset_id" = '30000000-0000-4000-8000-000000000001' AND "revision" = 2 FROM "personal_memory_operations" WHERE "id" = '10000000-0000-4000-8000-000000000001')
);

INSERT INTO "memory_datasets" (
  "id", "silo_id", "boundary_kind", "boundary_principal_id", "cognee_dataset_id", "state", "created_by"
) VALUES (
  'dataset-other-silo', 'memory-silo-2', 'personal', 'memory-principal-2',
  '30000000-0000-4000-8000-000000000002', 'active', 'memory-principal-2'
);
INSERT INTO "memory_fact_catalog" (
  "id", "dataset_id", "cognee_external_id", "content_digest", "consent_state", "sensitivity", "provenance",
  "source_message_id", "recorded_by"
) VALUES (
  'fact-other-silo', 'dataset-other-silo', '40000000-0000-4000-8000-000000000099', 'sha256:' || repeat('9', 64),
  'explicit', 'personal', '{"source":"human-message"}', 'message-other-silo', 'memory-principal-2'
);
SELECT pg_temp.expect_failure(
  'operation cannot target a fact from another dataset and silo',
  $statement$
    INSERT INTO "personal_memory_operations" (
      "id", "silo_id", "dataset_id", "actor_principal_id", "idempotency_key_digest", "command_digest", "kind", "phase",
      "source_conversation_id", "source_message_id", "source_message_position", "source_payload_ref", "source_ciphertext_digest",
      "source_author_principal_id", "content_digest", "target_fact_id", "target_document_id", "expected_fact_revision",
      "admitted_provider_dataset_id", "provider_dataset_id", "workflow_task_id", "workflow_task_name", "workflow_task_key"
    ) VALUES (
      '10000000-0000-4000-8000-000000000099', 'memory-silo-1', 'dataset-provisioning', 'memory-principal-1',
      'sha256:' || repeat('8', 64), 'sha256:' || repeat('7', 64), 'correct', 'document_add_pending',
      'conversation-99', 'message-99', 99, 'payload-99', 'sha256:' || repeat('6', 64), 'memory-principal-1',
      'sha256:' || repeat('5', 64), 'fact-other-silo', '40000000-0000-4000-8000-000000000099', 1,
      '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000099', 'personal-memory-operation', 'correct-99'
    )
  $statement$,
  'existing-fact admission requires its exact current target and provider dataset'
);

SELECT pg_temp.expect_failure(
  'operation rejects a skipped phase',
  $statement$
    UPDATE "personal_memory_operations" SET "phase" = 'catalog_commit_pending', "revision" = 3
    WHERE "id" = '10000000-0000-4000-8000-000000000001'
  $statement$,
  'invalid PersonalMemoryOperation phase progression'
);

SELECT pg_temp.expect_failure(
  'operation rejects changed source evidence',
  $statement$
    UPDATE "personal_memory_operations" SET "source_message_id" = 'message-other', "revision" = 3
    WHERE "id" = '10000000-0000-4000-8000-000000000001'
  $statement$,
  'PersonalMemoryOperation admission, source, target, and task evidence are immutable'
);

SELECT pg_temp.expect_failure(
  'operation rejects malformed recovery evidence',
  $statement$
    UPDATE "personal_memory_operations"
    SET "phase" = 'recovery_required', "recovery_phase" = 'document_add_pending', "failure_code" = 'document_conflict',
        "delivery_state" = 'proven_not_sent', "recovery_recorded_at" = clock_timestamp(), "revision" = 3
    WHERE "id" = '10000000-0000-4000-8000-000000000001'
  $statement$,
  'PersonalMemoryOperation failure evidence does not match recovery phase'
);

UPDATE "personal_memory_operations"
SET "phase" = 'cognify_pending', "provider_document_id" = '40000000-0000-4000-8000-000000000001', "revision" = 3
WHERE "id" = '10000000-0000-4000-8000-000000000001';
UPDATE "personal_memory_operations"
SET "indexing_operation_id" = '50000000-0000-4000-8000-000000000001',
    "expected_input_evidence_digest" = 'sha256:' || repeat('d', 64), "revision" = 4
WHERE "id" = '10000000-0000-4000-8000-000000000001';
UPDATE "personal_memory_operations"
SET "phase" = 'catalog_commit_pending', "pipeline_run_id" = '60000000-0000-4000-8000-000000000001', "revision" = 5
WHERE "id" = '10000000-0000-4000-8000-000000000001';

SELECT pg_temp.expect_failure(
  'empty catalog event cannot complete Remember',
  $statement$
    UPDATE "personal_memory_operations" SET "phase" = 'completed', "completed_at" = clock_timestamp(), "revision" = 6
    WHERE "id" = '10000000-0000-4000-8000-000000000001'
  $statement$,
  'CatalogCommitted requires its exact same-transaction fact evidence'
);

INSERT INTO "memory_fact_catalog" (
  "id", "dataset_id", "cognee_external_id", "content_digest", "consent_state", "sensitivity", "provenance",
  "source_message_id", "recorded_by"
) VALUES (
  'fact-remembered', 'dataset-provisioning', '40000000-0000-4000-8000-000000000001', 'sha256:' || repeat('4', 64),
  'explicit', 'personal', '{"source":"human-message"}', 'message-1', 'memory-principal-1'
);
UPDATE "personal_memory_operations"
SET "phase" = 'completed', "completed_at" = clock_timestamp(), "revision" = 6
WHERE "id" = '10000000-0000-4000-8000-000000000001';

SELECT pg_temp.expect_failure(
  'completed operation cannot reopen',
  $statement$
    UPDATE "personal_memory_operations" SET "phase" = 'catalog_commit_pending', "completed_at" = NULL, "revision" = 7
    WHERE "id" = '10000000-0000-4000-8000-000000000001'
  $statement$,
  'completed PersonalMemoryOperation is closed'
);
SELECT pg_temp.expect_failure(
  'operations cannot be deleted',
  $statement$ DELETE FROM "personal_memory_operations" WHERE "id" = '10000000-0000-4000-8000-000000000001' $statement$,
  'PersonalMemoryOperation rows cannot be deleted'
);

INSERT INTO "memory_fact_catalog" (
  "id", "dataset_id", "cognee_external_id", "content_digest", "consent_state", "sensitivity", "provenance",
  "source_message_id", "recorded_by"
) VALUES (
  'fact-forget', 'dataset-provisioning', '40000000-0000-4000-8000-000000000002', 'sha256:' || repeat('e', 64),
  'explicit', 'personal', '{"source":"human-message"}', 'message-forget', 'memory-principal-1'
);

UPDATE "memory_fact_catalog"
SET "state" = 'forget_pending', "forget_requested_at" = clock_timestamp()
WHERE "id" = 'fact-forget';
INSERT INTO "personal_memory_operations" (
  "id", "silo_id", "dataset_id", "actor_principal_id", "idempotency_key_digest", "command_digest", "kind", "phase",
  "target_fact_id", "target_document_id", "expected_fact_revision", "admitted_provider_dataset_id", "provider_dataset_id",
  "workflow_task_id", "workflow_task_name", "workflow_task_key"
) VALUES (
  '10000000-0000-4000-8000-000000000004', 'memory-silo-1', 'dataset-provisioning', 'memory-principal-1',
  'sha256:' || repeat('f', 64), 'sha256:' || repeat('0', 64), 'forget', 'document_delete_pending',
  'fact-forget', '40000000-0000-4000-8000-000000000002', 1,
  '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000004', 'personal-memory-operation', 'forget-1'
);

SELECT pg_temp.assert_true(
  'Forget admission observes the same-transaction hidden fact revision',
  (SELECT "state" = 'forget_pending' AND "revision" = 2 FROM "memory_fact_catalog" WHERE "id" = 'fact-forget')
);
UPDATE "personal_memory_operations" SET "phase" = 'catalog_finalize_pending', "revision" = 2
WHERE "id" = '10000000-0000-4000-8000-000000000004';
SELECT pg_temp.expect_failure(
  'empty catalog event cannot complete Forget',
  $statement$
    UPDATE "personal_memory_operations" SET "phase" = 'completed', "completed_at" = clock_timestamp(), "revision" = 3
    WHERE "id" = '10000000-0000-4000-8000-000000000004'
  $statement$,
  'CatalogFinalized requires its exact same-transaction Forgotten fact'
);
UPDATE "memory_fact_catalog" SET "state" = 'forgotten', "forgotten_at" = clock_timestamp() WHERE "id" = 'fact-forget';
UPDATE "personal_memory_operations" SET "phase" = 'completed', "completed_at" = clock_timestamp(), "revision" = 3
WHERE "id" = '10000000-0000-4000-8000-000000000004';

SELECT pg_temp.assert_true(
  'Forget completion advances the fact revision exactly twice',
  (SELECT "state" = 'forgotten' AND "revision" = 3 FROM "memory_fact_catalog" WHERE "id" = 'fact-forget')
);

INSERT INTO "memory_fact_catalog" (
  "id", "dataset_id", "cognee_external_id", "content_digest", "consent_state", "sensitivity", "provenance",
  "source_message_id", "recorded_by"
) VALUES (
  'fact-correct', 'dataset-provisioning', '40000000-0000-4000-8000-000000000004', 'sha256:' || repeat('b', 64),
  'explicit', 'personal', '{"source":"human-message"}', 'message-old', 'memory-principal-1'
);
INSERT INTO "personal_memory_operations" (
  "id", "silo_id", "dataset_id", "actor_principal_id", "idempotency_key_digest", "command_digest", "kind", "phase",
  "source_conversation_id", "source_message_id", "source_message_position", "source_payload_ref", "source_ciphertext_digest",
  "source_author_principal_id", "content_digest", "target_fact_id", "target_document_id", "expected_fact_revision",
  "admitted_provider_dataset_id", "provider_dataset_id", "workflow_task_id", "workflow_task_name", "workflow_task_key"
) VALUES (
  '10000000-0000-4000-8000-000000000005', 'memory-silo-1', 'dataset-provisioning', 'memory-principal-1',
  'sha256:' || repeat('1', 63) || '2', 'sha256:' || repeat('2', 63) || '3', 'correct', 'document_add_pending',
  'conversation-5', 'message-new', 5, 'payload-5', 'sha256:' || repeat('3', 63) || '4', 'memory-principal-1',
  'sha256:' || repeat('4', 63) || '5', 'fact-correct', '40000000-0000-4000-8000-000000000004', 1,
  '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000005', 'personal-memory-operation', 'correct-1'
);
UPDATE "personal_memory_operations"
SET "phase" = 'cognify_pending', "provider_document_id" = '40000000-0000-4000-8000-000000000005', "revision" = 2
WHERE "id" = '10000000-0000-4000-8000-000000000005';
UPDATE "personal_memory_operations"
SET "indexing_operation_id" = '50000000-0000-4000-8000-000000000005',
    "expected_input_evidence_digest" = 'sha256:' || repeat('5', 64), "revision" = 3
WHERE "id" = '10000000-0000-4000-8000-000000000005';
UPDATE "personal_memory_operations"
SET "phase" = 'catalog_commit_pending', "pipeline_run_id" = '60000000-0000-4000-8000-000000000005', "revision" = 4
WHERE "id" = '10000000-0000-4000-8000-000000000005';
SELECT pg_temp.expect_failure(
  'empty catalog event cannot publish a correction',
  $statement$
    UPDATE "personal_memory_operations" SET "phase" = 'prior_document_delete_pending', "revision" = 5
    WHERE "id" = '10000000-0000-4000-8000-000000000005'
  $statement$,
  'CatalogCommitted requires its exact same-transaction fact evidence'
);
INSERT INTO "memory_fact_catalog" (
  "id", "dataset_id", "cognee_external_id", "content_digest", "consent_state", "sensitivity", "provenance",
  "source_message_id", "supersedes_fact_id", "recorded_by"
) VALUES (
  'fact-corrected-successor', 'dataset-provisioning', '40000000-0000-4000-8000-000000000005',
  'sha256:' || repeat('4', 63) || '5', 'explicit', 'personal', '{"source":"human-message"}',
  'message-new', 'fact-correct', 'memory-principal-1'
);
UPDATE "personal_memory_operations" SET "phase" = 'prior_document_delete_pending', "revision" = 5
WHERE "id" = '10000000-0000-4000-8000-000000000005';
SELECT pg_temp.assert_true(
  'correction atomically publishes the successor and advances the predecessor revision',
  (SELECT "state" = 'corrected' AND "revision" = 2 FROM "memory_fact_catalog" WHERE "id" = 'fact-correct')
  AND (SELECT "state" = 'active' AND "revision" = 1 FROM "memory_fact_catalog" WHERE "id" = 'fact-corrected-successor')
);

INSERT INTO "memory_fact_catalog" (
  "id", "dataset_id", "cognee_external_id", "content_digest", "consent_state", "sensitivity", "provenance",
  "source_message_id", "recorded_by"
) VALUES (
  'fact-revision', 'dataset-provisioning', '40000000-0000-4000-8000-000000000003', 'sha256:' || repeat('a', 64),
  'explicit', 'personal', '{"source":"human-message"}', 'message-revision', 'memory-principal-1'
);
UPDATE "memory_fact_catalog" SET "state" = "state" WHERE "id" = 'fact-revision';
SELECT pg_temp.assert_true(
  'exact no-op keeps the fact revision',
  (SELECT "revision" = 1 FROM "memory_fact_catalog" WHERE "id" = 'fact-revision')
);
SELECT pg_temp.expect_failure(
  'caller cannot bump a fact revision',
  $statement$ UPDATE "memory_fact_catalog" SET "revision" = 2 WHERE "id" = 'fact-revision' $statement$,
  'MemoryFact revision is database-owned'
);
SELECT pg_temp.expect_failure(
  'caller cannot combine a lifecycle change with its own next revision',
  $statement$
    UPDATE "memory_fact_catalog" SET "state" = 'forget_pending', "forget_requested_at" = clock_timestamp(), "revision" = 2
    WHERE "id" = 'fact-revision'
  $statement$,
  'MemoryFact revision is database-owned'
);
SELECT pg_temp.assert_true(
  'rejected revision update rolls back',
  (SELECT "state" = 'active' AND "revision" = 1 FROM "memory_fact_catalog" WHERE "id" = 'fact-revision')
);

SELECT pg_temp.expect_failure(
  'dataset cannot retire with an empty provider UUID',
  $statement$
    UPDATE "memory_datasets" SET "state" = 'retired', "cognee_dataset_id" = NULL, "retired_at" = clock_timestamp()
    WHERE "id" = 'dataset-provisioning'
  $statement$,
  'Active MemoryDataset may only retire with immutable provider identity'
);
SELECT pg_temp.expect_failure(
  'dataset cannot be deleted',
  $statement$ DELETE FROM "memory_datasets" WHERE "id" = 'dataset-provisioning' $statement$,
  'MemoryDataset catalog rows cannot be deleted'
);

ROLLBACK;
