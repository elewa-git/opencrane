-- Install the immutable central product-authorization catalogue used by transaction-bound grants.
BEGIN;

-- Admit the same managed runtime audience already accepted by WorkloadAssignment. The bootstrap
-- remains bound to the exact assignment identity, namespace, service account, and workload UID.
ALTER TABLE "workload_bootstraps" DROP CONSTRAINT "workload_bootstraps_audience_check";
ALTER TABLE "workload_bootstraps" ADD CONSTRAINT "workload_bootstraps_audience_check" CHECK ("audience" IN ('opencrane-agent-runtime', 'opencrane-managed-agent-runtime'));

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

-- Snapshot every pre-cutover approval and each elicitation it or a removed personal-memory
-- invocation owns. The snapshots keep this cleanup exact even if later statements admit new rows.
CREATE TEMP TABLE "precentral_approval_requests" (
    "id" TEXT PRIMARY KEY,
    "elicitation_request_id" TEXT
) ON COMMIT DROP;
INSERT INTO "precentral_approval_requests" ("id", "elicitation_request_id")
SELECT "id", "elicitation_request_id"
  FROM "approval_requests";

CREATE TEMP TABLE "precentral_elicitation_requests" (
    "id" TEXT PRIMARY KEY
) ON COMMIT DROP;
INSERT INTO "precentral_elicitation_requests" ("id")
SELECT DISTINCT "elicitation_request_id"
  FROM "precentral_approval_requests"
 WHERE "elicitation_request_id" IS NOT NULL;
INSERT INTO "precentral_elicitation_requests" ("id")
SELECT DISTINCT receipt."request_id"
  FROM "personal_memory_permission_receipts" receipt
  JOIN "precentral_tool_invocations" invocation ON invocation."id" = receipt."tool_invocation_id"
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "precentral_elicitation_requests" ("id")
SELECT request_row."id"
  FROM "elicitation_requests" request_row
  JOIN "precentral_tool_invocations" invocation
    ON invocation."id" = request_row."purpose_payload"->>'toolInvocationId'
 WHERE request_row."purpose" = 'personal_memory_permission'::"ElicitationPurpose"
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "precentral_elicitation_requests" ("id")
SELECT request_row."id"
  FROM "elicitation_requests" request_row
  JOIN "precentral_approval_requests" approval
    ON approval."id" = request_row."purpose_payload"->>'approvalRequestId'
 WHERE request_row."purpose" = 'tool_approval'::"ElicitationPurpose"
ON CONFLICT ("id") DO NOTHING;

DROP TRIGGER IF EXISTS "personal_memory_permission_receipts_authority" ON "personal_memory_permission_receipts";
DROP TRIGGER IF EXISTS "approval_requests_immutable" ON "approval_requests";
DROP TRIGGER IF EXISTS "elicitation_response_attempts_authority" ON "elicitation_response_attempts";
DROP TRIGGER IF EXISTS "elicitation_requests_authority" ON "elicitation_requests";
DROP TRIGGER IF EXISTS "mcp_runtime_executions_authority" ON "mcp_runtime_executions";
DROP TRIGGER IF EXISTS "tool_invocations_lifecycle_guard" ON "tool_invocations";
DROP TRIGGER IF EXISTS "authorization_grants_immutable" ON "authorization_grants";
DROP TRIGGER IF EXISTS "capability_catalog_revisions_immutable" ON "capability_catalog_revisions";
ALTER TABLE "authorization_grants" DROP COLUMN "require_approval";

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
 WHERE "tool_invocation_id" IN (SELECT "id" FROM "precentral_tool_invocations")
    OR "request_id" IN (SELECT "id" FROM "precentral_elicitation_requests");
DELETE FROM "elicitation_response_attempts"
 WHERE "request_id" IN (SELECT "id" FROM "precentral_elicitation_requests");
DELETE FROM "elicitation_result_deliveries"
 WHERE "request_id" IN (SELECT "id" FROM "precentral_elicitation_requests");
DELETE FROM "authorization_grants"
 WHERE "resource_kind" = 'approval-request';
DELETE FROM "approval_requests"
 WHERE "id" IN (SELECT "id" FROM "precentral_approval_requests");
DELETE FROM "elicitation_requests"
 WHERE "id" IN (SELECT "id" FROM "precentral_elicitation_requests");
DELETE FROM "tool_result_deliveries"
 WHERE "tool_invocation_id" IN (SELECT "id" FROM "precentral_tool_invocations");
DELETE FROM "mcp_runtime_executions"
 WHERE "tool_invocation_id" IN (SELECT "id" FROM "precentral_tool_invocations");
DELETE FROM "tool_invocations"
 WHERE "id" IN (SELECT "id" FROM "precentral_tool_invocations");

-- Make every post-cutover approval an exact deferred-tool approval. Capability coordinates already
-- live on the ToolInvocation authorization evidence and are not duplicated on its review row.
ALTER TABLE "approval_requests" DROP CONSTRAINT IF EXISTS "approval_requests_catalog_id_catalog_revision_catalog_dige_fkey";
ALTER TABLE "approval_requests" DROP CONSTRAINT IF EXISTS "approval_requests_exact_check";
ALTER TABLE "approval_requests" DROP CONSTRAINT IF EXISTS "approval_requests_decision_check";
ALTER TABLE "approval_requests" DROP COLUMN "catalog_id";
ALTER TABLE "approval_requests" DROP COLUMN "catalog_revision";
ALTER TABLE "approval_requests" DROP COLUMN "catalog_digest";
ALTER TABLE "approval_requests" DROP COLUMN "capability_id";
ALTER TABLE "approval_requests" DROP COLUMN "resume_token_hash";
ALTER TABLE "approval_requests" ALTER COLUMN "elicitation_request_id" SET NOT NULL;
ALTER TABLE "approval_requests" ALTER COLUMN "tool_invocation_row_id" SET NOT NULL;
ALTER TABLE "approval_requests" ALTER COLUMN "reviewed_tool_arguments" SET NOT NULL;
ALTER TABLE "approval_requests" ALTER COLUMN "reviewed_tool_schema" SET NOT NULL;
ALTER TABLE "approval_requests" ALTER COLUMN "reviewed_tool_schema_digest" SET NOT NULL;
ALTER TABLE "approval_requests" ALTER COLUMN "safe_proposed_arguments" SET NOT NULL;
ALTER TABLE "approval_requests" ALTER COLUMN "response_schema" SET NOT NULL;

ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_exact_check" CHECK (
    "attempt" > 0 AND btrim("agent_revision_id") <> '' AND btrim("agent_service_id") <> '' AND btrim("silo_id") <> '' AND
    "proof_key_thumbprint" ~ '^[A-Za-z0-9_-]{43}$' AND btrim("subject_id") <> '' AND
    btrim("workload_audience") <> '' AND btrim("service_account_name") <> '' AND btrim("namespace") <> '' AND
    btrim("workload_uid") <> '' AND btrim("pod_uid") <> '' AND
    btrim("resource_kind") NOT IN ('', '*') AND btrim("resource_id") NOT IN ('', '*') AND btrim("action") <> '' AND
    "arguments_digest" ~ '^sha256:[0-9a-f]{64}$' AND "action_digest" ~ '^sha256:[0-9a-f]{64}$' AND
    btrim("approver_policy_revision") <> '' AND "effective_policy_digest" ~ '^sha256:[0-9a-f]{64}$' AND
    "expires_at" > "created_at" AND btrim("elicitation_request_id") <> '' AND btrim("tool_invocation_row_id") <> '' AND
    "reviewed_tool_arguments" IS NOT NULL AND jsonb_typeof("reviewed_tool_arguments") = 'object' AND
    "reviewed_tool_schema" IS NOT NULL AND jsonb_typeof("reviewed_tool_schema") = 'object' AND
    "reviewed_tool_schema_digest" ~ '^sha256:[0-9a-f]{64}$' AND
    "safe_proposed_arguments" IS NOT NULL AND "response_schema" IS NOT NULL AND jsonb_typeof("response_schema") = 'object'
);
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decision_check" CHECK (
    ("state" = 'pending' AND "decided_at" IS NULL AND "decided_by" IS NULL AND "final_arguments" IS NULL AND "final_arguments_digest" IS NULL) OR
    ("state" = 'approved' AND "decided_at" IS NOT NULL AND "decided_by" IS NOT NULL AND btrim("decided_by") <> '' AND
     jsonb_typeof("final_arguments") = 'object' AND "final_arguments_digest" ~ '^sha256:[0-9a-f]{64}$') OR
    ("state" = 'denied' AND "decided_at" IS NOT NULL AND "decided_by" IS NOT NULL AND btrim("decided_by") <> '' AND
     "final_arguments" IS NULL AND "final_arguments_digest" IS NULL) OR
    ("state" = 'expired' AND "decided_at" IS NOT NULL AND "decided_by" IS NULL AND "final_arguments" IS NULL AND "final_arguments_digest" IS NULL) OR
    ("state" = 'cancelled' AND "decided_at" IS NOT NULL AND "decided_by" IS NULL AND "final_arguments" IS NULL AND "final_arguments_digest" IS NULL)
);

CREATE OR REPLACE FUNCTION "enforce_approval_request_update"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    decision_time TIMESTAMP(3) := clock_timestamp();
    current_attempt INTEGER;
    current_run_state "AgentRunState";
    assignment_state "WorkloadAssignmentState";
    assignment_expires_at TIMESTAMP(3);
    proof_expires_at TIMESTAMP(3);
    proof_revoked_at TIMESTAMP(3);
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW."state" <> 'pending' OR NEW."decided_at" IS NOT NULL
            OR NEW."decided_by" IS NOT NULL THEN
            RAISE EXCEPTION 'a new ApprovalRequest must begin pending';
        END IF;
        IF NEW."created_at" > decision_time OR NEW."expires_at" <= decision_time THEN
            RAISE EXCEPTION 'a new ApprovalRequest must have a current, future expiry';
        END IF;
        SELECT "attempt", "state" INTO current_attempt, current_run_state
        FROM "agent_runs" WHERE "id" = NEW."run_id" FOR UPDATE;
        SELECT "state", "expires_at" INTO assignment_state, assignment_expires_at
        FROM "workload_assignments"
        WHERE "run_id" = NEW."run_id" AND "attempt" = NEW."attempt"
          AND "agent_service_id" = NEW."agent_service_id" AND "agent_revision_id" = NEW."agent_revision_id"
          AND "silo_id" = NEW."silo_id" AND "subject_id" = NEW."subject_id"
          AND "audience" = NEW."workload_audience" AND "service_account_name" = NEW."service_account_name"
          AND "namespace" = NEW."namespace" AND "workload_kind" = NEW."workload_kind"
          AND "workload_uid" = NEW."workload_uid" AND "pod_uid" = NEW."pod_uid"
        FOR UPDATE;
        SELECT "expires_at", "revoked_at" INTO proof_expires_at, proof_revoked_at
        FROM "run_proof_keys"
        WHERE "id" = NEW."proof_key_id" AND "run_id" = NEW."run_id" AND "attempt" = NEW."attempt"
          AND "workload_kind" = NEW."workload_kind" AND "workload_uid" = NEW."workload_uid"
          AND "key_thumbprint" = NEW."proof_key_thumbprint" AND "pod_uid" = NEW."pod_uid"
        FOR UPDATE;
        IF current_attempt IS DISTINCT FROM NEW."attempt"
            OR current_run_state IS DISTINCT FROM 'waiting_for_input'::"AgentRunState"
            OR assignment_state IS DISTINCT FROM 'registered'::"WorkloadAssignmentState"
            OR assignment_expires_at <= decision_time OR proof_revoked_at IS NOT NULL
            OR proof_expires_at <= decision_time THEN
            RAISE EXCEPTION 'ApprovalRequest requires current WaitingForInput run, assignment, and proof authority';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ApprovalRequest rows cannot be deleted'; END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."run_id" IS DISTINCT FROM OLD."run_id"
        OR NEW."attempt" IS DISTINCT FROM OLD."attempt" OR NEW."agent_revision_id" IS DISTINCT FROM OLD."agent_revision_id"
        OR NEW."agent_service_id" IS DISTINCT FROM OLD."agent_service_id" OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id"
        OR NEW."proof_key_id" IS DISTINCT FROM OLD."proof_key_id" OR NEW."proof_key_thumbprint" IS DISTINCT FROM OLD."proof_key_thumbprint"
        OR NEW."subject_id" IS DISTINCT FROM OLD."subject_id" OR NEW."workload_audience" IS DISTINCT FROM OLD."workload_audience"
        OR NEW."service_account_name" IS DISTINCT FROM OLD."service_account_name" OR NEW."namespace" IS DISTINCT FROM OLD."namespace"
        OR NEW."workload_kind" IS DISTINCT FROM OLD."workload_kind" OR NEW."workload_uid" IS DISTINCT FROM OLD."workload_uid"
        OR NEW."pod_uid" IS DISTINCT FROM OLD."pod_uid" OR NEW."resource_kind" IS DISTINCT FROM OLD."resource_kind"
        OR NEW."resource_id" IS DISTINCT FROM OLD."resource_id" OR NEW."action" IS DISTINCT FROM OLD."action"
        OR NEW."arguments_digest" IS DISTINCT FROM OLD."arguments_digest" OR NEW."action_digest" IS DISTINCT FROM OLD."action_digest"
        OR NEW."approver_policy_revision" IS DISTINCT FROM OLD."approver_policy_revision"
        OR NEW."effective_policy_digest" IS DISTINCT FROM OLD."effective_policy_digest"
        OR NEW."elicitation_request_id" IS DISTINCT FROM OLD."elicitation_request_id"
        OR NEW."tool_invocation_row_id" IS DISTINCT FROM OLD."tool_invocation_row_id"
        OR NEW."reviewed_tool_arguments" IS DISTINCT FROM OLD."reviewed_tool_arguments"
        OR NEW."reviewed_tool_schema" IS DISTINCT FROM OLD."reviewed_tool_schema"
        OR NEW."reviewed_tool_schema_digest" IS DISTINCT FROM OLD."reviewed_tool_schema_digest"
        OR NEW."safe_proposed_arguments" IS DISTINCT FROM OLD."safe_proposed_arguments"
        OR NEW."response_schema" IS DISTINCT FROM OLD."response_schema"
        OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION 'ApprovalRequest proof and action bindings are immutable';
    END IF;
    IF OLD."state" <> 'pending' OR NEW."state" = 'pending' THEN
        RAISE EXCEPTION 'ApprovalRequest may be decided exactly once';
    END IF;
    IF NEW."state" = 'cancelled' THEN
        IF NEW."decided_at" IS NULL OR NEW."decided_at" > decision_time OR NEW."decided_at" < OLD."created_at" THEN
            RAISE EXCEPTION 'ApprovalRequest cancellation requires a caller-supplied decision time between creation and now';
        END IF;
    ELSE
        NEW."decided_at" := decision_time;
    END IF;
    IF NEW."state" IN ('approved', 'denied') THEN
        SELECT "attempt", "state" INTO current_attempt, current_run_state
        FROM "agent_runs" WHERE "id" = OLD."run_id" FOR UPDATE;
        SELECT "state", "expires_at" INTO assignment_state, assignment_expires_at
        FROM "workload_assignments"
        WHERE "run_id" = OLD."run_id" AND "attempt" = OLD."attempt"
          AND "agent_service_id" = OLD."agent_service_id" AND "agent_revision_id" = OLD."agent_revision_id"
          AND "silo_id" = OLD."silo_id" AND "subject_id" = OLD."subject_id"
          AND "audience" = OLD."workload_audience" AND "service_account_name" = OLD."service_account_name"
          AND "namespace" = OLD."namespace" AND "workload_kind" = OLD."workload_kind"
          AND "workload_uid" = OLD."workload_uid" AND "pod_uid" = OLD."pod_uid"
        FOR UPDATE;
        SELECT "expires_at", "revoked_at" INTO proof_expires_at, proof_revoked_at
        FROM "run_proof_keys" WHERE "id" = OLD."proof_key_id" FOR UPDATE;
        IF current_attempt IS DISTINCT FROM OLD."attempt"
            OR current_run_state IS DISTINCT FROM 'waiting_for_input'::"AgentRunState"
            OR assignment_state IS DISTINCT FROM 'registered'::"WorkloadAssignmentState"
            OR assignment_expires_at <= decision_time OR proof_revoked_at IS NOT NULL
            OR proof_expires_at <= decision_time THEN
            RAISE EXCEPTION 'ApprovalRequest decision authority is no longer current';
        END IF;
    END IF;
    IF NEW."state" = 'cancelled' THEN
        NEW."decided_by" := NULL;
    ELSIF NEW."state" = 'expired' THEN
        IF decision_time < OLD."expires_at" THEN
            RAISE EXCEPTION 'ApprovalRequest may expire only after its deadline';
        END IF;
    ELSIF NEW."state" IN ('approved', 'denied') AND decision_time >= OLD."expires_at" THEN
        RAISE EXCEPTION 'ApprovalRequest decisions must be recorded before expiry';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "tool_invocations_lifecycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "tool_invocations" FOR EACH ROW EXECUTE FUNCTION "enforce_tool_invocation_lifecycle"();
CREATE TRIGGER "mcp_runtime_executions_authority" BEFORE INSERT OR UPDATE OR DELETE ON "mcp_runtime_executions" FOR EACH ROW EXECUTE FUNCTION "enforce_mcp_runtime_execution_authority"();
CREATE TRIGGER "approval_requests_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "approval_requests" FOR EACH ROW EXECUTE FUNCTION "enforce_approval_request_update"();
CREATE TRIGGER "elicitation_requests_authority" BEFORE INSERT OR UPDATE OR DELETE ON "elicitation_requests" FOR EACH ROW EXECUTE FUNCTION "enforce_elicitation_request_authority"();
CREATE TRIGGER "elicitation_response_attempts_authority" BEFORE INSERT OR UPDATE OR DELETE ON "elicitation_response_attempts" FOR EACH ROW EXECUTE FUNCTION "enforce_elicitation_response_attempt_authority"();
CREATE TRIGGER "personal_memory_permission_receipts_authority" BEFORE INSERT OR UPDATE OR DELETE ON "personal_memory_permission_receipts" FOR EACH ROW EXECUTE FUNCTION "enforce_personal_memory_permission_authority"();
DO $$
DECLARE
    has_residue BOOLEAN;
BEGIN
    IF EXISTS (SELECT 1 FROM "tool_invocations" invocation JOIN "precentral_tool_invocations" legacy ON legacy."id" = invocation."id")
        OR EXISTS (SELECT 1 FROM "approval_requests" approval JOIN "precentral_approval_requests" legacy ON legacy."id" = approval."id")
        OR EXISTS (SELECT 1 FROM "tool_result_deliveries" delivery JOIN "precentral_tool_invocations" legacy ON legacy."id" = delivery."tool_invocation_id")
        OR EXISTS (SELECT 1 FROM "personal_memory_permission_receipts" receipt JOIN "precentral_tool_invocations" legacy ON legacy."id" = receipt."tool_invocation_id")
        OR EXISTS (SELECT 1 FROM "personal_memory_permission_receipts" receipt JOIN "precentral_elicitation_requests" legacy ON legacy."id" = receipt."request_id")
        OR EXISTS (SELECT 1 FROM "mcp_runtime_executions" execution JOIN "precentral_tool_invocations" legacy ON legacy."id" = execution."tool_invocation_id")
        OR EXISTS (SELECT 1 FROM "elicitation_response_attempts" attempt JOIN "precentral_elicitation_requests" legacy ON legacy."id" = attempt."request_id")
        OR EXISTS (SELECT 1 FROM "elicitation_result_deliveries" delivery JOIN "precentral_elicitation_requests" legacy ON legacy."id" = delivery."request_id")
        OR EXISTS (SELECT 1 FROM "elicitation_requests" request_row JOIN "precentral_elicitation_requests" legacy ON legacy."id" = request_row."id")
        OR EXISTS (SELECT 1 FROM "authorization_grants" grant_row WHERE grant_row."resource_kind" = 'approval-request') THEN
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
        ("kind" = 'set_byok_key'
            AND "payload" ?& ARRAY['provider', 'secretRef', 'litellmCredentialName']
            AND "payload" - ARRAY['provider', 'secretRef', 'litellmCredentialName'] = '{}'::jsonb
            AND jsonb_typeof("payload"->'provider') = 'string'
            AND jsonb_typeof("payload"->'secretRef') = 'string'
            AND jsonb_typeof("payload"->'litellmCredentialName') = 'string'
            AND COALESCE(btrim("payload"->>'provider'), '') <> ''
            AND COALESCE(btrim("payload"->>'secretRef'), '') <> ''
            AND COALESCE(btrim("payload"->>'litellmCredentialName'), '') <> '')
        OR ("kind" = 'delete_byok_key'
            AND "payload" ?& ARRAY['provider', 'secretRef', 'litellmCredentialName', 'litellmRegistered', 'modelDefinitionIds', 'deployments']
            AND "payload" - ARRAY['provider', 'secretRef', 'litellmCredentialName', 'litellmRegistered', 'modelDefinitionIds', 'deployments'] = '{}'::jsonb
            AND jsonb_typeof("payload"->'provider') = 'string'
            AND jsonb_typeof("payload"->'secretRef') = 'string'
            AND jsonb_typeof("payload"->'litellmCredentialName') = 'string'
            AND jsonb_typeof("payload"->'litellmRegistered') = 'boolean'
            AND jsonb_typeof("payload"->'modelDefinitionIds') = 'array'
            AND jsonb_typeof("payload"->'deployments') = 'array'
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

-- Keep revoked grant history outside the active-coordinate fence so the same exact authority can
-- be admitted again after a reviewed revocation.
DROP INDEX IF EXISTS "authorization_grant_exact_authority_key";
CREATE UNIQUE INDEX "authorization_grant_exact_authority_key" ON "authorization_grants"(
    "silo_id", "subject_kind", COALESCE("subject_group_id", ''), COALESCE("subject_principal_id", ''),
    "boundary_kind", COALESCE("boundary_group_id", ''), COALESCE("boundary_principal_id", ''), "boundary_coverage",
    "catalog_id", "catalog_revision", "capability_id", "resource_kind", COALESCE("resource_id", ''), "effect", "priority", COALESCE("manager_id", '')
) WHERE "revoked_at" IS NULL;

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

-- Reject any active membership whose issuer-independent subject does not resolve to exactly one
-- local Principal before membership-derived grants are projected.
DO $$
BEGIN
    IF EXISTS (
        SELECT membership."id"
          FROM "org_memberships" membership
          LEFT JOIN "principals" principal
            ON principal."silo_id" = membership."cluster_tenant"
           AND principal."subject" = membership."subject"
         WHERE membership."status" = 'active'::"OrgMemberStatus"
         GROUP BY membership."id"
        HAVING count(principal."id") <> 1
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'OC717',
            MESSAGE = 'central authorization migration cannot project an active organization membership to exactly one Principal';
    END IF;
END $$;

-- Project current Owner/Admin roles into durable read and administration grants. Read-only
-- governance views use the Read grant; protected mutations admit the Administer grant.
INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
    "manager_id", "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", "resource_id", "effect", "priority", "created_by"
)
SELECT
    'central-org-admin-' || action."suffix" || '-' || principal."id", principal."silo_id", 'principal', NULL, principal."id",
    'personal', NULL, principal."id", 'exact', 'organization-membership-admin-bootstrap:' || principal."id",
    'opencrane-product-authorization', 1, 'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821',
    action."capability_id", 'organization', principal."silo_id", 'allow', 0,
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

-- Give each active Owner and Admin exact Read and Use authority over every retained silo-global
-- provider connection. The cutover manager is principal-scoped and distinct from runtime creators.
INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
    "manager_id", "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", "resource_id", "effect", "priority", "created_by"
)
SELECT
    'central-provider-connection-' || action."suffix" || '-' || md5(credential."id" || ':' || principal."id"),
    credential."silo_id", 'principal', NULL, principal."id", 'personal', NULL, principal."id", 'exact',
    'provider-resource-0-10-cutover:' || principal."id", 'opencrane-product-authorization', 1,
    'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821',
    action."capability_id", 'provider-connection', credential."id", 'allow', 0,
    'system:central-authorization-migration'
FROM "provider_credentials" credential
JOIN "org_memberships" membership
  ON membership."cluster_tenant" = credential."silo_id"
 AND membership."status" = 'active'::"OrgMemberStatus"
 AND membership."role" IN ('owner'::"OrgRole", 'admin'::"OrgRole")
JOIN "principals" principal
  ON principal."silo_id" = membership."cluster_tenant"
 AND principal."subject" = membership."subject"
CROSS JOIN (VALUES
    ('read', 'provider-connection:read'),
    ('use', 'provider-connection:use')
) AS action("suffix", "capability_id")
WHERE credential."scope" = 'global'
  AND credential."cluster_tenant" IS NULL;

-- Give the same principals exact Read and Use authority over every retained silo-global model.
INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
    "manager_id", "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", "resource_id", "effect", "priority", "created_by"
)
SELECT
    'central-model-definition-' || action."suffix" || '-' || md5(definition."id" || ':' || principal."id"),
    definition."silo_id", 'principal', NULL, principal."id", 'personal', NULL, principal."id", 'exact',
    'provider-resource-0-10-cutover:' || principal."id", 'opencrane-product-authorization', 1,
    'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821',
    action."capability_id", 'model-definition', definition."id", 'allow', 0,
    'system:central-authorization-migration'
FROM "model_definitions" definition
JOIN "org_memberships" membership
  ON membership."cluster_tenant" = definition."silo_id"
 AND membership."status" = 'active'::"OrgMemberStatus"
 AND membership."role" IN ('owner'::"OrgRole", 'admin'::"OrgRole")
JOIN "principals" principal
  ON principal."silo_id" = membership."cluster_tenant"
 AND principal."subject" = membership."subject"
CROSS JOIN (VALUES
    ('read', 'model-definition:read'),
    ('use', 'model-definition:use')
) AS action("suffix", "capability_id")
WHERE definition."scope" = 'global'
  AND definition."cluster_tenant" IS NULL;

-- Translate the legacy MCP-use grant into the two reviewed product actions now consumed by MCP.
INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
    "manager_id", "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", "resource_id", "effect", "priority", "valid_from", "expires_at",
    "revoked_at", "created_by", "created_at"
)
SELECT
    'central-mcp-' || action."suffix" || '-' || grant_row."id", grant_row."silo_id",
    grant_row."subject_kind", grant_row."subject_group_id", grant_row."subject_principal_id",
    grant_row."boundary_kind", grant_row."boundary_group_id", grant_row."boundary_principal_id",
    grant_row."boundary_coverage", grant_row."manager_id", 'opencrane-product-authorization', 1,
    'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821', action."capability_id",
    grant_row."resource_kind", grant_row."resource_id", grant_row."effect", grant_row."priority",
    grant_row."valid_from", grant_row."expires_at", grant_row."revoked_at",
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

-- Remove the superseded legacy grants and catalogue after their typed replacements are durable.
DELETE FROM "authorization_grants"
WHERE "catalog_id" = 'opencrane-core'
  AND "catalog_revision" = 1
  AND "capability_id" = 'mcp-server:use'
  AND "resource_kind" = 'mcp-server';

DELETE FROM "capability_catalog_revisions"
WHERE "catalog_id" = 'opencrane-core'
  AND "revision" = 1;

-- Preserve the useful part of former skill ownership: authors can discover their skill and submit
-- its revisions for review. Ownership remains provenance; these grants become the actual authority.
INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
    "manager_id", "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", "resource_id", "effect", "priority", "created_by"
)
SELECT
    'central-skill-discover-' || skill."id", skill."silo_id", 'principal', NULL, skill."owner_principal_id",
    'personal', NULL, skill."owner_principal_id", 'exact', 'skill-owner-bootstrap',
    'opencrane-product-authorization', 1, 'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821',
    'skill:discover', 'skill', skill."id", 'allow', 10, 'system:central-authorization-migration'
FROM "skills" skill;

INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
    "manager_id", "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", "resource_id", "effect", "priority", "created_by"
)
SELECT
    'central-skill-review-' || revision."id", skill."silo_id", 'principal', NULL, skill."owner_principal_id",
    'personal', NULL, skill."owner_principal_id", 'exact', 'skill-owner-bootstrap',
    'opencrane-product-authorization', 1, 'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821',
    'skill-revision:review', 'skill-revision', revision."id", 'allow', 10,
    'system:central-authorization-migration'
FROM "skill_revisions" revision
JOIN "skills" skill ON skill."id" = revision."skill_id";

-- Preserve creator access to public MCP tasks that predate the central task resource. ToolInvocation
-- stays separate because a task waiting for required input does not have complete effect arguments.
INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
    "manager_id", "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", "resource_id", "effect", "priority", "created_by"
)
SELECT
    'central-mcp-task-' || action."suffix" || '-' || md5(task."id" || ':' || task."principal_id"),
    task."silo_id", 'principal', NULL, task."principal_id", 'personal', NULL, task."principal_id", 'exact',
    'mcp-task-creator-access', 'opencrane-product-authorization', 1,
    'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821',
    action."capability_id", 'mcp-task', task."id", 'allow', 0, task."principal_id"
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
    "resource_kind", "resource_id", "effect", "priority", "created_by"
)
SELECT
    'central-collection-' || root."suffix" || '-' || principal."id", principal."silo_id",
    'principal', NULL, principal."id", 'personal', NULL, principal."id", 'exact',
    'organization-membership-product-bootstrap:' || principal."id", 'opencrane-product-authorization', 1,
    'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821',
    root."capability_id", root."resource_kind", principal."silo_id", 'allow', 0, principal."id"
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
    "resource_kind", "resource_id", "effect", "priority", "created_by"
)
SELECT
    'central-persona-' || action."suffix" || '-' || md5(profile."id" || ':' || principal."id"),
    profile."silo_id", 'principal', NULL, principal."id", 'personal', NULL, principal."id", 'exact',
    'persona-creator-access', 'opencrane-product-authorization', 1,
    'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821',
    action."capability_id", 'persona', profile."id", 'allow', 0, principal."id"
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
    "resource_kind", "resource_id", "effect", "priority", "created_by"
)
SELECT
    'central-conversation-' || action."suffix" || '-' || md5(conversation."id" || ':' || principal."id"),
    conversation."silo_id", 'principal'::"AuthorizationSubjectKind", NULL, principal."id",
    'personal'::"AuthorizationBoundaryKind", NULL, principal."id", 'exact'::"AuthorizationBoundaryCoverage",
    'conversation-participant-access', 'opencrane-product-authorization', 1,
    'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821',
    action."capability_id", 'conversation', conversation."id", 'allow', 0, principal."id"
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
    "resource_kind", "resource_id", "effect", "priority", "created_by"
)
SELECT DISTINCT
    'central-channel-target-send-' || md5(route."id" || ':' || principal."id"),
    conversation."silo_id", 'principal'::"AuthorizationSubjectKind", NULL, principal."id",
    'personal'::"AuthorizationBoundaryKind", NULL, principal."id", 'exact'::"AuthorizationBoundaryCoverage",
    'channel-target-participant-access', 'opencrane-product-authorization', 1,
    'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821',
    'channel-target:send', 'channel-target', route."id", 'allow'::"AuthorizationEffect", 0, principal."id"
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
    "resource_kind", "resource_id", "effect", "priority", "created_by"
)
SELECT
    'central-artifact-' || action."suffix" || '-' || md5(artifact."id" || ':' || artifact."owner_principal_id"),
    artifact."silo_id", 'principal', NULL, artifact."owner_principal_id", 'personal', NULL,
    artifact."owner_principal_id", 'exact', 'artifact-owner-access', 'opencrane-product-authorization', 1,
    'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821',
    action."capability_id", 'artifact', artifact."id", 'allow', 0, artifact."owner_principal_id"
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
    "resource_kind", "resource_id", "effect", "priority", "created_by"
)
SELECT
    'central-share-owner-' || action."suffix" || '-' || md5(share."id"), share."silo_id",
    'principal', NULL, share."owner_principal_id", 'personal', NULL, share."owner_principal_id", 'exact',
    'resource-share-access', 'opencrane-product-authorization', 1,
    'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821',
    action."capability_id", 'resource-share', share."id", 'allow', 0, share."owner_principal_id"
FROM "resource_shares" share
CROSS JOIN (VALUES ('read', 'resource-share:read'), ('revoke', 'resource-share:revoke')) AS action("suffix", "capability_id");

INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
    "manager_id", "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", "resource_id", "effect", "priority", "created_by"
)
SELECT
    'central-share-recipient-' || md5(recipient."resource_share_id" || ':' || recipient."principal_id"),
    recipient."silo_id", 'principal', NULL, recipient."principal_id", 'personal', NULL,
    recipient."principal_id", 'exact', 'resource-share-recipient-access:' || recipient."principal_id", 'opencrane-product-authorization', 1,
    'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821',
    'resource-share:read', 'resource-share', recipient."resource_share_id", 'allow', 0,
    recipient."granted_by_principal_id"
FROM "resource_share_recipients" recipient;

-- Allocate the participant access-end timeline position before validating its read cursor. Runtime
-- callers submit zero as a database-allocation sentinel, so comparing the cursor to that sentinel
-- would reject every legitimate access-end transition before the database could replace it.
CREATE OR REPLACE FUNCTION "enforce_conversation_participant_coordinates"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    conversation_lifecycle "ConversationLifecycle";
    next_position BIGINT;
    last_position BIGINT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'ConversationParticipant rows cannot be deleted';
    END IF;
    SELECT "lifecycle", COALESCE((
        SELECT max(entry."position") + 1
        FROM "conversation_timeline_entries" entry
        WHERE entry."conversation_id" = conversation."id"
    ), 1)
    INTO conversation_lifecycle, next_position
    FROM "conversations" conversation
    WHERE conversation."id" = NEW."conversation_id"
    FOR UPDATE;
    IF conversation_lifecycle IS NULL THEN
        RAISE EXCEPTION 'ConversationParticipant requires its exact Conversation';
    END IF;
    last_position := next_position - 1;
    IF TG_OP = 'INSERT' THEN
        IF conversation_lifecycle <> 'open' THEN
            RAISE EXCEPTION 'participants cannot join a closed Conversation';
        END IF;
        NEW."visible_from_position" := next_position;
        NEW."read_through_position" := last_position;
        IF NEW."access_ended_position" IS NOT NULL OR NEW."archived_at" IS NOT NULL THEN
            RAISE EXCEPTION 'new ConversationParticipant must begin with current, unarchived access';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW."conversation_id" IS DISTINCT FROM OLD."conversation_id"
        OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
        OR NEW."visible_from_position" IS DISTINCT FROM OLD."visible_from_position"
        OR NEW."joined_at" IS DISTINCT FROM OLD."joined_at" THEN
        RAISE EXCEPTION 'ConversationParticipant join authority is immutable';
    END IF;
    IF NEW."read_through_position" < NEW."visible_from_position" - 1
        OR NEW."read_through_position" > last_position THEN
        RAISE EXCEPTION 'ConversationParticipant read position is outside its visible timeline';
    END IF;
    IF OLD."access_ended_position" IS NOT NULL
        AND NEW."access_ended_position" IS DISTINCT FROM OLD."access_ended_position" THEN
        RAISE EXCEPTION 'ConversationParticipant access end is immutable';
    END IF;
    IF OLD."access_ended_position" IS NULL AND NEW."access_ended_position" IS NOT NULL THEN
        IF NEW."access_ended_position" <> 0 THEN
            RAISE EXCEPTION 'ConversationParticipant access end position is database allocated';
        END IF;
        INSERT INTO "conversation_timeline_entries" (
            "conversation_id", "kind", "membership_event_id", "participant_user_id", "payload"
        ) VALUES (
            NEW."conversation_id", 'membership', 'access-ended:' || NEW."user_id", NEW."user_id",
            jsonb_build_object('action', 'access_ended', 'userId', NEW."user_id")
        ) RETURNING "position" INTO NEW."access_ended_position";
    END IF;
    IF NEW."access_ended_position" IS NOT NULL
        AND NEW."read_through_position" >= NEW."access_ended_position" THEN
        RAISE EXCEPTION 'ConversationParticipant cannot read at or beyond its access end';
    END IF;
    RETURN NEW;
END;
$$;

-- Allow cancellation to revoke either an unconsumed or consumed bootstrap without changing the
-- immutable identity or exactly-once consumption evidence.
CREATE OR REPLACE FUNCTION "enforce_workload_bootstrap_consumption"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    assignment_pod_uid TEXT;
    assignment_state "WorkloadAssignmentState";
    run_state "AgentRunState";
    transition_time TIMESTAMP(3) := clock_timestamp();
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW."consumed_at" IS NOT NULL OR NEW."consumed_by_pod_uid" IS NOT NULL
            OR NEW."receipt_id" IS NOT NULL OR NEW."revoked_at" IS NOT NULL THEN
            RAISE EXCEPTION 'a new WorkloadBootstrap must begin unconsumed and unrevoked';
        END IF;
        SELECT "state" INTO run_state
        FROM "agent_runs"
        WHERE "id" = NEW."run_id" AND "attempt" = NEW."attempt"
        FOR UPDATE;
        IF run_state IS DISTINCT FROM 'assigned'::"AgentRunState" THEN
            RAISE EXCEPTION 'a new WorkloadBootstrap requires the current Assigned attempt';
        END IF;
        SELECT "state" INTO assignment_state
        FROM "workload_assignments"
        WHERE "run_id" = NEW."run_id" AND "attempt" = NEW."attempt"
          AND "agent_service_id" = NEW."agent_service_id"
          AND "agent_revision_id" = NEW."agent_revision_id"
          AND "silo_id" = NEW."silo_id" AND "subject_id" = NEW."subject_id"
          AND "audience" = NEW."audience"
          AND "service_account_name" = NEW."service_account_name"
          AND "namespace" = NEW."namespace" AND "workload_kind" = NEW."workload_kind"
          AND "workload_uid" = NEW."workload_uid"
        FOR UPDATE;
        IF assignment_state IS DISTINCT FROM 'pending_pod'::"WorkloadAssignmentState" THEN
            RAISE EXCEPTION 'a new WorkloadBootstrap requires its PendingPod assignment';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'WorkloadBootstrap rows cannot be deleted'; END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."run_id" IS DISTINCT FROM OLD."run_id"
        OR NEW."attempt" IS DISTINCT FROM OLD."attempt"
        OR NEW."generation" IS DISTINCT FROM OLD."generation"
        OR NEW."agent_service_id" IS DISTINCT FROM OLD."agent_service_id"
        OR NEW."agent_revision_id" IS DISTINCT FROM OLD."agent_revision_id"
        OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id" OR NEW."subject_id" IS DISTINCT FROM OLD."subject_id"
        OR NEW."audience" IS DISTINCT FROM OLD."audience"
        OR NEW."service_account_name" IS DISTINCT FROM OLD."service_account_name"
        OR NEW."namespace" IS DISTINCT FROM OLD."namespace"
        OR NEW."workload_kind" IS DISTINCT FROM OLD."workload_kind"
        OR NEW."workload_uid" IS DISTINCT FROM OLD."workload_uid"
        OR NEW."claim_digest" IS DISTINCT FROM OLD."claim_digest"
        OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION 'WorkloadBootstrap identity is immutable';
    END IF;
    IF OLD."revoked_at" IS NOT NULL THEN
        IF NEW."consumed_at" IS DISTINCT FROM OLD."consumed_at"
            OR NEW."consumed_by_pod_uid" IS DISTINCT FROM OLD."consumed_by_pod_uid"
            OR NEW."receipt_id" IS DISTINCT FROM OLD."receipt_id" THEN
            RAISE EXCEPTION 'a revoked WorkloadBootstrap cannot be consumed';
        END IF;
        IF NEW."revoked_at" IS DISTINCT FROM OLD."revoked_at" THEN
            RAISE EXCEPTION 'WorkloadBootstrap revocation is irreversible';
        END IF;
        RAISE EXCEPTION 'WorkloadBootstrap is already revoked';
    END IF;
    IF NEW."revoked_at" IS NOT NULL THEN
        IF NEW."consumed_at" IS DISTINCT FROM OLD."consumed_at"
            OR NEW."consumed_by_pod_uid" IS DISTINCT FROM OLD."consumed_by_pod_uid"
            OR NEW."receipt_id" IS DISTINCT FROM OLD."receipt_id" THEN
            RAISE EXCEPTION 'a revoked WorkloadBootstrap cannot be consumed';
        END IF;
        IF NEW."revoked_at" < OLD."created_at" OR NEW."revoked_at" > transition_time
            OR (OLD."consumed_at" IS NOT NULL AND NEW."revoked_at" < OLD."consumed_at") THEN
            RAISE EXCEPTION 'WorkloadBootstrap revocation time must be current';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD."consumed_at" IS NOT NULL OR NEW."consumed_at" IS NULL
        OR NEW."consumed_by_pod_uid" IS NULL OR NEW."receipt_id" IS NULL THEN
        RAISE EXCEPTION 'WorkloadBootstrap may be consumed exactly once';
    END IF;
    IF NEW."consumed_at" < OLD."created_at" OR NEW."consumed_at" > transition_time
        OR NEW."consumed_at" >= OLD."expires_at" OR transition_time >= OLD."expires_at" THEN
        RAISE EXCEPTION 'WorkloadBootstrap must be consumed at a current time before expiry';
    END IF;
    SELECT "state" INTO run_state
    FROM "agent_runs"
    WHERE "id" = NEW."run_id" AND "attempt" = NEW."attempt"
    FOR UPDATE;
    IF run_state IS DISTINCT FROM 'assigned'::"AgentRunState" THEN
        RAISE EXCEPTION 'WorkloadBootstrap consumption requires the current Assigned attempt';
    END IF;
    SELECT "state", "pod_uid" INTO assignment_state, assignment_pod_uid
    FROM "workload_assignments"
    WHERE "run_id" = NEW."run_id" AND "attempt" = NEW."attempt"
    FOR UPDATE;
    IF assignment_state IS DISTINCT FROM 'registered'::"WorkloadAssignmentState"
        OR assignment_pod_uid IS DISTINCT FROM NEW."consumed_by_pod_uid" THEN
        RAISE EXCEPTION 'bootstrap consumer Pod is not the registered assignment Pod';
    END IF;
    RETURN NEW;
END;
$$;

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

-- Bind durable run events and child deliveries to the attempt that produced them. This pre-1.0 upgrade
-- backfills attempt 1 only when the existing rows prove that coordinate; retry history and rows from
-- the removed child-delivery timeline relation require a database reset.
DO $attempt_backfill_guard$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "conversation_run_events" event
        JOIN "agent_runs" run ON run."id" = event."run_id"
        WHERE run."attempt" > 1
    ) THEN
        RAISE EXCEPTION 'OC_RUN_EVENT_ATTEMPT_BACKFILL_RESET_REQUIRED: attemptless RunEvent history belongs to a retried AgentRun';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM "conversation_timeline_entries"
        WHERE "parent_delivery_child_run_id" IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'OC_CHILD_DELIVERY_TIMELINE_RESET_REQUIRED: callerless child parent-delivery timeline history cannot be migrated';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM "child_run_completion_deliveries" delivery
        WHERE delivery."outcome" = 'delivered'
          AND NOT EXISTS (
              SELECT 1
              FROM "conversation_run_events" event
              WHERE event."run_id" = delivery."parent_run_id"
                AND event."sequence" = delivery."parent_event_sequence"
                AND event."type" IN ('child.run.completed', 'child.run.failed', 'child.run.cancelled')
                AND event."payload"->>'childRunId' = delivery."child_run_id"
                AND CASE
                    WHEN event."payload"->>'childAttempt' ~ '^[1-9][0-9]{0,9}$'
                    THEN (event."payload"->>'childAttempt')::NUMERIC <= 2147483647
                    ELSE FALSE
                END
          )
    ) THEN
        RAISE EXCEPTION 'OC_CHILD_DELIVERY_ATTEMPT_BACKFILL_RESET_REQUIRED: delivered child history lacks exact attempt evidence';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM "child_run_completion_deliveries" delivery
        JOIN "agent_runs" child ON child."id" = delivery."child_run_id"
        JOIN "agent_runs" parent ON parent."id" = delivery."parent_run_id"
        WHERE delivery."outcome" <> 'delivered'
          AND (child."attempt" <> 1 OR parent."attempt" <> 1)
    ) THEN
        RAISE EXCEPTION 'OC_CHILD_DELIVERY_ATTEMPT_BACKFILL_RESET_REQUIRED: suppressed child history belongs to a retried AgentRun';
    END IF;
END;
$attempt_backfill_guard$;

ALTER TABLE "conversation_timeline_entries" DROP CONSTRAINT IF EXISTS "conversation_timeline_entries_parent_delivery_child_run_id_fkey";
DROP INDEX IF EXISTS "conversation_timeline_entries_parent_delivery_child_run_id_key";
ALTER TABLE "conversation_timeline_entries" DROP CONSTRAINT "conversation_timeline_entries_reference_shape_check";
ALTER TABLE "conversation_timeline_entries" DROP COLUMN "parent_delivery_child_run_id";

DROP TRIGGER "conversation_run_events_append_only" ON "conversation_run_events";
ALTER TABLE "conversation_run_events" ADD COLUMN "attempt" INTEGER;
UPDATE "conversation_run_events" SET "attempt" = 1;
ALTER TABLE "conversation_run_events" ALTER COLUMN "attempt" SET NOT NULL;
ALTER TABLE "conversation_run_events" DROP CONSTRAINT "conversation_run_events_sequence_check";
ALTER TABLE "conversation_run_events" ADD CONSTRAINT "conversation_run_events_attempt_sequence_check" CHECK ("attempt" > 0 AND "sequence" > 0);
DROP INDEX "conversation_run_events_run_id_message_id_idx";
DROP INDEX "conversation_run_events_one_message_start";
CREATE INDEX "conversation_run_events_run_id_attempt_message_id_idx" ON "conversation_run_events"("run_id", "attempt", "message_id");
CREATE UNIQUE INDEX "conversation_run_events_one_message_start" ON "conversation_run_events"("run_id", "attempt", "message_id") WHERE "type" = 'message.started';
CREATE UNIQUE INDEX "conversation_run_events_conversation_id_run_id_attempt_sequ_key" ON "conversation_run_events"("conversation_id", "run_id", "attempt", "sequence");

DO $asset_attempt_guard$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "conversation_assets" asset
        JOIN "conversation_run_events" event
          ON event."conversation_id" = asset."conversation_id"
         AND event."run_id" = asset."run_id"
         AND event."sequence" = asset."run_event_sequence"
        WHERE asset."run_event_sequence" IS NOT NULL
          AND asset."run_attempt" IS DISTINCT FROM event."attempt"
    ) OR EXISTS (
        SELECT 1
        FROM "conversation_asset_output_tickets" ticket
        JOIN "conversation_run_events" event
          ON event."conversation_id" = ticket."conversation_id"
         AND event."run_id" = ticket."run_id"
         AND event."sequence" = ticket."run_event_sequence"
        WHERE ticket."run_attempt" IS DISTINCT FROM event."attempt"
    ) THEN
        RAISE EXCEPTION 'OC_ASSET_RUN_EVENT_ATTEMPT_RESET_REQUIRED: asset evidence disagrees with its exact RunEvent attempt';
    END IF;
END;
$asset_attempt_guard$;

ALTER TABLE "conversation_assets" DROP CONSTRAINT IF EXISTS "conversation_assets_conversation_id_run_id_run_event_sequence_fkey";
ALTER TABLE "conversation_assets" DROP CONSTRAINT IF EXISTS "conversation_assets_conversation_id_run_id_run_event_seque_fkey";
ALTER TABLE "conversation_asset_output_tickets" DROP CONSTRAINT IF EXISTS "conversation_asset_output_tickets_conversation_id_run_id_run_event_sequence_fkey";
ALTER TABLE "conversation_asset_output_tickets" DROP CONSTRAINT IF EXISTS "conversation_asset_output_tickets_conversation_id_run_id_r_fkey";
ALTER TABLE "conversation_assets" ADD CONSTRAINT "conversation_assets_conversation_id_run_id_run_attempt_run_fkey" FOREIGN KEY ("conversation_id", "run_id", "run_attempt", "run_event_sequence") REFERENCES "conversation_run_events"("conversation_id", "run_id", "attempt", "sequence") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversation_asset_output_tickets" ADD CONSTRAINT "conversation_asset_output_tickets_conversation_id_run_id_r_fkey" FOREIGN KEY ("conversation_id", "run_id", "run_attempt", "run_event_sequence") REFERENCES "conversation_run_events"("conversation_id", "run_id", "attempt", "sequence") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TRIGGER "child_run_completion_deliveries_authority" ON "child_run_completion_deliveries";
ALTER TABLE "child_run_completion_deliveries" ADD COLUMN "child_attempt" INTEGER;
ALTER TABLE "child_run_completion_deliveries" ADD COLUMN "parent_attempt" INTEGER;
UPDATE "child_run_completion_deliveries" delivery
SET "child_attempt" = (event."payload"->>'childAttempt')::INTEGER,
    "parent_attempt" = event."attempt"
FROM "conversation_run_events" event
WHERE delivery."outcome" = 'delivered'
  AND event."run_id" = delivery."parent_run_id"
  AND event."sequence" = delivery."parent_event_sequence"
  AND event."type" IN ('child.run.completed', 'child.run.failed', 'child.run.cancelled')
  AND event."payload"->>'childRunId' = delivery."child_run_id";
UPDATE "child_run_completion_deliveries"
SET "child_attempt" = 1, "parent_attempt" = 1
WHERE "outcome" <> 'delivered';
ALTER TABLE "child_run_completion_deliveries" ALTER COLUMN "child_attempt" SET NOT NULL;
ALTER TABLE "child_run_completion_deliveries" ALTER COLUMN "parent_attempt" SET NOT NULL;
ALTER TABLE "child_run_completion_deliveries" DROP CONSTRAINT "child_run_completion_deliveries_pkey";
ALTER TABLE "child_run_completion_deliveries" ADD CONSTRAINT "child_run_completion_deliveries_pkey" PRIMARY KEY ("child_run_id", "child_attempt", "parent_attempt");
DROP INDEX "child_run_completion_deliveries_parent_run_id_idx";
CREATE INDEX "child_run_completion_deliveries_parent_run_id_parent_attemp_idx" ON "child_run_completion_deliveries"("parent_run_id", "parent_attempt");
CREATE UNIQUE INDEX "child_run_completion_deliveries_one_delivery_per_attempt" ON "child_run_completion_deliveries"("child_run_id", "child_attempt") WHERE "outcome" = 'delivered';
ALTER TABLE "child_run_completion_deliveries" ADD CONSTRAINT "child_run_completion_deliveries_attempt_check" CHECK ("child_attempt" > 0 AND "parent_attempt" > 0);

ALTER TABLE "conversation_timeline_entries" ADD CONSTRAINT "conversation_timeline_entries_reference_shape_check" CHECK (
        ("kind" = 'message' AND "message_id" IS NOT NULL AND "run_id" IS NULL AND "run_event_sequence" IS NULL
            AND "membership_event_id" IS NULL AND "participant_user_id" IS NULL AND "system_event_id" IS NULL
            AND "parent_delivery_agent_thread_id" IS NULL AND "payload" IS NULL) OR
        ("kind" = 'run_event' AND "message_id" IS NULL AND "run_id" IS NOT NULL AND "run_event_sequence" IS NOT NULL
            AND "membership_event_id" IS NULL AND "participant_user_id" IS NULL AND "system_event_id" IS NULL
            AND "parent_delivery_agent_thread_id" IS NULL AND "payload" IS NULL) OR
        ("kind" = 'membership' AND "message_id" IS NULL AND "run_id" IS NULL AND "run_event_sequence" IS NULL
            AND "membership_event_id" IS NOT NULL AND btrim("membership_event_id") <> '' AND "participant_user_id" IS NOT NULL
            AND btrim("participant_user_id") <> '' AND "system_event_id" IS NULL AND "parent_delivery_agent_thread_id" IS NULL
            AND jsonb_typeof("payload") = 'object') OR
        ("kind" = 'system' AND "message_id" IS NULL AND "run_id" IS NULL AND "run_event_sequence" IS NULL
            AND "membership_event_id" IS NULL AND "participant_user_id" IS NULL AND "system_event_id" IS NOT NULL
            AND btrim("system_event_id") <> '' AND "parent_delivery_agent_thread_id" IS NULL AND jsonb_typeof("payload") = 'object') OR
        ("kind" = 'parent_delivery' AND "message_id" IS NULL AND "run_id" IS NULL AND "run_event_sequence" IS NULL
            AND "membership_event_id" IS NULL AND "participant_user_id" IS NULL AND "system_event_id" IS NULL
            AND "parent_delivery_agent_thread_id" IS NOT NULL AND btrim("parent_delivery_agent_thread_id") <> '' AND "payload" IS NULL)
    );

CREATE OR REPLACE FUNCTION "enforce_conversation_run_event_append"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    previous_sequence INTEGER;
    terminal_exists BOOLEAN;
    current_attempt INTEGER;
    run_state "AgentRunState";
    run_conversation_id TEXT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW."run_id", 0));
    SELECT "attempt", "state", "conversation_id" INTO current_attempt, run_state, run_conversation_id
    FROM "agent_runs" WHERE "id" = NEW."run_id" FOR UPDATE;
    IF run_state IS NULL THEN RAISE EXCEPTION 'RunEvent run does not exist'; END IF;
    IF run_conversation_id IS NULL THEN RAISE EXCEPTION 'RunEvent requires a conversation-bound AgentRun'; END IF;
    IF NEW."conversation_id" IS DISTINCT FROM run_conversation_id THEN
        RAISE EXCEPTION 'RunEvent must bind the exact AgentRun Conversation';
    END IF;
    IF NEW."attempt" IS DISTINCT FROM current_attempt THEN
        RAISE EXCEPTION 'RunEvent must bind the current AgentRun attempt';
    END IF;
    SELECT COALESCE(MAX("sequence"), 0),
           COALESCE(bool_or("type" IN ('run.completed', 'run.failed', 'run.cancelled')) FILTER (WHERE "attempt" = NEW."attempt"), false)
      INTO previous_sequence, terminal_exists
      FROM "conversation_run_events" WHERE "run_id" = NEW."run_id";
    IF terminal_exists THEN
        RAISE EXCEPTION 'RunEvent attempt stream is terminal';
    END IF;
    IF NEW."sequence" <> previous_sequence + 1 THEN
        RAISE EXCEPTION 'RunEvent sequence must be contiguous';
    END IF;
    IF NEW."type" = 'run.completed' AND run_state <> 'completed' THEN
        RAISE EXCEPTION 'run.completed event requires Completed AgentRun authority';
    ELSIF NEW."type" = 'run.failed' AND run_state <> 'failed' THEN
        RAISE EXCEPTION 'run.failed event requires Failed AgentRun authority';
    ELSIF NEW."type" = 'run.cancelled' AND run_state <> 'cancelled' THEN
        RAISE EXCEPTION 'run.cancelled event requires Cancelled AgentRun authority';
    ELSIF NEW."type" NOT IN ('run.completed', 'run.failed', 'run.cancelled') AND run_state IN ('completed', 'failed', 'cancelled') THEN
        RAISE EXCEPTION 'terminal AgentRun accepts only its matching terminal event';
    END IF;
    IF NEW."type" IN ('child.run.completed', 'child.run.failed', 'child.run.cancelled') AND NOT EXISTS (
        SELECT 1
        FROM "child_run_completion_deliveries" delivery
        JOIN "agent_runs" child ON child."id" = delivery."child_run_id"
        WHERE delivery."child_run_id" = NEW."payload"->>'childRunId'
          AND delivery."child_attempt"::TEXT = NEW."payload"->>'childAttempt'
          AND delivery."parent_run_id" = NEW."run_id"
          AND delivery."parent_attempt" = NEW."attempt"
          AND delivery."parent_event_sequence" = NEW."sequence"
          AND delivery."outcome" = 'delivered'
          AND child."attempt" = delivery."child_attempt"
          AND ((NEW."type" = 'child.run.completed' AND child."state" = 'completed') OR (NEW."type" = 'child.run.failed' AND child."state" = 'failed') OR (NEW."type" = 'child.run.cancelled' AND child."state" = 'cancelled'))
    ) THEN
        RAISE EXCEPTION 'child RunEvent requires child completion delivery authority';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "enforce_conversation_timeline_entry"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    conversation_lifecycle "ConversationLifecycle";
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'ConversationTimelineEntry rows are append-only';
    END IF;
    IF NEW."position" <> 0 THEN
        RAISE EXCEPTION 'ConversationTimelineEntry position is database allocated';
    END IF;
    IF NEW."kind" = 'message' THEN
        IF NEW."message_id" IS NULL OR NEW."run_id" IS NOT NULL OR NEW."run_event_sequence" IS NOT NULL
            OR NEW."membership_event_id" IS NOT NULL OR NEW."participant_user_id" IS NOT NULL
            OR NEW."system_event_id" IS NOT NULL OR NEW."parent_delivery_agent_thread_id" IS NOT NULL
            OR NEW."payload" IS NOT NULL THEN
            RAISE EXCEPTION 'message timeline entry requires only exact Message provenance';
        END IF;
    ELSIF NEW."kind" = 'run_event' THEN
        IF NEW."message_id" IS NOT NULL OR NEW."run_id" IS NULL OR NEW."run_event_sequence" IS NULL
            OR NEW."membership_event_id" IS NOT NULL OR NEW."participant_user_id" IS NOT NULL
            OR NEW."system_event_id" IS NOT NULL OR NEW."parent_delivery_agent_thread_id" IS NOT NULL
            OR NEW."payload" IS NOT NULL THEN
            RAISE EXCEPTION 'run-event timeline entry requires only exact RunEvent provenance';
        END IF;
    ELSIF NEW."kind" = 'membership' THEN
        IF NEW."message_id" IS NOT NULL OR NEW."run_id" IS NOT NULL OR NEW."run_event_sequence" IS NOT NULL
            OR NEW."membership_event_id" IS NULL OR NEW."participant_user_id" IS NULL
            OR NEW."system_event_id" IS NOT NULL OR NEW."parent_delivery_agent_thread_id" IS NOT NULL
            OR jsonb_typeof(NEW."payload") IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'membership timeline entry requires only exact participant event provenance';
        END IF;
        IF NEW."payload"->>'action' NOT IN ('joined', 'access_ended')
            OR NEW."payload"->>'userId' IS DISTINCT FROM NEW."participant_user_id" THEN
            RAISE EXCEPTION 'membership timeline payload must bind its exact participant action';
        END IF;
    ELSIF NEW."kind" = 'system' THEN
        IF NEW."message_id" IS NOT NULL OR NEW."run_id" IS NOT NULL OR NEW."run_event_sequence" IS NOT NULL
            OR NEW."membership_event_id" IS NOT NULL OR NEW."participant_user_id" IS NOT NULL
            OR NEW."system_event_id" IS NULL OR NEW."parent_delivery_agent_thread_id" IS NOT NULL
            OR jsonb_typeof(NEW."payload") IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'system timeline entry requires only exact system event provenance';
        END IF;
    ELSIF NEW."kind" = 'parent_delivery' THEN
        IF NEW."message_id" IS NOT NULL OR NEW."run_id" IS NOT NULL OR NEW."run_event_sequence" IS NOT NULL
            OR NEW."membership_event_id" IS NOT NULL OR NEW."participant_user_id" IS NOT NULL
            OR NEW."system_event_id" IS NOT NULL OR NEW."parent_delivery_agent_thread_id" IS NULL
            OR NEW."payload" IS NOT NULL THEN
            RAISE EXCEPTION 'parent-delivery timeline entry requires only exact delivery provenance';
        END IF;
        IF NOT EXISTS (
            SELECT 1
            FROM "agent_thread_parent_deliveries" delivery
            WHERE delivery."id" = NEW."parent_delivery_agent_thread_id"
              AND delivery."parent_conversation_id" = NEW."conversation_id"
        ) THEN
            RAISE EXCEPTION 'Agent-thread delivery timeline entry requires exact immediate-parent authority';
        END IF;
    ELSE
        RAISE EXCEPTION 'unsupported ConversationTimelineEntry kind';
    END IF;
    SELECT "lifecycle" INTO conversation_lifecycle
    FROM "conversations"
    WHERE "id" = NEW."conversation_id"
    FOR UPDATE;
    IF conversation_lifecycle IS NULL OR conversation_lifecycle <> 'open' THEN
        RAISE EXCEPTION 'ConversationTimelineEntry requires an open Conversation';
    END IF;
    SELECT COALESCE(max("position"), 0) + 1 INTO NEW."position"
    FROM "conversation_timeline_entries"
    WHERE "conversation_id" = NEW."conversation_id";
    NEW."occurred_at" := date_trunc('milliseconds', clock_timestamp())::TIMESTAMP(3);
    UPDATE "conversations"
    SET "updated_at" = NEW."occurred_at",
        "activity_sequence" = DEFAULT
    WHERE "id" = NEW."conversation_id";
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "enforce_child_run_completion_delivery"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    child_attempt INTEGER;
    child_parent_run_id TEXT;
    child_root_run_id TEXT;
    child_silo_id TEXT;
    child_state "AgentRunState";
    reservation_parent_run_id TEXT;
    reservation_root_run_id TEXT;
    parent_attempt INTEGER;
    parent_silo_id TEXT;
    parent_root_run_id TEXT;
    parent_conversation_id TEXT;
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'child completion deliveries are append-only'; END IF;
    SELECT "attempt", "parent_run_id", "root_run_id", "silo_id", "state"
    INTO child_attempt, child_parent_run_id, child_root_run_id, child_silo_id, child_state
    FROM "agent_runs" WHERE "id" = NEW."child_run_id" FOR UPDATE;
    IF child_parent_run_id IS NULL OR child_state NOT IN ('completed', 'failed', 'cancelled') THEN RAISE EXCEPTION 'child completion delivery requires terminal child authority'; END IF;
    SELECT "parent_run_id", "root_run_id" INTO reservation_parent_run_id, reservation_root_run_id FROM "child_run_reservations" WHERE "child_run_id" = NEW."child_run_id" FOR UPDATE;
    SELECT "attempt", "silo_id", "root_run_id", "conversation_id"
    INTO parent_attempt, parent_silo_id, parent_root_run_id, parent_conversation_id
    FROM "agent_runs" WHERE "id" = NEW."parent_run_id" FOR UPDATE;
    IF NEW."child_attempt" IS DISTINCT FROM child_attempt OR NEW."parent_attempt" IS DISTINCT FROM parent_attempt THEN
        RAISE EXCEPTION 'child completion delivery must bind the current child and parent attempts';
    END IF;
    IF reservation_parent_run_id IS NULL OR parent_silo_id IS NULL OR NEW."parent_run_id" <> child_parent_run_id OR reservation_parent_run_id <> child_parent_run_id OR reservation_root_run_id <> child_root_run_id OR parent_silo_id <> child_silo_id OR parent_root_run_id <> child_root_run_id THEN RAISE EXCEPTION 'child completion delivery lineage mismatch'; END IF;
    IF NEW."outcome" = 'delivered' THEN
        IF parent_conversation_id IS NULL OR NEW."parent_event_sequence" IS NULL THEN RAISE EXCEPTION 'delivered child completion requires a parent conversation stream and event sequence'; END IF;
    ELSIF NEW."outcome" = 'no_parent_stream' THEN
        IF parent_conversation_id IS NOT NULL OR NEW."parent_event_sequence" IS NOT NULL THEN RAISE EXCEPTION 'no_parent_stream outcome requires no parent conversation stream'; END IF;
    ELSE
        IF NEW."parent_event_sequence" IS NOT NULL OR NOT EXISTS (
            SELECT 1 FROM "conversation_run_events"
            WHERE "run_id" = NEW."parent_run_id" AND "attempt" = NEW."parent_attempt"
              AND "type" IN ('run.completed', 'run.failed', 'run.cancelled')
        ) THEN RAISE EXCEPTION 'parent_stream_terminal outcome requires terminal parent attempt stream'; END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "enforce_child_run_completion_delivery_event"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    child_state "AgentRunState";
    expected_event_type TEXT;
BEGIN
    IF NEW."outcome" <> 'delivered' THEN RETURN NULL; END IF;
    SELECT "state" INTO child_state FROM "agent_runs" WHERE "id" = NEW."child_run_id" AND "attempt" = NEW."child_attempt";
    expected_event_type := CASE child_state WHEN 'completed' THEN 'child.run.completed' WHEN 'failed' THEN 'child.run.failed' ELSE 'child.run.cancelled' END;
    IF NOT EXISTS (
        SELECT 1 FROM "conversation_run_events"
        WHERE "run_id" = NEW."parent_run_id" AND "attempt" = NEW."parent_attempt"
          AND "sequence" = NEW."parent_event_sequence" AND "type" = expected_event_type
          AND "payload"->>'childRunId' = NEW."child_run_id"
          AND "payload"->>'childAttempt' = NEW."child_attempt"::TEXT
    ) THEN RAISE EXCEPTION 'delivered child completion requires exact parent attempt event'; END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION "enforce_terminal_agent_run_event"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    expected_type TEXT;
BEGIN
    IF NEW."conversation_id" IS NULL OR NEW."state" NOT IN ('completed', 'failed', 'cancelled') THEN RETURN NULL; END IF;
    expected_type := CASE NEW."state" WHEN 'completed' THEN 'run.completed' WHEN 'failed' THEN 'run.failed' ELSE 'run.cancelled' END;
    IF NOT EXISTS (SELECT 1 FROM "conversation_run_events" WHERE "run_id" = NEW."id" AND "attempt" = NEW."attempt" AND "type" = expected_type) THEN
        RAISE EXCEPTION 'terminal conversation AgentRun requires its matching terminal RunEvent';
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER "conversation_run_events_append_only" BEFORE UPDATE OR DELETE ON "conversation_run_events"
    FOR EACH ROW EXECUTE FUNCTION "reject_conversation_immutable_mutation"();
CREATE TRIGGER "child_run_completion_deliveries_authority" BEFORE INSERT OR UPDATE OR DELETE ON "child_run_completion_deliveries"
    FOR EACH ROW EXECUTE FUNCTION "enforce_child_run_completion_delivery"();
CREATE TRIGGER "tool_invocations_authorization_evidence" BEFORE INSERT OR UPDATE ON "tool_invocations" FOR EACH ROW EXECUTE FUNCTION "enforce_tool_invocation_authorization_evidence"();
CREATE TRIGGER "authorization_grants_immutable" BEFORE UPDATE OR DELETE ON "authorization_grants" FOR EACH ROW EXECUTE FUNCTION "enforce_authorization_grant_update"();
CREATE TRIGGER "capability_catalog_revisions_immutable" BEFORE UPDATE OR DELETE ON "capability_catalog_revisions" FOR EACH ROW EXECUTE FUNCTION "reject_capability_catalog_revision_mutation"();

COMMIT;
