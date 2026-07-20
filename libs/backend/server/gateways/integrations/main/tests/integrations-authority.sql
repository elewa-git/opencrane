BEGIN;

CREATE FUNCTION pg_temp.expect_failure(test_name TEXT, statement TEXT, expected_message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE actual_message TEXT;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_message = MESSAGE_TEXT;
    IF strpos(actual_message, expected_message) > 0 THEN RAISE NOTICE 'PASS: %', test_name; RETURN; END IF;
    RAISE EXCEPTION 'FAIL: % returned unexpected error: %', test_name, actual_message;
  END;
  RAISE EXCEPTION 'FAIL: % unexpectedly succeeded', test_name;
END;
$$;

INSERT INTO "agent_services" ("id", "silo_id", "kind", "name", "owner_scope", "owner_subject_id", "workload_profile", "updated_at")
VALUES ('integration-service', 'silo-integrations', 'managed', 'Integration agent', 'organization', 'organization-1', 'managed-agent', clock_timestamp());
INSERT INTO "agent_revisions" ("id", "agent_service_id", "revision", "digest", "prompt_policy_version", "model_policy_id", "budget", "authored_by")
VALUES ('integration-revision', 'integration-service', 1, 'sha256:' || repeat('a', 64), 'prompt-v1', 'model-v1', '{}', 'user-1');
INSERT INTO "integrations" ("id", "silo_id", "obot_catalog_entry_id", "display_name", "updated_at")
VALUES ('integration-1', 'silo-integrations', 'obot-catalog-1', 'Calendar', clock_timestamp());
INSERT INTO "integration_custody_references" ("id", "integration_id", "silo_id", "obot_custody_reference", "expires_at")
VALUES ('custody-1', 'integration-1', 'silo-integrations', 'obot:opaque:one', clock_timestamp() + interval '1 hour');
INSERT INTO "agent_revision_integration_assignments" ("agent_revision_id", "integration_id", "silo_id", "custody_reference_id", "allowed_tools")
VALUES ('integration-revision', 'integration-1', 'silo-integrations', 'custody-1', ARRAY['calendar.read']);

SELECT pg_temp.expect_failure('duplicate integration assignment', $statement$
  INSERT INTO "agent_revision_integration_assignments" ("agent_revision_id", "integration_id", "silo_id", "custody_reference_id", "allowed_tools")
  VALUES ('integration-revision', 'integration-1', 'silo-integrations', 'custody-1', ARRAY['calendar.write'])$statement$, 'agent_revision_integration_assignments_pkey');
INSERT INTO "agent_revisions" ("id", "agent_service_id", "revision", "digest", "prompt_policy_version", "model_policy_id", "budget", "authored_by")
VALUES ('integration-revision-tools', 'integration-service', 2, 'sha256:' || repeat('b', 64), 'prompt-v1', 'model-v1', '{}', 'user-1');
INSERT INTO "integrations" ("id", "silo_id", "obot_catalog_entry_id", "display_name", "updated_at")
VALUES ('integration-tools', 'silo-integrations', 'obot-catalog-tools', 'Tasks', clock_timestamp());
INSERT INTO "integration_custody_references" ("id", "integration_id", "silo_id", "obot_custody_reference", "expires_at")
VALUES ('custody-tools', 'integration-tools', 'silo-integrations', 'obot:opaque:tools', clock_timestamp() + interval '1 hour');
SELECT pg_temp.expect_failure('empty duplicate and null tools are rejected', $statement$
  INSERT INTO "agent_revision_integration_assignments" ("agent_revision_id", "integration_id", "silo_id", "custody_reference_id", "allowed_tools")
  VALUES ('integration-revision-tools', 'integration-tools', 'silo-integrations', 'custody-tools', ARRAY['', '', NULL])$statement$, 'allowed_tools_check');

INSERT INTO "integrations" ("id", "silo_id", "obot_catalog_entry_id", "display_name", "updated_at")
VALUES ('foreign-integration', 'other-silo', 'obot-catalog-foreign', 'Foreign calendar', clock_timestamp());
INSERT INTO "integration_custody_references" ("id", "integration_id", "silo_id", "obot_custody_reference", "expires_at")
VALUES ('foreign-custody', 'foreign-integration', 'other-silo', 'obot:opaque:foreign', clock_timestamp() + interval '1 hour');
SELECT pg_temp.expect_failure('cross silo integration assignment', $statement$
  INSERT INTO "agent_revision_integration_assignments" ("agent_revision_id", "integration_id", "silo_id", "custody_reference_id", "allowed_tools")
  VALUES ('integration-revision', 'foreign-integration', 'other-silo', 'foreign-custody', ARRAY['calendar.read'])$statement$, 'same silo');

UPDATE "agent_revisions" SET "state" = 'published', "published_at" = clock_timestamp() WHERE "id" = 'integration-revision';
SELECT pg_temp.expect_failure('published integration assignment is immutable', $statement$
  UPDATE "agent_revision_integration_assignments" SET "allowed_tools" = ARRAY['calendar.write']
  WHERE "agent_revision_id" = 'integration-revision' AND "integration_id" = 'integration-1'$statement$, 'AgentRevision assignments are immutable');

INSERT INTO "agent_revisions" ("id", "agent_service_id", "revision", "digest", "prompt_policy_version", "model_policy_id", "budget", "authored_by")
VALUES ('integration-revision-2', 'integration-service', 3, 'sha256:' || repeat('c', 64), 'prompt-v1', 'model-v1', '{}', 'user-1');
UPDATE "integration_custody_references" SET "state" = 'revoked', "revoked_at" = clock_timestamp() WHERE "id" = 'custody-1';
SELECT pg_temp.expect_failure('revoked custody reference cannot be assigned', $statement$
  INSERT INTO "agent_revision_integration_assignments" ("agent_revision_id", "integration_id", "silo_id", "custody_reference_id", "allowed_tools")
  VALUES ('integration-revision-2', 'integration-1', 'silo-integrations', 'custody-1', ARRAY['calendar.read'])$statement$, 'ready unexpired');

INSERT INTO "integration_custody_references" ("id", "integration_id", "silo_id", "obot_custody_reference", "state", "expires_at")
VALUES ('expired-custody', 'integration-1', 'silo-integrations', 'obot:opaque:expired', 'expired', clock_timestamp() - interval '1 hour');
SELECT pg_temp.expect_failure('expired custody reference cannot be assigned', $statement$
  INSERT INTO "agent_revision_integration_assignments" ("agent_revision_id", "integration_id", "silo_id", "custody_reference_id", "allowed_tools")
  VALUES ('integration-revision-2', 'integration-1', 'silo-integrations', 'expired-custody', ARRAY['calendar.read'])$statement$, 'ready unexpired');
SELECT pg_temp.expect_failure('custody reference cannot be refilled', $statement$
  UPDATE "integration_custody_references" SET "obot_custody_reference" = 'replacement'
  WHERE "id" = 'custody-1'$statement$, 'custody identity is immutable');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name IN ('integrations', 'integration_custody_references', 'agent_revision_integration_assignments')
      AND column_name ~ '(secret|token|password|credential|oauth)'
  ) THEN
    RAISE EXCEPTION 'integration authority must not persist raw-secret columns';
  END IF;
END;
$$;

ROLLBACK;
