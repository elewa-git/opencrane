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
	'CREATE INDEX "authorization_grants_catalog_id_catalog_revision_capability_idx" ON "authorization_grants"("catalog_id", "catalog_revision", "capability_id");\n\nCREATE UNIQUE INDEX "authorization_grant_exact_authority_key" ON "authorization_grants"(\n  "silo_id", "subject_kind", COALESCE("subject_group_id", \'\'), COALESCE("subject_principal_id", \'\'),\n  "boundary_kind", COALESCE("boundary_group_id", \'\'), COALESCE("boundary_principal_id", \'\'), "boundary_coverage",\n  "catalog_id", "catalog_revision", "capability_id", "resource_kind", COALESCE("resource_id", \'\'), "effect", "priority", COALESCE("manager_id", \'\')\n);',
	"authorization grant catalogue index",
);
normalizedGenerated = _ReplaceExactlyOnce(
	normalizedGenerated,
	'CREATE UNIQUE INDEX "model_definitions_scope_cluster_tenant_public_model_name_key" ON "model_definitions"("scope", "cluster_tenant", "public_model_name");',
	'CREATE UNIQUE INDEX "model_definitions_scope_cluster_tenant_public_model_name_key" ON "model_definitions"("scope", "cluster_tenant", "public_model_name");\n\nCREATE UNIQUE INDEX "model_definitions_global_public_model_name_key" ON "model_definitions"("public_model_name") WHERE "scope" = \'global\' AND "cluster_tenant" IS NULL;\n\nCREATE UNIQUE INDEX "model_definitions_global_default_key" ON "model_definitions"("scope") WHERE "scope" = \'global\' AND "cluster_tenant" IS NULL AND "is_default";',
	"global model definition authority indexes",
);
normalizedGenerated = _ReplaceExactlyOnce(
	normalizedGenerated,
	'CREATE INDEX "conversation_run_events_run_id_message_id_idx" ON "conversation_run_events"("run_id", "message_id");',
	'CREATE INDEX "conversation_run_events_run_id_message_id_idx" ON "conversation_run_events"("run_id", "message_id");\n\nCREATE UNIQUE INDEX "conversation_run_events_one_message_start" ON "conversation_run_events"("run_id", "message_id") WHERE "type" = \'message.started\';',
	"conversation message event index",
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
const authoritySql = _RemoveGeneratedObjects(current.slice(authorityIndex), normalizedGenerated);
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
