-- Recreate the provider and model rows from immediately before the central migration assigns
-- silo-scoped provider ids. A referenced model proves that the migration suspends immutability for
-- that rewrite and restores it before later model changes.
BEGIN;

CREATE SCHEMA provider_identity_backfill_fixture;
SET LOCAL search_path = provider_identity_backfill_fixture, pg_catalog;

CREATE TABLE "provider_credentials" (
    "id" TEXT PRIMARY KEY,
    "silo_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "cluster_tenant" TEXT
);
CREATE TABLE "model_definitions" (
    "id" TEXT PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "cluster_tenant" TEXT,
    "public_model_name" TEXT NOT NULL,
    "litellm_model_id" TEXT NOT NULL,
    "upstream_model" TEXT NOT NULL,
    "api_base" TEXT,
    "provider_credential_id" TEXT
);
CREATE TABLE "agent_revisions" (
    "id" TEXT PRIMARY KEY,
    "model_definition_id" TEXT NOT NULL REFERENCES "model_definitions"("id")
);

CREATE FUNCTION "enforce_referenced_model_definition_immutability"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "agent_revisions"
        WHERE "model_definition_id" = OLD."id"
    ) AND (
        NEW."scope" IS DISTINCT FROM OLD."scope"
        OR NEW."cluster_tenant" IS DISTINCT FROM OLD."cluster_tenant"
        OR NEW."public_model_name" IS DISTINCT FROM OLD."public_model_name"
        OR NEW."litellm_model_id" IS DISTINCT FROM OLD."litellm_model_id"
        OR NEW."upstream_model" IS DISTINCT FROM OLD."upstream_model"
        OR NEW."api_base" IS DISTINCT FROM OLD."api_base"
        OR NEW."provider_credential_id" IS DISTINCT FROM OLD."provider_credential_id"
    ) THEN
        RAISE EXCEPTION 'A ModelDefinition referenced by an AgentRevision is immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "referenced_model_definitions_immutable"
    BEFORE UPDATE ON "model_definitions"
    FOR EACH ROW EXECUTE FUNCTION "enforce_referenced_model_definition_immutability"();

INSERT INTO "provider_credentials" (
    "id", "silo_id", "provider", "scope", "cluster_tenant"
) VALUES (
    'legacy-global-provider', 'fixture-silo', 'openai', 'global', NULL
);
INSERT INTO "model_definitions" (
    "id", "scope", "cluster_tenant", "public_model_name", "litellm_model_id",
    "upstream_model", "api_base", "provider_credential_id"
) VALUES (
    'referenced-model', 'global', NULL, 'fixture-model', 'fixture-model',
    'openai/fixture-model', NULL, 'legacy-global-provider'
);
INSERT INTO "agent_revisions" ("id", "model_definition_id")
VALUES ('published-revision', 'referenced-model');

-- APPLY THE PROVIDER IDENTITY BACKFILL HERE

-- VERIFY THE PROVIDER IDENTITY BACKFILL HERE

DO $verification$
DECLARE
    mutation_rejected BOOLEAN := false;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "provider_credentials"
        WHERE "id" = 'byok:fixture-silo:openai'
          AND "silo_id" = 'fixture-silo'
          AND "provider" = 'openai'
    ) OR EXISTS (
        SELECT 1 FROM "provider_credentials"
        WHERE "id" = 'legacy-global-provider'
    ) THEN
        RAISE EXCEPTION 'FAIL: provider identity backfill did not replace the legacy global id';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM "model_definitions"
        WHERE "id" = 'referenced-model'
          AND "provider_credential_id" = 'byok:fixture-silo:openai'
    ) THEN
        RAISE EXCEPTION 'FAIL: referenced model did not receive the silo-scoped provider id';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'model_definitions'::regclass
          AND tgname = 'referenced_model_definitions_immutable'
          AND tgenabled = 'O'
          AND tgfoid = 'enforce_referenced_model_definition_immutability()'::regprocedure
    ) THEN
        RAISE EXCEPTION 'FAIL: provider identity backfill did not restore the target immutability trigger';
    END IF;

    BEGIN
        UPDATE "model_definitions"
           SET "provider_credential_id" = 'later-mutation'
         WHERE "id" = 'referenced-model';
    EXCEPTION
        WHEN raise_exception THEN
            IF SQLERRM = 'A ModelDefinition referenced by an AgentRevision is immutable' THEN
                mutation_rejected := true;
            ELSE
                RAISE;
            END IF;
    END;
    IF NOT mutation_rejected THEN
        RAISE EXCEPTION 'FAIL: restored ModelDefinition authority accepted a later provider change';
    END IF;
END;
$verification$;

DO $$
BEGIN
    RAISE NOTICE 'PASS: provider identity backfill rewrites referenced models and restores immutability';
END;
$$;

ROLLBACK;
