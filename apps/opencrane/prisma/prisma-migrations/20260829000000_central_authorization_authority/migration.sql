-- Install the immutable central product-authorization catalogue used by transaction-bound grants.
BEGIN;

-- Remove the callerless proof-bound receipt model replaced by transaction-bound product admission
-- and the durable ToolInvocation lifecycle. RunProofKey and WorkloadAssignment remain because they
-- still prove the identity assigned to live workloads.
DROP TABLE "action_execution_receipts";
DROP FUNCTION "enforce_action_execution_receipt_lifecycle"();
DROP TYPE "ActionExecutionState";
DROP TYPE "ActionReplayMode";

-- Delete the callerless generic memory delivery queue. Personal memory retains the durable
-- dataset and fact catalogue; gateway delivery follows the admitted personal-memory path.
DROP TABLE IF EXISTS "memory_outbox_events";
DROP TYPE IF EXISTS "MemoryOutboxEventKind";

-- Bind every newly admitted ToolInvocation to the central decisions that authorized it. The
-- pre-1.0 cutover deletes every row written before this evidence contract existed; no candidate
-- runtime history crosses the 0.9.2 to 0.10.0 release boundary.
CREATE TYPE "ToolInvocationAuthorizationActorKind" AS ENUM ('user', 'agent-service');
ALTER TABLE "tool_invocations" ADD COLUMN "authorization_principal_id" TEXT;
ALTER TABLE "tool_invocations" ADD COLUMN "authorization_actor_kind" "ToolInvocationAuthorizationActorKind";
ALTER TABLE "tool_invocations" ADD COLUMN "authorization_coordinates" JSONB;
ALTER TABLE "tool_invocations" ADD COLUMN "authorization_decision_digests" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "tool_invocations" ADD COLUMN "authorization_membership_revision" INTEGER;
ALTER TABLE "tool_invocations" ADD COLUMN "authorization_assignment_digest" TEXT;
ALTER TABLE "tool_invocations" ADD COLUMN "authorization_evidence_digest" TEXT;

-- Delete every pre-0.10 ToolInvocation and its invocation-owned dependants. Tagged 0.9.2 did not
-- admit central evidence, while rows from an untagged 0.10 candidate are expressly unsupported.
CREATE TEMP TABLE "precentral_tool_invocations" (
    "id" TEXT PRIMARY KEY
) ON COMMIT DROP;
INSERT INTO "precentral_tool_invocations" ("id")
SELECT "id"
  FROM "tool_invocations";

DROP TRIGGER IF EXISTS "personal_memory_permission_receipts_authority" ON "personal_memory_permission_receipts";
DROP TRIGGER IF EXISTS "approval_requests_immutable" ON "approval_requests";
DROP TRIGGER IF EXISTS "mcp_runtime_executions_authority" ON "mcp_runtime_executions";
DROP TRIGGER IF EXISTS "tool_invocations_lifecycle_guard" ON "tool_invocations";

DO $$
BEGIN
    IF to_regclass('skill_workloads') IS NOT NULL THEN
        IF to_regclass('skill_workload_bootstraps') IS NOT NULL THEN
            EXECUTE 'DROP TRIGGER IF EXISTS "skill_workload_bootstraps_authority" ON "skill_workload_bootstraps"';
            EXECUTE 'DELETE FROM "skill_workload_bootstraps" bootstrap
                      USING "skill_workloads" workload, "precentral_tool_invocations" invocation
                      WHERE bootstrap."skill_workload_id" = workload."id"
                        AND workload."tool_invocation_id" = invocation."id"';
        END IF;
        EXECUTE 'DROP TRIGGER IF EXISTS "skill_workloads_authority" ON "skill_workloads"';
        EXECUTE 'DELETE FROM "skill_workloads" workload
                  USING "precentral_tool_invocations" invocation
                  WHERE workload."tool_invocation_id" = invocation."id"';
    END IF;
END $$;
DELETE FROM "personal_memory_permission_receipts"
 WHERE "tool_invocation_id" IN (SELECT "id" FROM "precentral_tool_invocations");
DELETE FROM "approval_requests"
 WHERE "tool_invocation_row_id" IN (SELECT "id" FROM "precentral_tool_invocations");
DELETE FROM "tool_result_deliveries"
 WHERE "tool_invocation_id" IN (SELECT "id" FROM "precentral_tool_invocations");
DELETE FROM "mcp_runtime_executions"
 WHERE "tool_invocation_id" IN (SELECT "id" FROM "precentral_tool_invocations");
DELETE FROM "tool_invocations"
 WHERE "id" IN (SELECT "id" FROM "precentral_tool_invocations");

CREATE TRIGGER "tool_invocations_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "tool_invocations" FOR EACH ROW EXECUTE FUNCTION "enforce_tool_invocation_lifecycle"();
CREATE TRIGGER "mcp_runtime_executions_authority" BEFORE INSERT OR UPDATE OR DELETE ON "mcp_runtime_executions" FOR EACH ROW EXECUTE FUNCTION "enforce_mcp_runtime_execution_authority"();
CREATE TRIGGER "approval_requests_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "approval_requests" FOR EACH ROW EXECUTE FUNCTION "enforce_approval_request_update"();
CREATE TRIGGER "personal_memory_permission_receipts_authority" BEFORE INSERT OR UPDATE OR DELETE ON "personal_memory_permission_receipts" FOR EACH ROW EXECUTE FUNCTION "enforce_personal_memory_permission_authority"();
DO $$
DECLARE
    has_residue BOOLEAN;
BEGIN
    IF EXISTS (SELECT 1 FROM "tool_invocations" invocation JOIN "precentral_tool_invocations" legacy ON legacy."id" = invocation."id")
        OR EXISTS (SELECT 1 FROM "approval_requests" approval JOIN "precentral_tool_invocations" legacy ON legacy."id" = approval."tool_invocation_row_id")
        OR EXISTS (SELECT 1 FROM "tool_result_deliveries" delivery JOIN "precentral_tool_invocations" legacy ON legacy."id" = delivery."tool_invocation_id")
        OR EXISTS (SELECT 1 FROM "personal_memory_permission_receipts" receipt JOIN "precentral_tool_invocations" legacy ON legacy."id" = receipt."tool_invocation_id")
        OR EXISTS (SELECT 1 FROM "mcp_runtime_executions" execution JOIN "precentral_tool_invocations" legacy ON legacy."id" = execution."tool_invocation_id") THEN
        RAISE EXCEPTION 'pre-central ToolInvocation cleanup left durable runtime residue';
    END IF;
    IF to_regclass('skill_workloads') IS NOT NULL THEN
        EXECUTE 'SELECT EXISTS (
                    SELECT 1 FROM "skill_workloads" workload
                    JOIN "precentral_tool_invocations" legacy ON legacy."id" = workload."tool_invocation_id"
                 )' INTO has_residue;
        IF has_residue THEN
            RAISE EXCEPTION 'pre-central ToolInvocation cleanup left durable SQL workload residue';
        END IF;
    END IF;
END $$;

-- Move legacy provider and model-routing rows under an explicit silo authority. A revision derives
-- its silo from its owning service; model and credential rows inherit that authority when referenced.
-- Unreferenced legacy rows can only be retained when the database admits exactly one silo.
ALTER TABLE "agent_revisions" ADD COLUMN "silo_id" TEXT;
ALTER TABLE "provider_credentials" ADD COLUMN "silo_id" TEXT;
ALTER TABLE "model_definitions" ADD COLUMN "silo_id" TEXT;
ALTER TABLE "model_routing_defaults" ADD COLUMN "silo_id" TEXT;

UPDATE "agent_revisions" revision
   SET "silo_id" = service."silo_id"
  FROM "agent_services" service
 WHERE service."id" = revision."agent_service_id";

DO $$
BEGIN
    IF EXISTS (
        SELECT revision."model_definition_id"
          FROM "agent_revisions" revision
         GROUP BY revision."model_definition_id"
        HAVING count(DISTINCT revision."silo_id") > 1
    ) THEN
        RAISE EXCEPTION 'cannot silo model authority: one model definition is referenced by multiple silos';
    END IF;
END $$;
UPDATE "model_definitions" definition
   SET "silo_id" = authority."silo_id"
  FROM (
      SELECT revision."model_definition_id", min(revision."silo_id") AS "silo_id"
        FROM "agent_revisions" revision
       GROUP BY revision."model_definition_id"
  ) authority
 WHERE authority."model_definition_id" = definition."id";

DO $$
BEGIN
    IF EXISTS (
        SELECT definition."provider_credential_id"
          FROM "model_definitions" definition
         WHERE definition."provider_credential_id" IS NOT NULL
         GROUP BY definition."provider_credential_id"
        HAVING count(DISTINCT definition."silo_id") > 1
    ) THEN
        RAISE EXCEPTION 'cannot silo provider authority: one provider credential is referenced by multiple silos';
    END IF;
END $$;
UPDATE "provider_credentials" credential
   SET "silo_id" = authority."silo_id"
  FROM (
      SELECT definition."provider_credential_id", min(definition."silo_id") AS "silo_id"
        FROM "model_definitions" definition
       WHERE definition."provider_credential_id" IS NOT NULL
       GROUP BY definition."provider_credential_id"
  ) authority
 WHERE authority."provider_credential_id" = credential."id";

CREATE TEMP TABLE "provider_scope_admitted_silos" (
    "silo_id" TEXT PRIMARY KEY
) ON COMMIT DROP;
INSERT INTO "provider_scope_admitted_silos" ("silo_id")
SELECT "silo_id" FROM "principals" WHERE btrim("silo_id") <> ''
UNION
SELECT "silo_id" FROM "agent_services" WHERE btrim("silo_id") <> '';

DO $$
DECLARE
    admitted_silo_count INTEGER;
    admitted_silo_id TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM "agent_revisions" WHERE "silo_id" IS NULL OR btrim("silo_id") = '') THEN
        RAISE EXCEPTION 'cannot silo agent revisions: an owning service has no admitted silo';
    END IF;

    IF EXISTS (SELECT 1 FROM "model_definitions" WHERE "silo_id" IS NULL)
        OR EXISTS (SELECT 1 FROM "provider_credentials" WHERE "silo_id" IS NULL)
        OR EXISTS (SELECT 1 FROM "model_routing_defaults" WHERE "silo_id" IS NULL) THEN
        SELECT count(*), min("silo_id")
          INTO admitted_silo_count, admitted_silo_id
          FROM "provider_scope_admitted_silos";
        IF admitted_silo_count <> 1 THEN
            RAISE EXCEPTION 'cannot map unscoped provider authority: expected one admitted silo, found %', admitted_silo_count;
        END IF;
        UPDATE "model_definitions" SET "silo_id" = admitted_silo_id WHERE "silo_id" IS NULL;
        UPDATE "provider_credentials" SET "silo_id" = admitted_silo_id WHERE "silo_id" IS NULL;
        UPDATE "model_routing_defaults" SET "silo_id" = admitted_silo_id WHERE "silo_id" IS NULL;
    END IF;
END $$;

ALTER TABLE "agent_revisions" ALTER COLUMN "silo_id" SET NOT NULL;
ALTER TABLE "provider_credentials" ALTER COLUMN "silo_id" SET NOT NULL;
ALTER TABLE "model_definitions" ALTER COLUMN "silo_id" SET NOT NULL;
ALTER TABLE "model_routing_defaults" ALTER COLUMN "silo_id" SET NOT NULL;

ALTER TABLE "agent_revisions" DROP CONSTRAINT "agent_revisions_agent_service_id_fkey";
ALTER TABLE "agent_revisions" DROP CONSTRAINT "agent_revisions_model_definition_id_fkey";
ALTER TABLE "agent_revisions" DROP CONSTRAINT "agent_revisions_parent_revision_id_fkey";
ALTER TABLE "agent_revisions" DROP CONSTRAINT "agent_revisions_source_revision_id_fkey";
ALTER TABLE "model_definitions" DROP CONSTRAINT "model_definitions_provider_credential_id_fkey";

-- Give each silo-global provider one identity shared by credential rows, product grants, runtime
-- mint authority, and durable provider commands. The silo remains in the id because credential ids
-- are globally unique even though provider names repeat across silos.
CREATE TEMP TABLE "global_provider_connection_identity" AS
SELECT "id" AS "old_id", 'byok:' || "silo_id" || ':' || "provider" AS "new_id"
  FROM "provider_credentials"
 WHERE "scope" = 'global' AND "cluster_tenant" IS NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM "global_provider_connection_identity" identity
          JOIN "provider_credentials" credential ON credential."id" = identity."new_id"
         WHERE credential."id" <> identity."old_id"
    ) THEN
        RAISE EXCEPTION 'cannot install provider connection identity: a canonical id is already owned by another credential';
    END IF;
END $$;

UPDATE "model_definitions" definition
   SET "provider_credential_id" = identity."new_id"
  FROM "global_provider_connection_identity" identity
 WHERE definition."provider_credential_id" = identity."old_id";
UPDATE "provider_credentials" credential
   SET "id" = identity."new_id"
  FROM "global_provider_connection_identity" identity
 WHERE credential."id" = identity."old_id";

DROP INDEX "model_routing_defaults_scope_cluster_tenant_key";
DROP INDEX IF EXISTS "model_routing_defaults_global_key";
DROP INDEX "provider_credentials_cluster_tenant_idx";
DROP INDEX "provider_credentials_scope_cluster_tenant_provider_key";
DROP INDEX "model_definitions_cluster_tenant_idx";
DROP INDEX "model_definitions_litellm_model_id_key";
DROP INDEX "model_definitions_scope_cluster_tenant_public_model_name_key";

CREATE UNIQUE INDEX "agent_revisions_id_silo_id_key" ON "agent_revisions"("id", "silo_id");
CREATE INDEX "agent_revisions_silo_id_model_definition_id_idx" ON "agent_revisions"("silo_id", "model_definition_id");
CREATE UNIQUE INDEX "provider_credentials_id_silo_id_key" ON "provider_credentials"("id", "silo_id");
CREATE INDEX "provider_credentials_silo_id_cluster_tenant_idx" ON "provider_credentials"("silo_id", "cluster_tenant");
CREATE UNIQUE INDEX "provider_credentials_silo_id_scope_cluster_tenant_provider_key" ON "provider_credentials"("silo_id", "scope", "cluster_tenant", "provider");
CREATE UNIQUE INDEX "model_definitions_id_silo_id_key" ON "model_definitions"("id", "silo_id");
CREATE INDEX "model_definitions_silo_id_cluster_tenant_idx" ON "model_definitions"("silo_id", "cluster_tenant");
CREATE UNIQUE INDEX "model_definitions_silo_id_litellm_model_id_key" ON "model_definitions"("silo_id", "litellm_model_id");
CREATE UNIQUE INDEX "model_definitions_silo_id_scope_cluster_tenant_public_model_key" ON "model_definitions"("silo_id", "scope", "cluster_tenant", "public_model_name");
CREATE UNIQUE INDEX "model_routing_defaults_id_silo_id_key" ON "model_routing_defaults"("id", "silo_id");
CREATE UNIQUE INDEX "model_routing_defaults_silo_id_scope_cluster_tenant_key" ON "model_routing_defaults"("silo_id", "scope", "cluster_tenant");

-- PostgreSQL treats NULLs as distinct in Prisma compound keys. These partial indexes enforce one
-- global credential, alias, default, and routing row per silo while preserving tenant overrides.
DO $$
BEGIN
    IF EXISTS (
        SELECT "silo_id", "provider"
          FROM "provider_credentials"
         WHERE "scope" = 'global' AND "cluster_tenant" IS NULL
         GROUP BY "silo_id", "provider"
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'cannot install global provider authority: duplicate providers exist within one silo';
    END IF;
    IF EXISTS (
        SELECT "silo_id", "public_model_name"
          FROM "model_definitions"
         WHERE "scope" = 'global' AND "cluster_tenant" IS NULL
         GROUP BY "silo_id", "public_model_name"
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'cannot install global model alias authority: duplicate public model names exist within one silo';
    END IF;
    IF EXISTS (
        SELECT "silo_id"
          FROM "model_definitions"
         WHERE "scope" = 'global' AND "cluster_tenant" IS NULL AND "is_default"
         GROUP BY "silo_id"
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'cannot install global model default authority: multiple global defaults exist within one silo';
    END IF;
    IF EXISTS (
        SELECT "silo_id"
          FROM "model_routing_defaults"
         WHERE "scope" = 'global' AND "cluster_tenant" IS NULL
         GROUP BY "silo_id"
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'cannot install global model routing authority: multiple global routing rows exist within one silo';
    END IF;
END $$;
CREATE UNIQUE INDEX "provider_credentials_global_provider_key" ON "provider_credentials"("silo_id", "provider") WHERE "scope" = 'global' AND "cluster_tenant" IS NULL;
CREATE UNIQUE INDEX "model_definitions_global_public_model_name_key" ON "model_definitions"("silo_id", "public_model_name") WHERE "scope" = 'global' AND "cluster_tenant" IS NULL;
CREATE UNIQUE INDEX "model_definitions_global_default_key" ON "model_definitions"("silo_id") WHERE "scope" = 'global' AND "cluster_tenant" IS NULL AND "is_default";
CREATE UNIQUE INDEX "model_routing_defaults_global_key" ON "model_routing_defaults"("silo_id") WHERE "scope" = 'global' AND "cluster_tenant" IS NULL;

ALTER TABLE "agent_revisions" ADD CONSTRAINT "agent_revisions_agent_service_id_silo_id_fkey" FOREIGN KEY ("agent_service_id", "silo_id") REFERENCES "agent_services"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agent_revisions" ADD CONSTRAINT "agent_revisions_model_definition_id_silo_id_fkey" FOREIGN KEY ("model_definition_id", "silo_id") REFERENCES "model_definitions"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agent_revisions" ADD CONSTRAINT "agent_revisions_parent_revision_id_silo_id_fkey" FOREIGN KEY ("parent_revision_id", "silo_id") REFERENCES "agent_revisions"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agent_revisions" ADD CONSTRAINT "agent_revisions_source_revision_id_silo_id_fkey" FOREIGN KEY ("source_revision_id", "silo_id") REFERENCES "agent_revisions"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "model_definitions" ADD CONSTRAINT "model_definitions_provider_credential_id_silo_id_fkey" FOREIGN KEY ("provider_credential_id", "silo_id") REFERENCES "provider_credentials"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Persist one-use authorization for the model-key mint effect after the central authority has
-- admitted the exact run attempt, model definition, provider connection, and authorization digest.
CREATE TABLE "run_model_credential_mint_authorizations" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "generation" INTEGER NOT NULL,
    "principal_id" TEXT NOT NULL,
    "model_definition_id" TEXT NOT NULL,
    "provider_connection_id" TEXT,
    "authorization_digest" TEXT NOT NULL,
    "key_alias" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "claimed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_model_credential_mint_authorizations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "run_model_credential_mint_authorizations_key_alias_key" ON "run_model_credential_mint_authorizations"("key_alias");
CREATE INDEX "run_model_credential_mint_authorizations_expires_at_idx" ON "run_model_credential_mint_authorizations"("expires_at");
CREATE UNIQUE INDEX "run_model_credential_mint_authorizations_run_id_attempt_gen_key" ON "run_model_credential_mint_authorizations"("run_id", "attempt", "generation");
ALTER TABLE "run_model_credential_mint_authorizations" ADD CONSTRAINT "run_model_credential_mint_authorizations_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Commit each provider-side Kubernetes or LiteLLM operation before an executor performs external
-- I/O. Raw keys remain process-only: the row stores a command-bound verifier and non-secret payload.
CREATE TYPE "ProviderEffectCommandKind" AS ENUM ('set_byok_key', 'delete_byok_key', 'register_model');
CREATE TYPE "ProviderEffectCommandState" AS ENUM ('pending', 'awaiting_material', 'claimed', 'succeeded', 'failed');
CREATE TYPE "ProviderEffectMaterialRequirement" AS ENUM ('none', 'ephemeral_provider_key');
CREATE TABLE "provider_effect_commands" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "principal_id" TEXT NOT NULL,
    "kind" "ProviderEffectCommandKind" NOT NULL,
    "resource_kind" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "resource_revision" TEXT NOT NULL,
    "desired_generation" INTEGER NOT NULL,
    "arguments_digest" TEXT NOT NULL,
    "material_verifier" TEXT,
    "authorization_decision_digest" TEXT NOT NULL,
    "authorization_policy_revision_hash" TEXT NOT NULL,
    "effective_authorization_digest" TEXT NOT NULL,
    "executor_profile" TEXT NOT NULL,
    "material_requirement" "ProviderEffectMaterialRequirement" NOT NULL DEFAULT 'none',
    "payload" JSONB NOT NULL,
    "state" "ProviderEffectCommandState" NOT NULL DEFAULT 'pending',
    "delivery_count" INTEGER NOT NULL DEFAULT 0,
    "claim_fence" TEXT,
    "claim_expires_at" TIMESTAMP(3),
    "follow_up_command_id" TEXT,
    "result" JSONB,
    "failure_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "provider_effect_commands_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "provider_effect_commands_silo_id_resource_kind_resource_id__idx" ON "provider_effect_commands"("silo_id", "resource_kind", "resource_id", "desired_generation" DESC);
CREATE INDEX "provider_effect_commands_state_claim_expires_at_idx" ON "provider_effect_commands"("state", "claim_expires_at");
CREATE INDEX "provider_effect_commands_follow_up_command_id_idx" ON "provider_effect_commands"("follow_up_command_id");
CREATE INDEX "provider_effect_commands_silo_id_created_at_idx" ON "provider_effect_commands"("silo_id", "created_at");
CREATE UNIQUE INDEX "provider_effect_commands_silo_kind_resource_revision_key" ON "provider_effect_commands"("silo_id", "kind", "resource_id", "resource_revision");
CREATE UNIQUE INDEX "provider_effect_commands_silo_id_resource_kind_resource_id__key" ON "provider_effect_commands"("silo_id", "resource_kind", "resource_id", "desired_generation");
ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_follow_up_command_id_fkey" FOREIGN KEY ("follow_up_command_id") REFERENCES "provider_effect_commands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_identity_check" CHECK (
    btrim("id") <> ''
    AND btrim("silo_id") <> ''
    AND btrim("principal_id") <> ''
    AND btrim("resource_kind") <> ''
    AND btrim("resource_id") <> ''
    AND btrim("resource_revision") <> ''
    AND "desired_generation" > 0
    AND "arguments_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "authorization_decision_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "authorization_policy_revision_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "effective_authorization_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND btrim("executor_profile") <> ''
    AND "delivery_count" >= 0
);
ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_material_check" CHECK (
    ("kind" = 'set_byok_key' AND "material_requirement" = 'ephemeral_provider_key' AND "material_verifier" IS NOT NULL AND "material_verifier" ~ '^sha256:[0-9a-f]{64}$')
    OR ("kind" IN ('delete_byok_key', 'register_model') AND "material_requirement" = 'none' AND "material_verifier" IS NULL)
);
ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_claim_check" CHECK (
    ("state" = 'claimed' AND "claim_fence" IS NOT NULL AND btrim("claim_fence") <> '' AND "claim_expires_at" IS NOT NULL AND "delivery_count" >= 1)
    OR ("state" <> 'claimed' AND "claim_fence" IS NULL AND "claim_expires_at" IS NULL)
);
ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_completion_check" CHECK (
    ("state" = 'succeeded' AND "completed_at" IS NOT NULL AND "result" IS NOT NULL AND "failure_code" IS NULL)
    OR ("state" = 'failed' AND "completed_at" IS NOT NULL AND "result" IS NULL AND "failure_code" IS NOT NULL AND btrim("failure_code") <> '')
    OR ("state" = 'claimed' AND "completed_at" IS NULL AND "result" IS NOT NULL AND "failure_code" = 'provider_effect_finalization_blocked')
    OR ("state" IN ('pending', 'awaiting_material', 'claimed') AND "completed_at" IS NULL AND "result" IS NULL AND ("failure_code" IS NULL OR (btrim("failure_code") <> '' AND "failure_code" <> 'provider_effect_finalization_blocked')))
);
ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_follow_up_check" CHECK (
    "follow_up_command_id" IS NULL
    OR ("kind" = 'set_byok_key' AND "state" = 'succeeded' AND "follow_up_command_id" <> "id")
);
ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_payload_check" CHECK (
    jsonb_typeof("payload") = 'object'
    AND (
        ("kind" IN ('set_byok_key', 'delete_byok_key')
            AND "payload" ?& ARRAY['provider', 'secretRef', 'litellmCredentialName']
            AND "payload" - ARRAY['provider', 'secretRef', 'litellmCredentialName'] = '{}'::jsonb
            AND jsonb_typeof("payload"->'provider') = 'string'
            AND jsonb_typeof("payload"->'secretRef') = 'string'
            AND jsonb_typeof("payload"->'litellmCredentialName') = 'string'
            AND COALESCE(btrim("payload"->>'provider'), '') <> ''
            AND COALESCE(btrim("payload"->>'secretRef'), '') <> ''
            AND COALESCE(btrim("payload"->>'litellmCredentialName'), '') <> '')
        OR ("kind" = 'register_model'
            AND "payload" ?& ARRAY['modelDefinitionId', 'publicModelName', 'upstreamModel', 'scope', 'clusterTenant', 'apiBase', 'apiKeyEnvRef', 'litellmCredentialName', 'routingDefaultId', 'selectedModelDefinitionId']
            AND "payload" - ARRAY['modelDefinitionId', 'publicModelName', 'upstreamModel', 'scope', 'clusterTenant', 'apiBase', 'apiKeyEnvRef', 'litellmCredentialName', 'routingDefaultId', 'selectedModelDefinitionId'] = '{}'::jsonb
            AND jsonb_typeof("payload"->'modelDefinitionId') = 'string'
            AND jsonb_typeof("payload"->'publicModelName') = 'string'
            AND jsonb_typeof("payload"->'upstreamModel') = 'string'
            AND jsonb_typeof("payload"->'scope') = 'string'
            AND COALESCE(btrim("payload"->>'modelDefinitionId'), '') <> ''
            AND COALESCE(btrim("payload"->>'publicModelName'), '') <> ''
            AND COALESCE(btrim("payload"->>'upstreamModel'), '') <> ''
            AND "payload"->>'scope' IN ('global', 'clusterTenant')
            AND (("payload"->>'scope' = 'global' AND jsonb_typeof("payload"->'clusterTenant') = 'null')
                OR ("payload"->>'scope' = 'clusterTenant' AND jsonb_typeof("payload"->'clusterTenant') = 'string' AND COALESCE(btrim("payload"->>'clusterTenant'), '') <> ''))
            AND (jsonb_typeof("payload"->'apiBase') = 'null' OR (jsonb_typeof("payload"->'apiBase') = 'string' AND COALESCE(btrim("payload"->>'apiBase'), '') <> ''))
            AND (jsonb_typeof("payload"->'apiKeyEnvRef') = 'null' OR (jsonb_typeof("payload"->'apiKeyEnvRef') = 'string' AND COALESCE(btrim("payload"->>'apiKeyEnvRef'), '') <> ''))
            AND (jsonb_typeof("payload"->'litellmCredentialName') = 'null' OR (jsonb_typeof("payload"->'litellmCredentialName') = 'string' AND COALESCE(btrim("payload"->>'litellmCredentialName'), '') <> ''))
            AND (
                (jsonb_typeof("payload"->'routingDefaultId') = 'null' AND jsonb_typeof("payload"->'selectedModelDefinitionId') = 'null')
                OR (jsonb_typeof("payload"->'routingDefaultId') = 'string'
                    AND COALESCE(btrim("payload"->>'routingDefaultId'), '') <> ''
                    AND jsonb_typeof("payload"->'selectedModelDefinitionId') = 'string'
                    AND COALESCE(btrim("payload"->>'selectedModelDefinitionId'), '') <> ''
                    AND "payload"->>'selectedModelDefinitionId' <> "payload"->>'modelDefinitionId'
                    AND "payload"->>'scope' = 'global'
                    AND "payload"->>'publicModelName' = 'auto')))
    )
);
ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_resource_binding_check" CHECK (
    ("kind" = 'register_model'
        AND "resource_kind" = 'model-definition'
        AND "payload"->>'modelDefinitionId' = "resource_id")
    OR ("kind" IN ('set_byok_key', 'delete_byok_key')
        AND "resource_kind" = 'provider-connection'
        AND "resource_id" = 'byok:' || "silo_id" || ':' || ("payload"->>'provider'))
);

-- Enforce the pre-release hard cutoff for rows whose organization owner cannot be derived.
-- The app-owned untagged-candidate repair attributes invitation audit rows from exact product
-- references before this migration. Spend and source rows still fail closed instead of guessing.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "token_usage_snapshots")
       OR EXISTS (SELECT 1 FROM "global_budget_settings")
       OR EXISTS (SELECT 1 FROM "account_budget_settings")
       OR EXISTS (SELECT 1 FROM "third_party_sources") THEN
		RAISE EXCEPTION USING
			ERRCODE = 'OC713',
			MESSAGE = 'central authorization migration requires empty legacy spend and third-party source tables because their silo ownership cannot be derived safely';
    END IF;
END $$;

ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "silo_id" TEXT;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "audit_log" WHERE "silo_id" IS NULL OR btrim("silo_id") = '') THEN
        RAISE EXCEPTION 'legacy audit rows require exact-silo attribution before central authorization migration' USING ERRCODE = 'OC713';
    END IF;
END $$;
ALTER TABLE "audit_log" ALTER COLUMN "silo_id" SET NOT NULL;
DROP INDEX IF EXISTS "audit_log_timestamp_idx";
CREATE INDEX IF NOT EXISTS "audit_log_silo_id_timestamp_id_idx" ON "audit_log"("silo_id", "timestamp", "id");

ALTER TABLE "token_usage_snapshots" ADD COLUMN "silo_id" TEXT NOT NULL;
DROP INDEX "token_usage_snapshots_sampled_at_idx";
DROP INDEX "token_usage_snapshots_user_id_currency_key";
CREATE INDEX "token_usage_snapshots_silo_id_sampled_at_idx" ON "token_usage_snapshots"("silo_id", "sampled_at");
CREATE UNIQUE INDEX "token_usage_snapshots_silo_id_user_id_currency_key" ON "token_usage_snapshots"("silo_id", "user_id", "currency");

ALTER TABLE "global_budget_settings" ADD COLUMN "silo_id" TEXT NOT NULL;
ALTER TABLE "global_budget_settings" DROP CONSTRAINT "global_budget_settings_pkey";
ALTER TABLE "global_budget_settings" ADD CONSTRAINT "global_budget_settings_pkey" PRIMARY KEY ("silo_id", "id");

ALTER TABLE "account_budget_settings" ADD COLUMN "silo_id" TEXT NOT NULL;
ALTER TABLE "account_budget_settings" DROP CONSTRAINT "account_budget_settings_pkey";
ALTER TABLE "account_budget_settings" ADD CONSTRAINT "account_budget_settings_pkey" PRIMARY KEY ("silo_id", "user_id");

ALTER TABLE "third_party_sources" ADD COLUMN "silo_id" TEXT NOT NULL;
DROP INDEX "third_party_sources_name_key";
CREATE UNIQUE INDEX "third_party_sources_silo_id_name_key" ON "third_party_sources"("silo_id", "name");
CREATE INDEX "third_party_sources_silo_id_created_at_idx" ON "third_party_sources"("silo_id", "created_at");

INSERT INTO "capability_catalog_revisions" (
    "id", "catalog_id", "revision", "digest", "capabilities", "created_by"
) VALUES (
    'capability-catalog-opencrane-product-authorization-v1',
    'opencrane-product-authorization',
    1,
    'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821',
    '[{"id":"organization:read","resourceKind":"organization","actions":["read"],"evidence":"read"},{"id":"organization:edit","resourceKind":"organization","actions":["edit"],"evidence":"decision"},{"id":"organization:manage","resourceKind":"organization","actions":["manage"],"evidence":"decision"},{"id":"organization:administer","resourceKind":"organization","actions":["administer"],"evidence":"decision"},{"id":"authorization-grant:read","resourceKind":"authorization-grant","actions":["read"],"evidence":"read"},{"id":"authorization-grant:create","resourceKind":"authorization-grant","actions":["create"],"evidence":"decision"},{"id":"authorization-grant:edit","resourceKind":"authorization-grant","actions":["edit"],"evidence":"decision"},{"id":"authorization-grant:revoke","resourceKind":"authorization-grant","actions":["revoke"],"evidence":"decision"},{"id":"authorization-grant:administer","resourceKind":"authorization-grant","actions":["administer"],"evidence":"decision"},{"id":"agent-service:discover","resourceKind":"agent-service","actions":["discover"],"evidence":"read"},{"id":"agent-service:read","resourceKind":"agent-service","actions":["read"],"evidence":"read"},{"id":"agent-service:create","resourceKind":"agent-service","actions":["create"],"evidence":"decision"},{"id":"agent-service:edit","resourceKind":"agent-service","actions":["edit"],"evidence":"decision"},{"id":"agent-service:publish","resourceKind":"agent-service","actions":["publish"],"evidence":"decision"},{"id":"agent-service:schedule","resourceKind":"agent-service","actions":["schedule"],"evidence":"decision"},{"id":"agent-service:retire","resourceKind":"agent-service","actions":["retire"],"evidence":"decision"},{"id":"agent-service:administer","resourceKind":"agent-service","actions":["administer"],"evidence":"decision"},{"id":"agent-service:invoke","resourceKind":"agent-service","actions":["invoke"],"evidence":"effect"},{"id":"agent-service:delegate","resourceKind":"agent-service","actions":["delegate"],"evidence":"effect"},{"id":"agent-revision:read","resourceKind":"agent-revision","actions":["read"],"evidence":"read"},{"id":"agent-revision:create","resourceKind":"agent-revision","actions":["create"],"evidence":"decision"},{"id":"agent-revision:edit","resourceKind":"agent-revision","actions":["edit"],"evidence":"decision"},{"id":"agent-revision:publish","resourceKind":"agent-revision","actions":["publish"],"evidence":"decision"},{"id":"agent-revision:assign","resourceKind":"agent-revision","actions":["assign"],"evidence":"decision"},{"id":"agent-revision:revoke","resourceKind":"agent-revision","actions":["revoke"],"evidence":"decision"},{"id":"agent-run:read","resourceKind":"agent-run","actions":["read"],"evidence":"read"},{"id":"agent-run:cancel","resourceKind":"agent-run","actions":["cancel"],"evidence":"decision"},{"id":"agent-run:retry","resourceKind":"agent-run","actions":["retry"],"evidence":"decision"},{"id":"tool-invocation:read","resourceKind":"tool-invocation","actions":["read"],"evidence":"read"},{"id":"tool-invocation:invoke","resourceKind":"tool-invocation","actions":["invoke"],"evidence":"effect"},{"id":"approval-request:read","resourceKind":"approval-request","actions":["read"],"evidence":"read"},{"id":"approval-request:decide","resourceKind":"approval-request","actions":["decide"],"evidence":"decision"},{"id":"skill:discover","resourceKind":"skill","actions":["discover"],"evidence":"read"},{"id":"skill:read","resourceKind":"skill","actions":["read"],"evidence":"read"},{"id":"skill:create","resourceKind":"skill","actions":["create"],"evidence":"decision"},{"id":"skill:edit","resourceKind":"skill","actions":["edit"],"evidence":"decision"},{"id":"skill:install","resourceKind":"skill","actions":["install"],"evidence":"decision"},{"id":"skill:publish","resourceKind":"skill","actions":["publish"],"evidence":"decision"},{"id":"skill:revoke","resourceKind":"skill","actions":["revoke"],"evidence":"decision"},{"id":"skill:retire","resourceKind":"skill","actions":["retire"],"evidence":"decision"},{"id":"skill:administer","resourceKind":"skill","actions":["administer"],"evidence":"decision"},{"id":"skill-revision:discover","resourceKind":"skill-revision","actions":["discover"],"evidence":"read"},{"id":"skill-revision:read","resourceKind":"skill-revision","actions":["read"],"evidence":"read"},{"id":"skill-revision:assign","resourceKind":"skill-revision","actions":["assign"],"evidence":"decision"},{"id":"skill-revision:review","resourceKind":"skill-revision","actions":["review"],"evidence":"decision"},{"id":"skill-revision:publish","resourceKind":"skill-revision","actions":["publish"],"evidence":"decision"},{"id":"skill-revision:revoke","resourceKind":"skill-revision","actions":["revoke"],"evidence":"decision"},{"id":"skill-revision:use","resourceKind":"skill-revision","actions":["use"],"evidence":"effect"},{"id":"mcp-server:discover","resourceKind":"mcp-server","actions":["discover"],"evidence":"read"},{"id":"mcp-server:read","resourceKind":"mcp-server","actions":["read"],"evidence":"read"},{"id":"mcp-server:create","resourceKind":"mcp-server","actions":["create"],"evidence":"decision"},{"id":"mcp-server:edit","resourceKind":"mcp-server","actions":["edit"],"evidence":"decision"},{"id":"mcp-server:install","resourceKind":"mcp-server","actions":["install"],"evidence":"decision"},{"id":"mcp-server:publish","resourceKind":"mcp-server","actions":["publish"],"evidence":"decision"},{"id":"mcp-server:revoke","resourceKind":"mcp-server","actions":["revoke"],"evidence":"decision"},{"id":"mcp-server:retire","resourceKind":"mcp-server","actions":["retire"],"evidence":"decision"},{"id":"mcp-server:administer","resourceKind":"mcp-server","actions":["administer"],"evidence":"decision"},{"id":"mcp-server-revision:discover","resourceKind":"mcp-server-revision","actions":["discover"],"evidence":"read"},{"id":"mcp-server-revision:read","resourceKind":"mcp-server-revision","actions":["read"],"evidence":"read"},{"id":"mcp-server-revision:assign","resourceKind":"mcp-server-revision","actions":["assign"],"evidence":"decision"},{"id":"mcp-server-revision:review","resourceKind":"mcp-server-revision","actions":["review"],"evidence":"decision"},{"id":"mcp-server-revision:publish","resourceKind":"mcp-server-revision","actions":["publish"],"evidence":"decision"},{"id":"mcp-server-revision:revoke","resourceKind":"mcp-server-revision","actions":["revoke"],"evidence":"decision"},{"id":"mcp-server-revision:use","resourceKind":"mcp-server-revision","actions":["use"],"evidence":"effect"},{"id":"mcp-tool-revision:discover","resourceKind":"mcp-tool-revision","actions":["discover"],"evidence":"read"},{"id":"mcp-tool-revision:read","resourceKind":"mcp-tool-revision","actions":["read"],"evidence":"read"},{"id":"mcp-tool-revision:assign","resourceKind":"mcp-tool-revision","actions":["assign"],"evidence":"decision"},{"id":"mcp-tool-revision:use","resourceKind":"mcp-tool-revision","actions":["use"],"evidence":"effect"},{"id":"mcp-tool-revision:invoke","resourceKind":"mcp-tool-revision","actions":["invoke"],"evidence":"effect"},{"id":"model-definition:discover","resourceKind":"model-definition","actions":["discover"],"evidence":"read"},{"id":"model-definition:read","resourceKind":"model-definition","actions":["read"],"evidence":"read"},{"id":"model-definition:assign","resourceKind":"model-definition","actions":["assign"],"evidence":"decision"},{"id":"model-definition:manage","resourceKind":"model-definition","actions":["manage"],"evidence":"decision"},{"id":"model-definition:administer","resourceKind":"model-definition","actions":["administer"],"evidence":"decision"},{"id":"model-definition:use","resourceKind":"model-definition","actions":["use"],"evidence":"effect"},{"id":"artifact:discover","resourceKind":"artifact","actions":["discover"],"evidence":"read"},{"id":"artifact:read","resourceKind":"artifact","actions":["read"],"evidence":"read"},{"id":"artifact:create","resourceKind":"artifact","actions":["create"],"evidence":"decision"},{"id":"artifact:edit","resourceKind":"artifact","actions":["edit"],"evidence":"decision"},{"id":"artifact:share","resourceKind":"artifact","actions":["share"],"evidence":"decision"},{"id":"artifact:delete","resourceKind":"artifact","actions":["delete"],"evidence":"decision"},{"id":"artifact:administer","resourceKind":"artifact","actions":["administer"],"evidence":"decision"},{"id":"artifact:use","resourceKind":"artifact","actions":["use"],"evidence":"effect"},{"id":"artifact-collection:create","resourceKind":"artifact-collection","actions":["create"],"evidence":"decision"},{"id":"artifact-revision:discover","resourceKind":"artifact-revision","actions":["discover"],"evidence":"read"},{"id":"artifact-revision:read","resourceKind":"artifact-revision","actions":["read"],"evidence":"read"},{"id":"artifact-revision:create","resourceKind":"artifact-revision","actions":["create"],"evidence":"decision"},{"id":"artifact-revision:edit","resourceKind":"artifact-revision","actions":["edit"],"evidence":"decision"},{"id":"artifact-revision:share","resourceKind":"artifact-revision","actions":["share"],"evidence":"decision"},{"id":"artifact-revision:delete","resourceKind":"artifact-revision","actions":["delete"],"evidence":"decision"},{"id":"artifact-revision:administer","resourceKind":"artifact-revision","actions":["administer"],"evidence":"decision"},{"id":"artifact-revision:use","resourceKind":"artifact-revision","actions":["use"],"evidence":"effect"},{"id":"dataset:discover","resourceKind":"dataset","actions":["discover"],"evidence":"read"},{"id":"dataset:read","resourceKind":"dataset","actions":["read"],"evidence":"read"},{"id":"dataset:create","resourceKind":"dataset","actions":["create"],"evidence":"decision"},{"id":"dataset:edit","resourceKind":"dataset","actions":["edit"],"evidence":"decision"},{"id":"dataset:share","resourceKind":"dataset","actions":["share"],"evidence":"decision"},{"id":"dataset:delete","resourceKind":"dataset","actions":["delete"],"evidence":"decision"},{"id":"dataset:administer","resourceKind":"dataset","actions":["administer"],"evidence":"decision"},{"id":"dataset:use","resourceKind":"dataset","actions":["use"],"evidence":"effect"},{"id":"memory-scope:read","resourceKind":"memory-scope","actions":["read"],"evidence":"read"},{"id":"memory-scope:share","resourceKind":"memory-scope","actions":["share"],"evidence":"decision"},{"id":"memory-scope:manage","resourceKind":"memory-scope","actions":["manage"],"evidence":"decision"},{"id":"memory-scope:forget","resourceKind":"memory-scope","actions":["forget"],"evidence":"decision"},{"id":"memory-scope:use","resourceKind":"memory-scope","actions":["use"],"evidence":"effect"},{"id":"persona:discover","resourceKind":"persona","actions":["discover"],"evidence":"read"},{"id":"persona:read","resourceKind":"persona","actions":["read"],"evidence":"read"},{"id":"persona:create","resourceKind":"persona","actions":["create"],"evidence":"decision"},{"id":"persona:edit","resourceKind":"persona","actions":["edit"],"evidence":"decision"},{"id":"persona:share","resourceKind":"persona","actions":["share"],"evidence":"decision"},{"id":"persona:delete","resourceKind":"persona","actions":["delete"],"evidence":"decision"},{"id":"persona:administer","resourceKind":"persona","actions":["administer"],"evidence":"decision"},{"id":"persona:use","resourceKind":"persona","actions":["use"],"evidence":"effect"},{"id":"conversation:discover","resourceKind":"conversation","actions":["discover"],"evidence":"read"},{"id":"conversation:read","resourceKind":"conversation","actions":["read"],"evidence":"read"},{"id":"conversation:create","resourceKind":"conversation","actions":["create"],"evidence":"decision"},{"id":"conversation:edit","resourceKind":"conversation","actions":["edit"],"evidence":"decision"},{"id":"conversation:share","resourceKind":"conversation","actions":["share"],"evidence":"decision"},{"id":"conversation:delete","resourceKind":"conversation","actions":["delete"],"evidence":"decision"},{"id":"conversation:administer","resourceKind":"conversation","actions":["administer"],"evidence":"decision"},{"id":"conversation:use","resourceKind":"conversation","actions":["use"],"evidence":"effect"},{"id":"conversation:delegate","resourceKind":"conversation","actions":["delegate"],"evidence":"effect"},{"id":"conversation-collection:create","resourceKind":"conversation-collection","actions":["create"],"evidence":"decision"},{"id":"channel-target:discover","resourceKind":"channel-target","actions":["discover"],"evidence":"read"},{"id":"channel-target:read","resourceKind":"channel-target","actions":["read"],"evidence":"read"},{"id":"channel-target:manage","resourceKind":"channel-target","actions":["manage"],"evidence":"decision"},{"id":"channel-target:administer","resourceKind":"channel-target","actions":["administer"],"evidence":"decision"},{"id":"channel-target:send","resourceKind":"channel-target","actions":["send"],"evidence":"effect"},{"id":"provider-connection:discover","resourceKind":"provider-connection","actions":["discover"],"evidence":"read"},{"id":"provider-connection:read","resourceKind":"provider-connection","actions":["read"],"evidence":"read"},{"id":"provider-connection:manage","resourceKind":"provider-connection","actions":["manage"],"evidence":"decision"},{"id":"provider-connection:administer","resourceKind":"provider-connection","actions":["administer"],"evidence":"decision"},{"id":"provider-connection:use","resourceKind":"provider-connection","actions":["use"],"evidence":"effect"},{"id":"schedule:discover","resourceKind":"schedule","actions":["discover"],"evidence":"read"},{"id":"schedule:read","resourceKind":"schedule","actions":["read"],"evidence":"read"},{"id":"schedule:create","resourceKind":"schedule","actions":["create"],"evidence":"decision"},{"id":"schedule:edit","resourceKind":"schedule","actions":["edit"],"evidence":"decision"},{"id":"schedule:schedule","resourceKind":"schedule","actions":["schedule"],"evidence":"decision"},{"id":"schedule:delete","resourceKind":"schedule","actions":["delete"],"evidence":"decision"},{"id":"schedule:administer","resourceKind":"schedule","actions":["administer"],"evidence":"decision"},{"id":"budget:read","resourceKind":"budget","actions":["read"],"evidence":"read"},{"id":"budget:manage","resourceKind":"budget","actions":["manage"],"evidence":"decision"},{"id":"budget:administer","resourceKind":"budget","actions":["administer"],"evidence":"decision"},{"id":"budget:use","resourceKind":"budget","actions":["use"],"evidence":"effect"},{"id":"audit-log:read","resourceKind":"audit-log","actions":["read"],"evidence":"read"},{"id":"token-usage:read","resourceKind":"token-usage","actions":["read"],"evidence":"read"},{"id":"third-party-source:discover","resourceKind":"third-party-source","actions":["discover"],"evidence":"read"},{"id":"third-party-source:read","resourceKind":"third-party-source","actions":["read"],"evidence":"read"},{"id":"third-party-source:create","resourceKind":"third-party-source","actions":["create"],"evidence":"decision"},{"id":"third-party-source:edit","resourceKind":"third-party-source","actions":["edit"],"evidence":"decision"},{"id":"third-party-source:share","resourceKind":"third-party-source","actions":["share"],"evidence":"decision"},{"id":"third-party-source:delete","resourceKind":"third-party-source","actions":["delete"],"evidence":"decision"},{"id":"third-party-source:administer","resourceKind":"third-party-source","actions":["administer"],"evidence":"decision"},{"id":"third-party-source:use","resourceKind":"third-party-source","actions":["use"],"evidence":"effect"},{"id":"resource-share:read","resourceKind":"resource-share","actions":["read"],"evidence":"read"},{"id":"resource-share:create","resourceKind":"resource-share","actions":["create"],"evidence":"decision"},{"id":"resource-share:edit","resourceKind":"resource-share","actions":["edit"],"evidence":"decision"},{"id":"resource-share:revoke","resourceKind":"resource-share","actions":["revoke"],"evidence":"decision"},{"id":"resource-share:administer","resourceKind":"resource-share","actions":["administer"],"evidence":"decision"},{"id":"group:discover","resourceKind":"group","actions":["discover"],"evidence":"read"},{"id":"group:read","resourceKind":"group","actions":["read"],"evidence":"read"},{"id":"group:create","resourceKind":"group","actions":["create"],"evidence":"decision"},{"id":"group:edit","resourceKind":"group","actions":["edit"],"evidence":"decision"},{"id":"group:delete","resourceKind":"group","actions":["delete"],"evidence":"decision"},{"id":"group:administer","resourceKind":"group","actions":["administer"],"evidence":"decision"},{"id":"organization-membership:read","resourceKind":"organization-membership","actions":["read"],"evidence":"read"},{"id":"organization-membership:create","resourceKind":"organization-membership","actions":["create"],"evidence":"decision"},{"id":"organization-membership:edit","resourceKind":"organization-membership","actions":["edit"],"evidence":"decision"},{"id":"organization-membership:revoke","resourceKind":"organization-membership","actions":["revoke"],"evidence":"decision"},{"id":"organization-membership:administer","resourceKind":"organization-membership","actions":["administer"],"evidence":"decision"},{"id":"mcp-task:read","resourceKind":"mcp-task","actions":["read"],"evidence":"read"},{"id":"mcp-task:edit","resourceKind":"mcp-task","actions":["edit"],"evidence":"decision"},{"id":"mcp-task:cancel","resourceKind":"mcp-task","actions":["cancel"],"evidence":"decision"},{"id":"persona-collection:create","resourceKind":"persona-collection","actions":["create"],"evidence":"decision"},{"id":"agent-service-collection:create","resourceKind":"agent-service-collection","actions":["create"],"evidence":"decision"}]'::jsonb,
    'system:central-authorization-migration'
);

-- Project current Owner/Admin roles into durable read and administration grants. Read-only
-- governance views use the Read grant; protected mutations admit the Administer grant.
INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
    "manager_id", "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", "resource_id", "effect", "priority", "require_approval", "created_by"
)
SELECT
    'central-org-admin-' || action."suffix" || '-' || principal."id", principal."silo_id", 'principal', NULL, principal."id",
    'personal', NULL, principal."id", 'exact', 'organization-membership-admin-bootstrap',
    'opencrane-product-authorization', 1, 'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821',
    action."capability_id", 'organization', principal."silo_id", 'allow', 0, FALSE,
    'system:central-authorization-migration'
FROM "principals" principal
JOIN "org_memberships" membership
  ON membership."cluster_tenant" = principal."silo_id"
 AND membership."subject" = principal."subject"
CROSS JOIN (VALUES
    ('read', 'organization:read'),
    ('administer', 'organization:administer')
) AS action("suffix", "capability_id")
WHERE membership."status" = 'active'::"OrgMemberStatus"
  AND membership."role" IN ('owner'::"OrgRole", 'admin'::"OrgRole");

-- Translate the legacy MCP-use grant into the two reviewed product actions now consumed by MCP.
INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
    "manager_id", "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", "resource_id", "effect", "priority", "valid_from", "expires_at",
    "revoked_at", "require_approval", "created_by", "created_at"
)
SELECT
    'central-mcp-' || action."suffix" || '-' || grant_row."id", grant_row."silo_id",
    grant_row."subject_kind", grant_row."subject_group_id", grant_row."subject_principal_id",
    grant_row."boundary_kind", grant_row."boundary_group_id", grant_row."boundary_principal_id",
    grant_row."boundary_coverage", grant_row."manager_id", 'opencrane-product-authorization', 1,
    'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821', action."capability_id",
    grant_row."resource_kind", grant_row."resource_id", grant_row."effect", grant_row."priority",
    grant_row."valid_from", grant_row."expires_at", grant_row."revoked_at", FALSE,
    grant_row."created_by", grant_row."created_at"
FROM "authorization_grants" grant_row
CROSS JOIN (VALUES
    ('discover', 'mcp-server:discover'),
    ('install', 'mcp-server:install')
) AS action("suffix", "capability_id")
WHERE grant_row."catalog_id" = 'opencrane-core'
  AND grant_row."catalog_revision" = 1
  AND grant_row."capability_id" = 'mcp-server:use'
  AND grant_row."resource_kind" = 'mcp-server';

-- Preserve the useful part of former skill ownership: authors can discover their skill and submit
-- its revisions for review. Ownership remains provenance; these grants become the actual authority.
INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
    "manager_id", "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", "resource_id", "effect", "priority", "require_approval", "created_by"
)
SELECT
    'central-skill-discover-' || skill."id", skill."silo_id", 'principal', NULL, skill."owner_principal_id",
    'personal', NULL, skill."owner_principal_id", 'exact', 'skill-owner-bootstrap',
    'opencrane-product-authorization', 1, 'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821',
    'skill:discover', 'skill', skill."id", 'allow', 10, FALSE, 'system:central-authorization-migration'
FROM "skills" skill;

INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
    "manager_id", "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", "resource_id", "effect", "priority", "require_approval", "created_by"
)
SELECT
    'central-skill-review-' || revision."id", skill."silo_id", 'principal', NULL, skill."owner_principal_id",
    'personal', NULL, skill."owner_principal_id", 'exact', 'skill-owner-bootstrap',
    'opencrane-product-authorization', 1, 'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821',
    'skill-revision:review', 'skill-revision', revision."id", 'allow', 10, FALSE,
    'system:central-authorization-migration'
FROM "skill_revisions" revision
JOIN "skills" skill ON skill."id" = revision."skill_id";

-- Preserve creator access to public MCP tasks that predate the central task resource. ToolInvocation
-- stays separate because a task waiting for required input does not have complete effect arguments.
INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
    "manager_id", "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", "resource_id", "effect", "priority", "require_approval", "created_by"
)
SELECT
    'central-mcp-task-' || action."suffix" || '-' || md5(task."id" || ':' || task."principal_id"),
    task."silo_id", 'principal', NULL, task."principal_id", 'personal', NULL, task."principal_id", 'exact',
    'mcp-task-creator-access', 'opencrane-product-authorization', 1,
    'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821',
    action."capability_id", 'mcp-task', task."id", 'allow', 0, FALSE, task."principal_id"
FROM "mcp_tasks" task
CROSS JOIN (VALUES
    ('read', 'mcp-task:read'),
    ('edit', 'mcp-task:edit'),
    ('cancel', 'mcp-task:cancel')
) AS action("suffix", "capability_id");

-- Abort instead of guessing when a durable conversation participant cannot be mapped to exactly
-- one local Principal. The runtime projection applies the same invariant to every new conversation.
DO $$
BEGIN
    IF EXISTS (
        SELECT participant."conversation_id", participant."user_id"
        FROM "conversation_participants" participant
        JOIN "conversations" conversation ON conversation."id" = participant."conversation_id"
        LEFT JOIN "principals" principal
          ON principal."silo_id" = conversation."silo_id"
         AND principal."subject" = participant."user_id"
        WHERE participant."access_ended_position" IS NULL
        GROUP BY participant."conversation_id", participant."user_id"
        HAVING COUNT(principal."id") <> 1
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'OC714',
            MESSAGE = 'central authorization migration cannot project an active conversation participant to exactly one Principal';
    END IF;
END $$;

-- Bootstrap only the three typed creation roots for current active members. Admission reconciliation
-- revokes these manager-owned rows before a suspended or missing member can reach product routes.
INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
    "manager_id", "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", "resource_id", "effect", "priority", "require_approval", "created_by"
)
SELECT
    'central-collection-' || root."suffix" || '-' || principal."id", principal."silo_id",
    'principal', NULL, principal."id", 'personal', NULL, principal."id", 'exact',
    'organization-membership-product-bootstrap', 'opencrane-product-authorization', 1,
    'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821',
    root."capability_id", root."resource_kind", principal."silo_id", 'allow', 0, FALSE, principal."id"
FROM "principals" principal
JOIN "org_memberships" membership
  ON membership."cluster_tenant" = principal."silo_id"
 AND membership."subject" = principal."subject"
CROSS JOIN (VALUES
    ('conversation', 'conversation-collection:create', 'conversation-collection'),
    ('artifact', 'artifact-collection:create', 'artifact-collection'),
    ('persona', 'persona-collection:create', 'persona-collection')
) AS root("suffix", "capability_id", "resource_kind")
WHERE membership."status" = 'active'::"OrgMemberStatus";

-- Abort instead of guessing when an existing personal Persona owner does not resolve to exactly
-- one local Principal. Runtime creation receives the admitted Principal directly.
DO $$
BEGIN
    IF EXISTS (
        SELECT profile."id"
        FROM "persona_profiles" profile
        LEFT JOIN "principals" principal
          ON principal."silo_id" = profile."silo_id"
         AND principal."subject" = profile."user_id"
        GROUP BY profile."id"
        HAVING COUNT(principal."id") <> 1
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'OC715',
            MESSAGE = 'central authorization migration cannot project an existing Persona owner to exactly one Principal';
    END IF;
END $$;

-- Project the durable Persona creator relation into the exact permissions used by onboarding and
-- execution. The relation remains owner evidence; these grants become product authority.
INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
    "manager_id", "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", "resource_id", "effect", "priority", "require_approval", "created_by"
)
SELECT
    'central-persona-' || action."suffix" || '-' || md5(profile."id" || ':' || principal."id"),
    profile."silo_id", 'principal', NULL, principal."id", 'personal', NULL, principal."id", 'exact',
    'persona-creator-access', 'opencrane-product-authorization', 1,
    'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821',
    action."capability_id", 'persona', profile."id", 'allow', 0, FALSE, principal."id"
FROM "persona_profiles" profile
JOIN "principals" principal
  ON principal."silo_id" = profile."silo_id"
 AND principal."subject" = profile."user_id"
CROSS JOIN (VALUES
    ('discover', 'persona:discover'),
    ('read', 'persona:read'),
    ('create', 'persona:create'),
    ('edit', 'persona:edit'),
    ('use', 'persona:use'),
    ('delete', 'persona:delete')
) AS action("suffix", "capability_id");

-- Project current participant visibility and ordinary interaction. Historical rows carry no
-- trustworthy creator coordinate, so this migration intentionally grants nobody Conversation/Delete.
INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
    "manager_id", "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", "resource_id", "effect", "priority", "require_approval", "created_by"
)
SELECT
    'central-conversation-' || action."suffix" || '-' || md5(conversation."id" || ':' || principal."id"),
    conversation."silo_id", 'principal'::"AuthorizationSubjectKind", NULL, principal."id",
    'personal'::"AuthorizationBoundaryKind", NULL, principal."id", 'exact'::"AuthorizationBoundaryCoverage",
    'conversation-participant-access', 'opencrane-product-authorization', 1,
    'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821',
    action."capability_id", 'conversation', conversation."id", 'allow', 0, FALSE, principal."id"
FROM "conversation_participants" participant
JOIN "conversations" conversation ON conversation."id" = participant."conversation_id"
JOIN "principals" principal
  ON principal."silo_id" = conversation."silo_id"
 AND principal."subject" = participant."user_id"
CROSS JOIN (VALUES
    ('discover', 'conversation:discover'),
    ('read', 'conversation:read'),
    ('edit', 'conversation:edit'),
    ('use', 'conversation:use')
) AS action("suffix", "capability_id")
WHERE participant."access_ended_position" IS NULL;

-- Grant ChannelTarget/Send only through a current open Agent-session participant relation and one
-- exact current service route. DISTINCT prevents duplicate grants when the same Principal has more
-- than one current conversation for the same AgentService.
INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
    "manager_id", "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", "resource_id", "effect", "priority", "require_approval", "created_by"
)
SELECT DISTINCT
    'central-channel-target-send-' || md5(route."id" || ':' || principal."id"),
    conversation."silo_id", 'principal'::"AuthorizationSubjectKind", NULL, principal."id",
    'personal'::"AuthorizationBoundaryKind", NULL, principal."id", 'exact'::"AuthorizationBoundaryCoverage",
    'channel-target-participant-access', 'opencrane-product-authorization', 1,
    'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821',
    'channel-target:send', 'channel-target', route."id", 'allow'::"AuthorizationEffect", 0, FALSE, principal."id"
FROM "conversation_participants" participant
JOIN "conversations" conversation ON conversation."id" = participant."conversation_id"
JOIN "principals" principal
  ON principal."silo_id" = conversation."silo_id"
 AND principal."subject" = participant."user_id"
JOIN "channel_runtime_routes" route
  ON route."silo_id" = conversation."silo_id"
 AND route."agent_service_id" = conversation."agent_service_id"
 AND route."action" = 'events.read'::"ChannelInvocationAction"
 AND route."is_current" = TRUE
 AND route."revoked_at" IS NULL
WHERE participant."access_ended_position" IS NULL
  AND conversation."mode" = 'agent_session'::"ConversationMode"
  AND conversation."lifecycle" = 'open'::"ConversationLifecycle";

-- Access-end writes already append their conversation timeline coordinate in a database trigger.
-- Revoke the matching route grant in that same transaction unless another current Agent session
-- still supports the same Principal-to-service relation.
CREATE FUNCTION "revoke_channel_target_grant_after_participant_access_end"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    participant_principal_id TEXT;
    principal_count INTEGER;
BEGIN
    IF OLD."access_ended_position" IS NULL AND NEW."access_ended_position" IS NOT NULL THEN
        SELECT min(principal."id"), count(principal."id")
          INTO participant_principal_id, principal_count
          FROM "principals" principal
          JOIN "conversations" conversation ON conversation."id" = NEW."conversation_id"
         WHERE principal."silo_id" = conversation."silo_id"
           AND principal."subject" = NEW."user_id";
        IF principal_count <> 1 THEN
            RAISE EXCEPTION 'ChannelTarget participant Principal projection is unavailable or ambiguous';
        END IF;

        UPDATE "authorization_grants" grant_row
           SET "revoked_at" = clock_timestamp()
          FROM "conversations" conversation, "channel_runtime_routes" route
         WHERE conversation."id" = NEW."conversation_id"
           AND route."silo_id" = conversation."silo_id"
           AND route."agent_service_id" = conversation."agent_service_id"
           AND grant_row."silo_id" = conversation."silo_id"
           AND grant_row."manager_id" = 'channel-target-participant-access'
           AND grant_row."subject_kind" = 'principal'
           AND grant_row."subject_principal_id" = participant_principal_id
           AND grant_row."resource_kind" = 'channel-target'
           AND grant_row."resource_id" = route."id"
           AND grant_row."revoked_at" IS NULL
           AND NOT EXISTS (
               SELECT 1
                 FROM "conversations" continuing_conversation
                 JOIN "conversation_participants" continuing_participant
                   ON continuing_participant."conversation_id" = continuing_conversation."id"
                WHERE continuing_conversation."silo_id" = conversation."silo_id"
                  AND continuing_conversation."agent_service_id" = conversation."agent_service_id"
                  AND continuing_conversation."mode" = 'agent_session'::"ConversationMode"
                  AND continuing_conversation."lifecycle" = 'open'::"ConversationLifecycle"
                  AND continuing_participant."user_id" = NEW."user_id"
                  AND continuing_participant."access_ended_position" IS NULL
           );
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "conversation_participants_channel_target_grant_revoke"
    AFTER UPDATE OF "access_ended_position" ON "conversation_participants"
    FOR EACH ROW EXECUTE FUNCTION "revoke_channel_target_grant_after_participant_access_end"();

-- Artifact ownership is a direct Principal foreign key, so it can be projected without inference.
INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
    "manager_id", "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", "resource_id", "effect", "priority", "require_approval", "created_by"
)
SELECT
    'central-artifact-' || action."suffix" || '-' || md5(artifact."id" || ':' || artifact."owner_principal_id"),
    artifact."silo_id", 'principal', NULL, artifact."owner_principal_id", 'personal', NULL,
    artifact."owner_principal_id", 'exact', 'artifact-owner-access', 'opencrane-product-authorization', 1,
    'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821',
    action."capability_id", 'artifact', artifact."id", 'allow', 0, FALSE, artifact."owner_principal_id"
FROM "artifacts" artifact
CROSS JOIN (VALUES
    ('discover', 'artifact:discover'),
    ('read', 'artifact:read'),
    ('create', 'artifact:create'),
    ('edit', 'artifact:edit')
) AS action("suffix", "capability_id");

-- Resource-share owners can read and revoke the share coordinate; each exact current recipient can
-- read it. Recipient removal revokes the linked central grant in the same transaction.
INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
    "manager_id", "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", "resource_id", "effect", "priority", "require_approval", "created_by"
)
SELECT
    'central-share-owner-' || action."suffix" || '-' || md5(share."id"), share."silo_id",
    'principal', NULL, share."owner_principal_id", 'personal', NULL, share."owner_principal_id", 'exact',
    'resource-share-access', 'opencrane-product-authorization', 1,
    'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821',
    action."capability_id", 'resource-share', share."id", 'allow', 0, FALSE, share."owner_principal_id"
FROM "resource_shares" share
CROSS JOIN (VALUES ('read', 'resource-share:read'), ('revoke', 'resource-share:revoke')) AS action("suffix", "capability_id");

INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
    "manager_id", "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", "resource_id", "effect", "priority", "require_approval", "created_by"
)
SELECT
    'central-share-recipient-' || md5(recipient."resource_share_id" || ':' || recipient."principal_id"),
    recipient."silo_id", 'principal', NULL, recipient."principal_id", 'personal', NULL,
    recipient."principal_id", 'exact', 'resource-share-recipient-access:' || recipient."principal_id", 'opencrane-product-authorization', 1,
    'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821',
    'resource-share:read', 'resource-share', recipient."resource_share_id", 'allow', 0, FALSE,
    recipient."granted_by_principal_id"
FROM "resource_share_recipients" recipient;

-- Abort instead of assigning an existing pending tool approval to an ambiguous local Principal.
-- Terminal and non-tool approvals do not need this deferred-tool projection.
DO $$
BEGIN
    IF EXISTS (
        SELECT approval."id"
        FROM "approval_requests" approval
        LEFT JOIN "principals" principal
          ON principal."silo_id" = approval."silo_id"
         AND principal."subject" = approval."subject_id"
        WHERE approval."state" = 'pending'::"ApprovalRequestState"
          AND approval."tool_invocation_row_id" IS NOT NULL
        GROUP BY approval."id"
        HAVING COUNT(principal."id") <> 1
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'OC716',
            MESSAGE = 'central authorization migration cannot project a pending tool approver to exactly one Principal';
    END IF;
END $$;

-- Preserve the assigned reviewer's current Read and Decide permissions for pending tool approvals.
-- Decision, expiry, or cancellation soft-revokes these manager-owned rows transactionally.
INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
    "manager_id", "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", "resource_id", "effect", "priority", "require_approval", "created_by"
)
SELECT
    'central-approval-' || action."suffix" || '-' || md5(approval."id" || ':' || principal."id"),
    approval."silo_id", 'principal', NULL, principal."id", 'personal', NULL, principal."id", 'exact',
    'deferred-tool-approval-assignee', 'opencrane-product-authorization', 1,
    'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821',
    action."capability_id", 'approval-request', approval."id", 'allow', 0, FALSE, principal."id"
FROM "approval_requests" approval
JOIN "principals" principal
  ON principal."silo_id" = approval."silo_id"
 AND principal."subject" = approval."subject_id"
CROSS JOIN (VALUES
    ('read', 'approval-request:read'),
    ('decide', 'approval-request:decide')
) AS action("suffix", "capability_id")
WHERE approval."state" = 'pending'::"ApprovalRequestState"
  AND approval."tool_invocation_row_id" IS NOT NULL;

-- Require complete immutable central decision evidence for every newly admitted external effect.
-- AgentRun work includes assignment fields; public MCP tasks bind the caller and admitted tool
-- decision without inventing run membership or workload-assignment evidence.
CREATE FUNCTION "enforce_tool_invocation_authorization_evidence"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    has_evidence BOOLEAN;
BEGIN
    IF TG_OP = 'UPDATE' AND (
        NEW."authorization_principal_id" IS DISTINCT FROM OLD."authorization_principal_id"
        OR NEW."authorization_actor_kind" IS DISTINCT FROM OLD."authorization_actor_kind"
        OR NEW."authorization_coordinates" IS DISTINCT FROM OLD."authorization_coordinates"
        OR NEW."authorization_decision_digests" IS DISTINCT FROM OLD."authorization_decision_digests"
        OR NEW."authorization_membership_revision" IS DISTINCT FROM OLD."authorization_membership_revision"
        OR NEW."authorization_assignment_digest" IS DISTINCT FROM OLD."authorization_assignment_digest"
        OR NEW."authorization_evidence_digest" IS DISTINCT FROM OLD."authorization_evidence_digest"
    ) THEN
        RAISE EXCEPTION 'ToolInvocation authorization evidence is immutable';
    END IF;

    has_evidence := NEW."authorization_principal_id" IS NOT NULL
        OR NEW."authorization_actor_kind" IS NOT NULL
        OR NEW."authorization_coordinates" IS NOT NULL
        OR cardinality(NEW."authorization_decision_digests") > 0
        OR NEW."authorization_membership_revision" IS NOT NULL
        OR NEW."authorization_assignment_digest" IS NOT NULL
        OR NEW."authorization_evidence_digest" IS NOT NULL;

    IF NEW."run_id" IS NULL THEN
        IF TG_OP = 'INSERT' OR has_evidence THEN
            IF NEW."authorization_principal_id" IS NULL
                OR btrim(NEW."authorization_principal_id") = ''
                OR NEW."authorization_actor_kind" IS DISTINCT FROM 'user'::"ToolInvocationAuthorizationActorKind"
                OR NEW."authorization_coordinates" IS NULL
                OR jsonb_typeof(NEW."authorization_coordinates") <> 'array'
                OR jsonb_array_length(NEW."authorization_coordinates") = 0
                OR NEW."authorization_decision_digests" IS NULL
                OR cardinality(NEW."authorization_decision_digests") = 0
                OR NEW."authorization_membership_revision" IS NOT NULL
                OR NEW."authorization_assignment_digest" IS NOT NULL
                OR NEW."authorization_evidence_digest" IS NULL
                OR NEW."authorization_evidence_digest" !~ '^sha256:[0-9a-f]{64}$'
                OR EXISTS (
                    SELECT 1 FROM unnest(NEW."authorization_decision_digests") AS digest
                    WHERE digest !~ '^sha256:[0-9a-f]{64}$'
                )
                OR EXISTS (
                    SELECT 1 FROM jsonb_array_elements(NEW."authorization_coordinates") AS coordinate
                    WHERE jsonb_typeof(coordinate) <> 'object'
                       OR jsonb_typeof(coordinate->'resource') <> 'object'
                       OR COALESCE(btrim(coordinate->'resource'->>'kind'), '') = ''
                       OR COALESCE(btrim(coordinate->'resource'->>'id'), '') = ''
                       OR COALESCE(btrim(coordinate->>'action'), '') = ''
                ) THEN
                RAISE EXCEPTION 'task-owned ToolInvocation requires complete central authorization evidence without AgentRun fields';
            END IF;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' OR has_evidence THEN
        IF NEW."authorization_principal_id" IS NULL
            OR btrim(NEW."authorization_principal_id") = ''
            OR NEW."authorization_actor_kind" IS NULL
            OR NEW."authorization_coordinates" IS NULL
            OR jsonb_typeof(NEW."authorization_coordinates") <> 'array'
            OR jsonb_array_length(NEW."authorization_coordinates") = 0
            OR NEW."authorization_decision_digests" IS NULL
            OR cardinality(NEW."authorization_decision_digests") = 0
            OR NEW."authorization_membership_revision" IS NULL
            OR NEW."authorization_membership_revision" < 1
            OR NEW."authorization_assignment_digest" IS NULL
            OR NEW."authorization_assignment_digest" !~ '^sha256:[0-9a-f]{64}$'
            OR NEW."authorization_evidence_digest" IS NULL
            OR NEW."authorization_evidence_digest" !~ '^sha256:[0-9a-f]{64}$'
            OR EXISTS (
                SELECT 1 FROM unnest(NEW."authorization_decision_digests") AS digest
                WHERE digest !~ '^sha256:[0-9a-f]{64}$'
            )
            OR EXISTS (
                SELECT 1 FROM jsonb_array_elements(NEW."authorization_coordinates") AS coordinate
                WHERE jsonb_typeof(coordinate) <> 'object'
                   OR jsonb_typeof(coordinate->'resource') <> 'object'
                   OR COALESCE(btrim(coordinate->'resource'->>'kind'), '') = ''
                   OR COALESCE(btrim(coordinate->'resource'->>'id'), '') = ''
                   OR COALESCE(btrim(coordinate->>'action'), '') = ''
            ) THEN
            RAISE EXCEPTION 'run-owned ToolInvocation requires complete central authorization evidence';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "tool_invocations_authorization_evidence" BEFORE INSERT OR UPDATE ON "tool_invocations" FOR EACH ROW EXECUTE FUNCTION "enforce_tool_invocation_authorization_evidence"();

COMMIT;
