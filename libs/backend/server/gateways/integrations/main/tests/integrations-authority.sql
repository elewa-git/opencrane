BEGIN;

INSERT INTO "model_definitions" ("id", "scope", "public_model_name", "litellm_model_id", "upstream_model", "updated_at")
VALUES ('integrations-model', 'global', 'integrations-model', 'litellm-integrations-model', 'integrations-model', clock_timestamp());

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

INSERT INTO "agent_services" ("id", "silo_id", "kind", "name", "workload_profile", "updated_at")
VALUES ('integration-service', 'silo-integrations', 'managed', 'Integration agent', 'managed-agent', clock_timestamp());
INSERT INTO "agent_revisions" ("id", "agent_service_id", "revision", "digest", "prompt_policy_version", "model_definition_id", "budget", "authored_by")
VALUES ('integration-revision', 'integration-service', 1, 'sha256:' || repeat('a', 64), 'prompt-v1', 'integrations-model', '{}', 'user-1');
INSERT INTO "integrations" ("id", "silo_id", "obot_catalog_entry_id", "display_name", "updated_at")
VALUES ('integration-1', 'silo-integrations', 'obot-catalog-1', 'Calendar', clock_timestamp());
INSERT INTO "integration_custody_references" ("id", "integration_id", "silo_id", "obot_custody_reference", "expires_at")
VALUES ('custody-1', 'integration-1', 'silo-integrations', 'obot:opaque:one', clock_timestamp() + interval '1 hour');
INSERT INTO "agent_revision_integration_assignments" ("agent_revision_id", "integration_id", "silo_id", "custody_reference_id", "tool_definitions")
VALUES ('integration-revision', 'integration-1', 'silo-integrations', 'custody-1', jsonb_build_array(jsonb_build_object('name', 'calendar.read', 'description', 'Read calendar entries', 'parametersSchema', '{"type":"object","additionalProperties":false}'::jsonb, 'parametersSchemaDigest', 'sha256:' || repeat('1', 64))));

SELECT pg_temp.expect_failure('duplicate integration assignment', $statement$
  INSERT INTO "agent_revision_integration_assignments" ("agent_revision_id", "integration_id", "silo_id", "custody_reference_id", "tool_definitions")
  VALUES ('integration-revision', 'integration-1', 'silo-integrations', 'custody-1', jsonb_build_array(jsonb_build_object('name', 'calendar.write', 'description', 'Write calendar entries', 'parametersSchema', '{"type":"object"}'::jsonb, 'parametersSchemaDigest', 'sha256:' || repeat('2', 64))))$statement$, 'agent_revision_integration_assignments_pkey');
INSERT INTO "agent_revisions" ("id", "agent_service_id", "revision", "digest", "prompt_policy_version", "model_definition_id", "budget", "authored_by")
VALUES ('integration-revision-tools', 'integration-service', 2, 'sha256:' || repeat('b', 64), 'prompt-v1', 'integrations-model', '{}', 'user-1');
INSERT INTO "integrations" ("id", "silo_id", "obot_catalog_entry_id", "display_name", "updated_at")
VALUES ('integration-tools', 'silo-integrations', 'obot-catalog-tools', 'Tasks', clock_timestamp());
INSERT INTO "integration_custody_references" ("id", "integration_id", "silo_id", "obot_custody_reference", "expires_at")
VALUES ('custody-tools', 'integration-tools', 'silo-integrations', 'obot:opaque:tools', clock_timestamp() + interval '1 hour');
SELECT pg_temp.expect_failure('malformed reviewed tool definitions are rejected', $statement$
  INSERT INTO "agent_revision_integration_assignments" ("agent_revision_id", "integration_id", "silo_id", "custody_reference_id", "tool_definitions")
  VALUES ('integration-revision-tools', 'integration-tools', 'silo-integrations', 'custody-tools', '[{"name":"","description":"","parametersSchema":{"type":"string"},"parametersSchemaDigest":"not-a-digest"}]'::jsonb)$statement$, 'tool_definitions_check');
SELECT pg_temp.expect_failure('duplicate reviewed tool names are rejected', $statement$
  INSERT INTO "agent_revision_integration_assignments" ("agent_revision_id", "integration_id", "silo_id", "custody_reference_id", "tool_definitions")
  VALUES ('integration-revision-tools', 'integration-tools', 'silo-integrations', 'custody-tools', jsonb_build_array(
    jsonb_build_object('name', 'tasks.read', 'description', 'Read tasks', 'parametersSchema', '{"type":"object"}'::jsonb, 'parametersSchemaDigest', 'sha256:' || repeat('3', 64)),
    jsonb_build_object('name', 'tasks.read', 'description', 'Read tasks again', 'parametersSchema', '{"type":"object"}'::jsonb, 'parametersSchemaDigest', 'sha256:' || repeat('4', 64))
  ))$statement$, 'tool_definitions_check');

INSERT INTO "integrations" ("id", "silo_id", "obot_catalog_entry_id", "display_name", "updated_at")
VALUES ('foreign-integration', 'other-silo', 'obot-catalog-foreign', 'Foreign calendar', clock_timestamp());
INSERT INTO "integration_custody_references" ("id", "integration_id", "silo_id", "obot_custody_reference", "expires_at")
VALUES ('foreign-custody', 'foreign-integration', 'other-silo', 'obot:opaque:foreign', clock_timestamp() + interval '1 hour');
SELECT pg_temp.expect_failure('cross silo integration assignment', $statement$
  INSERT INTO "agent_revision_integration_assignments" ("agent_revision_id", "integration_id", "silo_id", "custody_reference_id", "tool_definitions")
  SELECT 'integration-revision', 'foreign-integration', 'other-silo', 'foreign-custody', "tool_definitions" FROM "agent_revision_integration_assignments" WHERE "agent_revision_id" = 'integration-revision'$statement$, 'same silo');

UPDATE "agent_revisions" SET "state" = 'published', "published_at" = clock_timestamp() WHERE "id" = 'integration-revision';
SELECT pg_temp.expect_failure('published integration assignment is immutable', $statement$
  UPDATE "agent_revision_integration_assignments" SET "tool_definitions" = jsonb_build_array(jsonb_build_object('name', 'calendar.write', 'description', 'Write calendar entries', 'parametersSchema', '{"type":"object"}'::jsonb, 'parametersSchemaDigest', 'sha256:' || repeat('2', 64)))
  WHERE "agent_revision_id" = 'integration-revision' AND "integration_id" = 'integration-1'$statement$, 'AgentRevision assignments are immutable');

INSERT INTO "agent_revisions" ("id", "agent_service_id", "revision", "digest", "prompt_policy_version", "model_definition_id", "budget", "authored_by")
VALUES ('integration-revision-2', 'integration-service', 3, 'sha256:' || repeat('c', 64), 'prompt-v1', 'integrations-model', '{}', 'user-1');
UPDATE "integration_custody_references" SET "state" = 'revoked', "revoked_at" = clock_timestamp() WHERE "id" = 'custody-1';
SELECT pg_temp.expect_failure('revoked custody reference cannot be assigned', $statement$
  INSERT INTO "agent_revision_integration_assignments" ("agent_revision_id", "integration_id", "silo_id", "custody_reference_id", "tool_definitions")
  SELECT 'integration-revision-2', 'integration-1', 'silo-integrations', 'custody-1', "tool_definitions" FROM "agent_revision_integration_assignments" WHERE "agent_revision_id" = 'integration-revision'$statement$, 'ready unexpired');

INSERT INTO "integration_custody_references" ("id", "integration_id", "silo_id", "obot_custody_reference", "state", "expires_at")
VALUES ('expired-custody', 'integration-1', 'silo-integrations', 'obot:opaque:expired', 'expired', clock_timestamp() - interval '1 hour');
SELECT pg_temp.expect_failure('expired custody reference cannot be assigned', $statement$
  INSERT INTO "agent_revision_integration_assignments" ("agent_revision_id", "integration_id", "silo_id", "custody_reference_id", "tool_definitions")
  SELECT 'integration-revision-2', 'integration-1', 'silo-integrations', 'expired-custody', "tool_definitions" FROM "agent_revision_integration_assignments" WHERE "agent_revision_id" = 'integration-revision'$statement$, 'ready unexpired');
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
