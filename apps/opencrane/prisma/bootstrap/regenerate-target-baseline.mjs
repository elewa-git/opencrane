#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const baselinePath = resolve(import.meta.dirname, "target-baseline.sql");
const current = readFileSync(baselinePath, "utf8");
let generated;
const checkOnly = process.argv.includes("--check");
const suppliedGeneratedPath = process.argv.slice(2).find(function _GeneratedPath(argument) { return argument !== "--check"; });
if (suppliedGeneratedPath !== undefined)
{
	generated = readFileSync(resolve(suppliedGeneratedPath), "utf8").trimEnd();
}
else
{
	const temporaryDirectory = mkdtempSync(join(tmpdir(), "opencrane-prisma-baseline-"));
	const generatedPath = join(temporaryDirectory, "prisma.sql");
	try
	{
		execFileSync("npx", ["prisma", "migrate", "diff", "--from-empty", "--to-schema-datamodel", "prisma/schema", "--script", "--output", generatedPath], {
			cwd: resolve(import.meta.dirname, "../.."),
			stdio: "inherit",
		});
		generated = readFileSync(generatedPath, "utf8").trimEnd();
	}
	finally
	{
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
}

function _ReplaceExactlyOnce(source, search, replacement, label)
{
	if (source.split(search).length !== 2)
	{
		throw new Error(`Prisma SQL must contain exactly one ${label}`);
	}
	return source.replace(search, replacement);
}

let normalizedGenerated = _ReplaceExactlyOnce(
	generated,
	'    CONSTRAINT "model_definitions_pkey" PRIMARY KEY ("id")\n);',
	'    CONSTRAINT "model_definitions_pkey" PRIMARY KEY ("id"),\n    CONSTRAINT "model_definitions_generated_output_capabilities_check" CHECK ("generated_output_capabilities" <@ ARRAY[\'image_png\', \'code_execution_files\']::TEXT[])\n);',
	"model definition primary key",
);
normalizedGenerated = _ReplaceExactlyOnce(
	normalizedGenerated,
	'CREATE INDEX "authorization_grants_catalog_id_catalog_revision_capability_idx" ON "authorization_grants"("catalog_id", "catalog_revision", "capability_id");',
	'CREATE INDEX "authorization_grants_catalog_id_catalog_revision_capability_idx" ON "authorization_grants"("catalog_id", "catalog_revision", "capability_id");\n\nCREATE UNIQUE INDEX "authorization_grant_exact_authority_key" ON "authorization_grants"(\n  "silo_id", "subject_kind", COALESCE("subject_group_id", \'\'), COALESCE("subject_principal_id", \'\'),\n  "boundary_kind", COALESCE("boundary_group_id", \'\'), COALESCE("boundary_principal_id", \'\'), "boundary_coverage",\n  "catalog_id", "catalog_revision", "capability_id", "resource_kind", COALESCE("resource_id", \'\'), "effect", "priority", COALESCE("manager_id", \'\')\n) WHERE "revoked_at" IS NULL;',
	"authorization grant catalogue index",
);
normalizedGenerated = _ReplaceExactlyOnce(
	normalizedGenerated,
	'CREATE UNIQUE INDEX "model_definitions_silo_id_scope_cluster_tenant_public_model_key" ON "model_definitions"("silo_id", "scope", "cluster_tenant", "public_model_name");',
	'CREATE UNIQUE INDEX "model_definitions_silo_id_scope_cluster_tenant_public_model_key" ON "model_definitions"("silo_id", "scope", "cluster_tenant", "public_model_name");\n\nCREATE UNIQUE INDEX "provider_credentials_global_provider_key" ON "provider_credentials"("silo_id", "provider") WHERE "scope" = \'global\' AND "cluster_tenant" IS NULL;\n\nCREATE UNIQUE INDEX "model_definitions_global_public_model_name_key" ON "model_definitions"("silo_id", "public_model_name") WHERE "scope" = \'global\' AND "cluster_tenant" IS NULL;\n\nCREATE UNIQUE INDEX "model_definitions_global_default_key" ON "model_definitions"("silo_id") WHERE "scope" = \'global\' AND "cluster_tenant" IS NULL AND "is_default";\n\nCREATE UNIQUE INDEX "model_routing_defaults_global_key" ON "model_routing_defaults"("silo_id") WHERE "scope" = \'global\' AND "cluster_tenant" IS NULL;',
	"silo-local global provider and model-routing authority indexes",
);
normalizedGenerated = _ReplaceExactlyOnce(
	normalizedGenerated,
	'CREATE INDEX "conversation_computer_active_leases_expires_at_idx" ON "conversation_computer_active_leases"("expires_at");',
	'CREATE INDEX "conversation_computer_active_leases_expires_at_idx" ON "conversation_computer_active_leases"("expires_at");\n\nALTER TABLE "conversation_computer_active_leases" ADD CONSTRAINT "conversation_computer_active_leases_exact_check" CHECK (\n  btrim("computer_id") <> \'\' AND btrim("silo_id") <> \'\' AND btrim("conversation_id") <> \'\' AND\n  btrim("agent_identity_id") <> \'\' AND btrim("lease_id") <> \'\' AND "lease_generation" > 0\n);',
	"active conversation computer lease constraint",
);

function _Between(source, start, end, label)
{
	const startIndex = source.indexOf(start);
	const endIndex = source.indexOf(end, startIndex + start.length);
	if (startIndex < 0 || endIndex < 0)
	{
		throw new Error(`target baseline is missing the ${label} preservation markers`);
	}
	return source.slice(startIndex + start.length, endIndex).trim();
}

const mcpConstraintStart = "ALTER TABLE \"mcp_servers\" ADD CONSTRAINT \"mcp_servers_registration_digest_check\"";
const snapshotConstraintStart = "-- Null-safe immutable run/snapshot binding.";
const authorityMarker = "-- Database-native authority guards omitted by Prisma schema diff.";

function _StartingAt(source, start, end, label)
{
	const startIndex = source.indexOf(start);
	const endIndex = source.indexOf(end, startIndex + start.length);
	if (startIndex < 0 || endIndex < 0)
	{
		throw new Error(`target baseline is missing the ${label} preservation markers`);
	}
	return source.slice(startIndex, endIndex).trim();
}

function _RemoveGeneratedNamedStatements(source, generatedSql, pattern, generatedMarker)
{
	return source.replace(pattern, function _Statement(statement, name)
	{
		return generatedSql.includes(generatedMarker(name)) ? "" : statement;
	});
}

function _RemoveGeneratedObjects(source, generatedSql)
{
	let preserved = _RemoveGeneratedNamedStatements(source, generatedSql, /CREATE TYPE "([^"]+)"[\s\S]*?;\n*/gmu, function _Type(name) { return `CREATE TYPE "${name}"`; });
	preserved = _RemoveGeneratedNamedStatements(preserved, generatedSql, /CREATE TABLE "([^"]+)"[\s\S]*?;\n*/gmu, function _Table(name) { return `CREATE TABLE "${name}"`; });
	preserved = _RemoveGeneratedNamedStatements(preserved, generatedSql, /CREATE (?:UNIQUE )?INDEX "([^"]+)"[\s\S]*?;\n*/gmu, function _Index(name) { return `INDEX "${name}"`; });
	preserved = _RemoveGeneratedNamedStatements(preserved, generatedSql, /ALTER TABLE [\s\S]*? ADD CONSTRAINT "([^"]+)"[\s\S]*?;\n*/gmu, function _Constraint(name) { return `ADD CONSTRAINT "${name}"`; });
	return preserved.trim();
}

const mcpConstraints = _RemoveGeneratedObjects(_StartingAt(current, mcpConstraintStart, snapshotConstraintStart, "MCP and OCI constraint"), normalizedGenerated);
const snapshotConstraints = _RemoveGeneratedObjects(_StartingAt(current, snapshotConstraintStart, authorityMarker, "cross-domain constraint"), normalizedGenerated);
const authorityIndex = current.indexOf(authorityMarker);
if (authorityIndex < 0)
{
	throw new Error("target baseline is missing the authority guard marker");
}
let authoritySql = _RemoveGeneratedObjects(current.slice(authorityIndex), normalizedGenerated);
// Keep this accepted catalogue addition bound to the same canonical digest the TypeScript authority uses.
authoritySql = authoritySql.replace(/(capability-catalog-opencrane-product-authorization-v1'[\s\S]*?\n    )'sha256:[0-9a-f]{64}'(,\n    )'(\[[^\n]*\])'::jsonb/u, function _StandingApprovalCapabilities(_seed, prefix, separator, payload)
{
	const capabilities = JSON.parse(payload);
	for (const capability of [
		{ id: "tool-approval-scope:read", resourceKind: "tool-approval-scope", actions: ["read"], evidence: "read" },
		{ id: "tool-approval-scope:revoke", resourceKind: "tool-approval-scope", actions: ["revoke"], evidence: "decision" },
	])
	{
		if (!capabilities.some(existing => existing.id === capability.id))
			capabilities.splice(capabilities.findIndex(existing => existing.id === "skill:discover"), 0, capability);
	}
	const canonical = function _Canonical(value)
	{
		if (value === null || typeof value !== "object")
			return JSON.stringify(value);
		if (Array.isArray(value))
			return `[${value.map(_Canonical).join(",")}]`;
		return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${_Canonical(value[key])}`).join(",")}}`;
	};
	const digest = `sha256:${createHash("sha256").update(canonical(capabilities)).digest("hex")}`;
	return `${prefix}'${digest}'${separator}'${JSON.stringify(capabilities)}'::jsonb`;
});
const approvalAuthority = `CREATE FUNCTION "enforce_approval_request_update"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    decision_time TIMESTAMP(3) := clock_timestamp();
    current_run "agent_runs"%ROWTYPE;
    current_invocation "tool_invocations"%ROWTYPE;
    bound_request "approval_requests"%ROWTYPE;
    admitted_stop_cleanup BOOLEAN := FALSE;
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ApprovalRequest rows cannot be deleted'; END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."run_id" IS DISTINCT FROM OLD."run_id"
            OR NEW."attempt" IS DISTINCT FROM OLD."attempt" OR NEW."agent_revision_id" IS DISTINCT FROM OLD."agent_revision_id"
            OR NEW."agent_service_id" IS DISTINCT FROM OLD."agent_service_id" OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id"
            OR NEW."agent_identity_id" IS DISTINCT FROM OLD."agent_identity_id" OR NEW."principal_id" IS DISTINCT FROM OLD."principal_id"
            OR NEW."resource_kind" IS DISTINCT FROM OLD."resource_kind" OR NEW."resource_id" IS DISTINCT FROM OLD."resource_id"
            OR NEW."action" IS DISTINCT FROM OLD."action" OR NEW."arguments_digest" IS DISTINCT FROM OLD."arguments_digest"
            OR NEW."action_digest" IS DISTINCT FROM OLD."action_digest" OR NEW."approver_policy_revision" IS DISTINCT FROM OLD."approver_policy_revision"
            OR NEW."effective_policy_digest" IS DISTINCT FROM OLD."effective_policy_digest"
            OR NEW."elicitation_request_id" IS DISTINCT FROM OLD."elicitation_request_id"
            OR NEW."tool_invocation_row_id" IS DISTINCT FROM OLD."tool_invocation_row_id"
            OR NEW."reviewed_tool_arguments" IS DISTINCT FROM OLD."reviewed_tool_arguments"
            OR NEW."reviewed_tool_schema" IS DISTINCT FROM OLD."reviewed_tool_schema"
            OR NEW."reviewed_tool_schema_digest" IS DISTINCT FROM OLD."reviewed_tool_schema_digest"
            OR NEW."safe_proposed_arguments" IS DISTINCT FROM OLD."safe_proposed_arguments"
            OR NEW."response_schema" IS DISTINCT FROM OLD."response_schema"
            OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
            RAISE EXCEPTION 'ApprovalRequest identity and action bindings are immutable';
        END IF;
        IF OLD."state" <> 'pending' OR NEW."state" = 'pending' THEN
            RAISE EXCEPTION 'ApprovalRequest may be decided exactly once';
        END IF;
        -- The expiry sweep runs after the computer lease may have lapsed, so pending -> expired skips the run and lease fence.
        IF NEW."state" = 'expired' THEN
            IF decision_time < OLD."expires_at" THEN
                RAISE EXCEPTION 'ApprovalRequest may expire only after its deadline';
            END IF;
            IF NEW."decided_by" IS NOT NULL OR NEW."final_arguments" IS NOT NULL OR NEW."final_arguments_digest" IS NOT NULL OR NEW."decision_scope" IS NOT NULL THEN
                RAISE EXCEPTION 'ApprovalRequest expiry records no decider and no final arguments';
            END IF;
            NEW."decided_at" := decision_time;
            RETURN NEW;
        END IF;
    END IF;
    bound_request := CASE WHEN TG_OP = 'INSERT' THEN NEW ELSE OLD END;
    SELECT * INTO current_run FROM "agent_runs" WHERE "id" = bound_request."run_id" FOR UPDATE;
    SELECT * INTO current_invocation FROM "tool_invocations" WHERE "id" = bound_request."tool_invocation_row_id" FOR UPDATE;
    -- Only the saved cancellation winner may close approvals after lease or membership expiry.
    admitted_stop_cleanup := TG_OP = 'UPDATE' AND NEW."state" = 'cancelled'
        AND current_run."state" = 'cancelling'
        AND current_run."cancellation_decision" = 'cancellation_won'
        AND current_run."cancellation_command_id" IS NOT NULL;
    IF current_run."attempt" IS DISTINCT FROM bound_request."attempt"
        OR (current_run."state" IS DISTINCT FROM 'waiting_for_input'::"AgentRunState" AND NOT COALESCE(admitted_stop_cleanup, FALSE))
        OR current_invocation."state" IS DISTINCT FROM 'awaiting_approval'::"ToolInvocationState"
        OR current_invocation."run_id" IS DISTINCT FROM bound_request."run_id"
        OR current_invocation."attempt" IS DISTINCT FROM bound_request."attempt"
        OR current_invocation."agent_service_id" IS DISTINCT FROM bound_request."agent_service_id"
        OR current_invocation."agent_revision_id" IS DISTINCT FROM bound_request."agent_revision_id"
        OR current_invocation."silo_id" IS DISTINCT FROM bound_request."silo_id"
        OR current_invocation."agent_identity_id" IS DISTINCT FROM bound_request."agent_identity_id"
        OR current_invocation."principal_id" IS DISTINCT FROM bound_request."principal_id"
        OR current_invocation."authorization_execution_subject" IS NULL
        OR current_invocation."authorization_execution_subject" IS DISTINCT FROM current_run."execution_subject"
        OR current_run."execution_subject"->'runScope'->>'runId' IS DISTINCT FROM bound_request."run_id"
        OR current_run."execution_subject"->'runScope'->>'attempt' IS DISTINCT FROM bound_request."attempt"::TEXT
        OR COALESCE(btrim(current_run."execution_subject"->'computerScope'->>'leaseId'), '') = ''
        OR COALESCE(current_run."execution_subject"->'computerScope'->>'leaseGeneration', '') !~ '^[1-9][0-9]*$' THEN
        RAISE EXCEPTION 'ApprovalRequest requires the current waiting run and its exact computer-lease invocation';
    END IF;
    IF NOT COALESCE(admitted_stop_cleanup, FALSE) THEN
        PERFORM 1 FROM "conversation_computer_active_leases"
        WHERE "computer_id" = current_run."execution_subject"->'computerScope'->>'computerId'
          AND "silo_id" = current_run."silo_id"
          AND "conversation_id" = current_run."conversation_id"
          AND "agent_identity_id" = current_run."agent_identity_id"
          AND "lease_id" = current_run."execution_subject"->'computerScope'->>'leaseId'
          AND "lease_generation" = (current_run."execution_subject"->'computerScope'->>'leaseGeneration')::INTEGER
          AND "expires_at" > decision_time
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'ApprovalRequest requires its exact active conversation computer lease';
        END IF;
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW."state" <> 'pending' OR NEW."decided_at" IS NOT NULL OR NEW."decided_by" IS NOT NULL OR NEW."decision_scope" IS NOT NULL THEN
            RAISE EXCEPTION 'a new ApprovalRequest must begin pending';
        END IF;
        IF NEW."created_at" > decision_time OR NEW."expires_at" <= decision_time THEN
            RAISE EXCEPTION 'a new ApprovalRequest must have a current, future expiry';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW."state" = 'cancelled' THEN
        IF NEW."final_arguments" IS NOT NULL OR NEW."final_arguments_digest" IS NOT NULL THEN
            RAISE EXCEPTION 'ApprovalRequest cancellation cannot approve final arguments';
        END IF;
        IF NEW."decided_at" IS NULL OR NEW."decided_at" > decision_time OR NEW."decided_at" < OLD."created_at" THEN
            RAISE EXCEPTION 'ApprovalRequest cancellation requires a caller-supplied decision time between creation and now';
        END IF;
        NEW."decided_by" := NULL;
    ELSE
        NEW."decided_at" := decision_time;
    END IF;
    IF NEW."state" IN ('approved', 'denied') AND decision_time >= OLD."expires_at" THEN
        RAISE EXCEPTION 'ApprovalRequest decisions must be recorded before expiry';
    END IF;
    IF NEW."state" = 'approved' AND (NEW."decision_scope" IS NULL OR NEW."final_arguments" IS NULL OR NEW."final_arguments_digest" IS NULL) THEN
        RAISE EXCEPTION 'approved ApprovalRequest requires final arguments and an explicit decision scope';
    END IF;
    IF NEW."state" = 'denied' AND (NEW."decision_scope" IS DISTINCT FROM 'once'::"ToolApprovalDecisionScope" OR NEW."final_arguments" IS NOT NULL OR NEW."final_arguments_digest" IS NOT NULL) THEN
        RAISE EXCEPTION 'denied ApprovalRequest requires once scope and no final arguments';
    END IF;
    RETURN NEW;
END;
$$;`;
authoritySql = authoritySql.replace(/CREATE FUNCTION "enforce_approval_request_update"\(\) RETURNS trigger[\s\S]*?\n\$\$;/u, function _ApprovalAuthority() { return approvalAuthority; });
authoritySql = authoritySql.replace(/ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_exact_check" CHECK \([\s\S]*?\n    \);/u, function _ApprovalConstraint() { return `ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_exact_check" CHECK (
        "attempt" > 0 AND btrim("agent_revision_id") <> '' AND btrim("agent_service_id") <> '' AND btrim("silo_id") <> '' AND
        btrim("agent_identity_id") <> '' AND btrim("principal_id") <> '' AND btrim("resource_kind") NOT IN ('', '*') AND
        btrim("resource_id") NOT IN ('', '*') AND btrim("action") <> '' AND
        "arguments_digest" ~ '^sha256:[0-9a-f]{64}$' AND "action_digest" ~ '^sha256:[0-9a-f]{64}$' AND
        btrim("approver_policy_revision") <> '' AND "effective_policy_digest" ~ '^sha256:[0-9a-f]{64}$' AND
        "expires_at" > "created_at" AND btrim("elicitation_request_id") <> '' AND btrim("tool_invocation_row_id") <> '' AND
        "reviewed_tool_arguments" IS NOT NULL AND jsonb_typeof("reviewed_tool_arguments") = 'object' AND
        "reviewed_tool_schema" IS NOT NULL AND jsonb_typeof("reviewed_tool_schema") = 'object' AND
        "reviewed_tool_schema_digest" ~ '^sha256:[0-9a-f]{64}$' AND
        "safe_proposed_arguments" IS NOT NULL AND "response_schema" IS NOT NULL AND jsonb_typeof("response_schema") = 'object'
    );`; });
const standingApprovalAuthority = `-- Standing consent is derived only from an authenticated requester decision and can only narrow to revoked.
CREATE FUNCTION "enforce_tool_approval_scope_write"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    source_approval "approval_requests"%ROWTYPE;
    source_request "elicitation_requests"%ROWTYPE;
    source_run "agent_runs"%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ToolApprovalScope rows cannot be deleted'; END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
        IF OLD."state" <> 'active' OR NEW."state" <> 'revoked' OR NEW."revision" <> OLD."revision" + 1 THEN
            RAISE EXCEPTION 'ToolApprovalScope may transition from active to revoked exactly once';
        END IF;
        IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id"
            OR NEW."requester_principal_id" IS DISTINCT FROM OLD."requester_principal_id" OR NEW."requester_subject_id" IS DISTINCT FROM OLD."requester_subject_id"
            OR NEW."agent_service_id" IS DISTINCT FROM OLD."agent_service_id" OR NEW."agent_revision_id" IS DISTINCT FROM OLD."agent_revision_id"
            OR NEW."connection_id" IS DISTINCT FROM OLD."connection_id" OR NEW."connection_owner_principal_id" IS DISTINCT FROM OLD."connection_owner_principal_id"
            OR NEW."connection_generation" IS DISTINCT FROM OLD."connection_generation" OR NEW."connection_endpoint_digest" IS DISTINCT FROM OLD."connection_endpoint_digest"
            OR NEW."tool_revision_id" IS DISTINCT FROM OLD."tool_revision_id" OR NEW."tool_action" IS DISTINCT FROM OLD."tool_action"
            OR NEW."reviewed_arguments" IS DISTINCT FROM OLD."reviewed_arguments" OR NEW."arguments_digest" IS DISTINCT FROM OLD."arguments_digest"
            OR NEW."routine_id" IS DISTINCT FROM OLD."routine_id" OR NEW."routine_revision" IS DISTINCT FROM OLD."routine_revision"
            OR NEW."action_label" IS DISTINCT FROM OLD."action_label" OR NEW."target_label" IS DISTINCT FROM OLD."target_label"
            OR NEW."external_system_label" IS DISTINCT FROM OLD."external_system_label" OR NEW."assistant_label" IS DISTINCT FROM OLD."assistant_label"
            OR NEW."connection_owner_label" IS DISTINCT FROM OLD."connection_owner_label" OR NEW."source_approval_request_id" IS DISTINCT FROM OLD."source_approval_request_id"
            OR NEW."scope_identity_digest" IS DISTINCT FROM OLD."scope_identity_digest" OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
            OR OLD."active_identity_digest" IS DISTINCT FROM OLD."scope_identity_digest" OR NEW."active_identity_digest" IS NOT NULL THEN
            RAISE EXCEPTION 'ToolApprovalScope reviewed coordinates are immutable';
        END IF;
        IF NEW."revocation_idempotency_digest" !~ '^sha256:[0-9a-f]{64}$' OR NEW."revocation_command_digest" !~ '^sha256:[0-9a-f]{64}$'
            OR COALESCE(btrim(NEW."revoked_by_principal_id"), '') = '' OR NEW."revoked_at" IS NULL OR NEW."revoked_at" < OLD."created_at" THEN
            RAISE EXCEPTION 'ToolApprovalScope revocation requires complete durable evidence';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW."state" <> 'active' OR NEW."revision" <> 0 OR NEW."revoked_at" IS NOT NULL OR NEW."revoked_by_principal_id" IS NOT NULL
        OR NEW."revocation_idempotency_digest" IS NOT NULL OR NEW."revocation_command_digest" IS NOT NULL
        OR NEW."scope_identity_digest" !~ '^sha256:[0-9a-f]{64}$' OR NEW."active_identity_digest" IS DISTINCT FROM NEW."scope_identity_digest"
        OR NEW."arguments_digest" !~ '^sha256:[0-9a-f]{64}$'
        OR NEW."tool_action" <> 'invoke' OR NEW."routine_id" IS NOT NULL OR NEW."routine_revision" IS NOT NULL THEN
        RAISE EXCEPTION 'new ToolApprovalScope requires exact active interactive consent coordinates';
    END IF;
    SELECT * INTO source_approval FROM "approval_requests" WHERE "id" = NEW."source_approval_request_id" FOR KEY SHARE;
    SELECT * INTO source_request FROM "elicitation_requests" WHERE "id" = source_approval."elicitation_request_id" FOR KEY SHARE;
    SELECT * INTO source_run FROM "agent_runs" WHERE "id" = source_approval."run_id" FOR KEY SHARE;
    IF source_approval."state" IS DISTINCT FROM 'approved'::"ApprovalRequestState"
        OR source_approval."decision_scope" IS DISTINCT FROM 'always'::"ToolApprovalDecisionScope"
        OR source_approval."silo_id" IS DISTINCT FROM NEW."silo_id" OR source_approval."agent_service_id" IS DISTINCT FROM NEW."agent_service_id"
        OR source_approval."agent_revision_id" IS DISTINCT FROM NEW."agent_revision_id" OR source_approval."resource_id" IS DISTINCT FROM NEW."tool_revision_id"
        OR source_approval."action" IS DISTINCT FROM NEW."tool_action" OR source_approval."final_arguments" IS DISTINCT FROM NEW."reviewed_arguments"
        OR source_approval."final_arguments_digest" IS DISTINCT FROM NEW."arguments_digest" OR source_approval."principal_id" IS DISTINCT FROM NEW."connection_owner_principal_id"
        OR source_run."execution_subject"->'requester'->>'requesterPrincipalId' IS DISTINCT FROM NEW."requester_principal_id"
        OR source_request."assigned_participant_id" IS DISTINCT FROM NEW."requester_subject_id" THEN
        RAISE EXCEPTION 'ToolApprovalScope requires its exact requester-approved Always decision';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "tool_approval_scope_write" BEFORE INSERT OR UPDATE OR DELETE ON "tool_approval_scopes"
FOR EACH ROW EXECUTE FUNCTION "enforce_tool_approval_scope_write"();

-- Each standing consent admission belongs to one invocation and becomes immutable once its claim consumes it.
CREATE FUNCTION "enforce_tool_approval_admission_write"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    current_scope "tool_approval_scopes"%ROWTYPE;
    current_invocation "tool_invocations"%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ToolApprovalAdmission rows cannot be deleted'; END IF;
    SELECT * INTO current_scope FROM "tool_approval_scopes" WHERE "id" = COALESCE(NEW."scope_id", OLD."scope_id") FOR KEY SHARE;
    SELECT * INTO current_invocation FROM "tool_invocations" WHERE "id" = COALESCE(NEW."tool_invocation_id", OLD."tool_invocation_id") FOR UPDATE;
    IF TG_OP = 'INSERT' THEN
        IF NEW."origin" IS DISTINCT FROM 'standing_consent'::"ToolApprovalAdmissionOrigin" OR NEW."consumed_at" IS NOT NULL OR NEW."consumed_claim_fence" IS NOT NULL
            OR current_scope."state" IS DISTINCT FROM 'active'::"ToolApprovalScopeState" OR NEW."scope_revision" IS DISTINCT FROM current_scope."revision"
            OR current_invocation."approval_required" IS DISTINCT FROM TRUE OR current_invocation."state" IS DISTINCT FROM 'awaiting_approval'::"ToolInvocationState"
            OR current_invocation."silo_id" IS DISTINCT FROM current_scope."silo_id" OR current_invocation."agent_service_id" IS DISTINCT FROM current_scope."agent_service_id"
            OR current_invocation."agent_revision_id" IS DISTINCT FROM current_scope."agent_revision_id" OR current_invocation."tool_revision_id" IS DISTINCT FROM current_scope."tool_revision_id"
            OR current_invocation."arguments_digest" IS DISTINCT FROM NEW."arguments_digest" OR NEW."arguments_digest" IS DISTINCT FROM current_scope."arguments_digest"
            OR current_invocation."arguments" IS DISTINCT FROM current_scope."reviewed_arguments" THEN
            RAISE EXCEPTION 'ToolApprovalAdmission requires an active exact scope and awaiting invocation';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."scope_id" IS DISTINCT FROM OLD."scope_id" OR NEW."scope_revision" IS DISTINCT FROM OLD."scope_revision"
        OR NEW."tool_invocation_id" IS DISTINCT FROM OLD."tool_invocation_id" OR NEW."origin" IS DISTINCT FROM OLD."origin"
        OR NEW."arguments_digest" IS DISTINCT FROM OLD."arguments_digest" OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
        OR OLD."consumed_at" IS NOT NULL OR OLD."consumed_claim_fence" IS NOT NULL OR NEW."consumed_at" IS NULL OR NEW."consumed_claim_fence" IS NULL
        OR current_scope."state" IS DISTINCT FROM 'active'::"ToolApprovalScopeState" OR current_scope."revision" IS DISTINCT FROM OLD."scope_revision"
        OR current_invocation."state" IS DISTINCT FROM 'claimed'::"ToolInvocationState" OR current_invocation."claim_fence" IS DISTINCT FROM NEW."consumed_claim_fence" THEN
        RAISE EXCEPTION 'ToolApprovalAdmission may be consumed once by its exact active dispatch claim';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "tool_approval_admission_write" BEFORE INSERT OR UPDATE OR DELETE ON "tool_approval_admissions"
FOR EACH ROW EXECUTE FUNCTION "enforce_tool_approval_admission_write"();`;
if (/CREATE FUNCTION "enforce_tool_approval_scope_write"\(\) RETURNS trigger[\s\S]*?CREATE TRIGGER "tool_approval_admission_write"[\s\S]*?;/u.test(authoritySql))
{
	authoritySql = authoritySql.replace(/-- Standing consent is derived only from an authenticated requester decision[\s\S]*?CREATE TRIGGER "tool_approval_admission_write"[\s\S]*?;/u, function _StandingApprovalAuthority() { return standingApprovalAuthority; });
}
else authoritySql = `${authoritySql}\n\n${standingApprovalAuthority}`;
const header = "-- OpenCrane target database baseline.\n-- Applied once by CloudNativePG while creating an empty application database.";
const nextBaseline = `${header}\n\n${normalizedGenerated}\n\n${mcpConstraints}\n\n${snapshotConstraints}\n\n${authoritySql}\n`;

if (checkOnly)
{
	if (nextBaseline !== current)
	{
		throw new Error("target baseline regeneration is not idempotent; run the baseline regeneration command");
	}
}
else
{
	writeFileSync(baselinePath, nextBaseline, "utf8");
}
