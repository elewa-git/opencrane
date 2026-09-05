#!/usr/bin/env node

import { execFileSync } from "node:child_process";
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
	'    "activity_sequence" BIGSERIAL NOT NULL,',
	'    "activity_sequence" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,',
	"conversation activity sequence column",
);
normalizedGenerated = _ReplaceExactlyOnce(
	normalizedGenerated,
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
	'CREATE INDEX "conversation_run_events_run_id_attempt_message_id_idx" ON "conversation_run_events"("run_id", "attempt", "message_id");',
	'CREATE INDEX "conversation_run_events_run_id_attempt_message_id_idx" ON "conversation_run_events"("run_id", "attempt", "message_id");\n\nCREATE UNIQUE INDEX "conversation_run_events_one_message_start" ON "conversation_run_events"("run_id", "attempt", "message_id") WHERE "type" = \'message.started\';',
	"conversation message event index",
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
const retiredWorkloadProofFunctions = [
	"enforce_current_workload_assignment_attempt",
	"enforce_workload_bootstrap_consumption",
	"enforce_run_proof_key_bootstrap",
	"enforce_workload_assignment_update",
	"enforce_run_proof_key_update",
];
for (const functionName of retiredWorkloadProofFunctions)
{
	const functionPattern = new RegExp(`CREATE FUNCTION "${functionName}"\\(\\) RETURNS trigger[\\s\\S]*?\\n\\$\\$;\\n?`, "u");
	authoritySql = authoritySql.replace(functionPattern, "");
}
const approvalAuthority = `CREATE FUNCTION "enforce_approval_request_update"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    decision_time TIMESTAMP(3) := clock_timestamp();
    current_run "agent_runs"%ROWTYPE;
    current_invocation "tool_invocations"%ROWTYPE;
    bound_request "approval_requests"%ROWTYPE;
BEGIN
    bound_request := CASE WHEN TG_OP = 'INSERT' THEN NEW ELSE OLD END;
    SELECT * INTO current_run FROM "agent_runs" WHERE "id" = bound_request."run_id" FOR UPDATE;
    SELECT * INTO current_invocation FROM "tool_invocations" WHERE "id" = bound_request."tool_invocation_row_id" FOR UPDATE;
    IF current_run."attempt" IS DISTINCT FROM bound_request."attempt"
        OR current_run."state" IS DISTINCT FROM 'waiting_for_input'::"AgentRunState"
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
    IF TG_OP = 'INSERT' THEN
        IF NEW."state" <> 'pending' OR NEW."decided_at" IS NOT NULL OR NEW."decided_by" IS NOT NULL THEN
            RAISE EXCEPTION 'a new ApprovalRequest must begin pending';
        END IF;
        IF NEW."created_at" > decision_time OR NEW."expires_at" <= decision_time THEN
            RAISE EXCEPTION 'a new ApprovalRequest must have a current, future expiry';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ApprovalRequest rows cannot be deleted'; END IF;
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
    IF NEW."state" = 'cancelled' THEN
        IF NEW."decided_at" IS NULL OR NEW."decided_at" > decision_time OR NEW."decided_at" < OLD."created_at" THEN
            RAISE EXCEPTION 'ApprovalRequest cancellation requires a caller-supplied decision time between creation and now';
        END IF;
        NEW."decided_by" := NULL;
    ELSE
        NEW."decided_at" := decision_time;
    END IF;
    IF NEW."state" = 'expired' AND decision_time < OLD."expires_at" THEN
        RAISE EXCEPTION 'ApprovalRequest may expire only after its deadline';
    ELSIF NEW."state" IN ('approved', 'denied') AND decision_time >= OLD."expires_at" THEN
        RAISE EXCEPTION 'ApprovalRequest decisions must be recorded before expiry';
    END IF;
    RETURN NEW;
END;
$$;`;
authoritySql = authoritySql.replace(/CREATE FUNCTION "enforce_approval_request_update"\(\) RETURNS trigger[\s\S]*?\n\$\$;/u, function _ApprovalAuthority() { return approvalAuthority; });
authoritySql = authoritySql.replace(/        IF OLD\."state" = 'cancelling' AND NEW\."state" = 'cancelled' THEN\n[\s\S]*?        END IF;\n        IF OLD\."started_at"/u, '        IF OLD."started_at"');
authoritySql = authoritySql.replace(/^ALTER TABLE "(?:workload_assignments|workload_bootstraps|run_proof_keys)" ADD CONSTRAINT[\s\S]*?;\n?/gmu, "");
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
authoritySql = authoritySql.replace(/^CREATE TRIGGER "(?:workload_assignments_current_attempt|workload_bootstraps_single_use|run_proof_keys_consumed_bootstrap|workload_assignments_immutable|run_proof_keys_immutable)"[^\n]*\n?/gmu, "");
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
