import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { PROMPT_COMPILER_VERSION, RunInputSnapshotIdentityKinds, type RunInputSnapshot } from "@opencrane/contracts";
import { __UnavailableMemoryGatewayClient } from "@opencrane/backend/server/infra/memory-gateway-client";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { __CreatePrismaRunInputCompiler } from "../prisma-run-input-compiler.js";

/** Compute the canonical digest frozen for one fact's content. */
function _digest(content: string): string
{
	return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

/** Build a snapshot whose memory policy gives the dataset id and the query text. */
function _snapshot(overrides: Partial<RunInputSnapshot> = {}): RunInputSnapshot
{
	return {
		runId: "run-1",
		siloId: "silo-1",
		agentServiceId: "svc-1",
		agentRevisionId: "rev-1",
		snapshotVersion: 1,
		conversationId: "conversation-1",
		messageIds: [],
		personaRevisionId: null,
		preferenceFactIds: [],
		artifactRevisionIds: [],
		skillRevisionIds: [],
		memoryFacts: [{ datasetId: "dataset-1", factId: "fact-a", contentDigest: _digest("first fact"), provenance: [] }, { datasetId: "dataset-1", factId: "fact-b", contentDigest: _digest("second fact"), provenance: [] }],
		memoryQueryPolicy: { scope: "personal", datasetId: "dataset-1", cogneeDatasetId: "cognee-personal-1", queryText: "what did we decide", maxFacts: 8 },
		integrationAssignments: [],
		modelRoute: { alias: "silo-default" },
		budgetPolicy: {},
		identitySnapshot: { kind: RunInputSnapshotIdentityKinds.User, executionSubjectId: "user-1", organizationId: "org-1", fleetMembershipRevision: 3, fleetMembershipIssuer: "fleet", fleetMembershipIssuerKeyId: "k1", fleetMembershipAssertionId: "a1", fleetMembershipPayloadDigest: `sha256:${"c".repeat(64)}`, fleetMembershipTrustedUntil: "2026-08-05T00:00:00.000Z" },
		capabilitySetDigest: `sha256:${"d".repeat(64)}`,
		effectiveContractDigest: `sha256:${"e".repeat(64)}`,
		promptCompilerVersion: PROMPT_COMPILER_VERSION,
		digest: `sha256:${"f".repeat(64)}`,
		compiledAt: "2026-08-04T00:00:00.000Z",
		...overrides,
	};
}

/** Build the fake transaction reads the compile steps perform. */
function _transaction(): never
{
	return {
		personaRevision: { findUnique: vi.fn().mockResolvedValue(null) },
		conversationMessage: { findMany: vi.fn().mockResolvedValue([]) },
		artifactRevision: { findMany: vi.fn().mockResolvedValue([]) },
		skillRevision: { findMany: vi.fn().mockResolvedValue([]) },
		modelDefinition: { findFirst: vi.fn().mockResolvedValue(null) },
	} as never;
}

describe("__CreatePrismaRunInputCompiler memory statements", function _describePrismaRunInputCompiler()
{
	it("inlines digest-verified statements in the sorted frozen reference order", async function _inlinesVerifiedStatements()
	{
		const query = vi.fn().mockResolvedValue({ facts: [{ factId: "fact-b", content: "second fact" }, { factId: "fact-a", content: "first fact" }, { factId: "fact-unrelated", content: "noise" }] });
		const compiled = await __CreatePrismaRunInputCompiler({ query } as never)(_snapshot(), _transaction());

		expect(compiled.instructions).toContain("Durable memory available for this run:\n- first fact\n- second fact");
		expect(query).toHaveBeenCalledWith({ siloId: "silo-1", cogneeDatasetId: "cognee-personal-1", subjectId: "user-1", query: "what did we decide", maxResults: 32 });
	});

	it("fails closed when recalled content no longer matches a frozen digest", async function _failsOnDigestDrift()
	{
		const query = vi.fn().mockResolvedValue({ facts: [{ factId: "fact-a", content: "first fact" }, { factId: "fact-b", content: "tampered fact" }] });

		await expect(__CreatePrismaRunInputCompiler({ query } as never)(_snapshot(), _transaction())).rejects.toThrow(/failed digest verification/);
	});

	it("fails closed when a frozen fact reference is missing from recall", async function _failsOnMissingFact()
	{
		const query = vi.fn().mockResolvedValue({ facts: [{ factId: "fact-a", content: "first fact" }] });

		await expect(__CreatePrismaRunInputCompiler({ query } as never)(_snapshot(), _transaction())).rejects.toThrow(/failed digest verification/);
	});

	it("fails closed when the frozen policy lacks personal recall coordinates", async function _failsOnMissingPolicy()
	{
		const query = vi.fn();

		await expect(__CreatePrismaRunInputCompiler({ query } as never)(_snapshot({ memoryQueryPolicy: { scope: "none" } }), _transaction())).rejects.toThrow(/cannot resolve frozen fact references/);
		expect(query).not.toHaveBeenCalled();
	});

	it("never contacts the gateway for a snapshot with no frozen fact references", async function _compilesOfflineWithoutFacts()
	{
		const compiled = await __CreatePrismaRunInputCompiler(new __UnavailableMemoryGatewayClient())(_snapshot({ memoryFacts: [], memoryQueryPolicy: { scope: "none" } }), _transaction());

		expect(compiled.instructions).not.toContain("Durable memory");
	});

	it("projects the exact frozen tool schema and digest without a live catalogue lookup", async function _ProjectsFrozenToolSchema()
	{
		const parametersSchema = { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string" } } } as const;
		const snapshot = _snapshot({ memoryFacts: [], memoryQueryPolicy: { scope: "none" }, integrationAssignments: [{ integrationId: "search", toolDefinitions: [{ name: "query", description: "Search records", parametersSchema, parametersSchemaDigest: ___DigestCanonicalJson(parametersSchema) }] }] });

		const compiled = await __CreatePrismaRunInputCompiler(new __UnavailableMemoryGatewayClient())(snapshot, _transaction());

		expect(compiled.tools).toEqual([{ name: "integration:search:query", toolRevisionId: "integration:search:query", description: "Search records", requiresApproval: true, parametersSchema, parametersSchemaDigest: ___DigestCanonicalJson(parametersSchema) }]);
	});

	it("fails closed when a frozen tool schema is missing or changed without a new digest", async function _RejectsToolSchemaDrift()
	{
		const reviewedSchema = { type: "object", additionalProperties: false } as const;
		const definition = { name: "query", description: "Search records", parametersSchema: reviewedSchema, parametersSchemaDigest: ___DigestCanonicalJson(reviewedSchema) };
		const base = { memoryFacts: [], memoryQueryPolicy: { scope: "none" } } as const;
		const missing = _snapshot({ ...base, integrationAssignments: [{ integrationId: "search", toolDefinitions: [{ ...definition, parametersSchema: undefined } as never] }] });
		const mutated = _snapshot({ ...base, integrationAssignments: [{ integrationId: "search", toolDefinitions: [{ ...definition, parametersSchema: { type: "object", additionalProperties: true } }] }] });

		await expect(__CreatePrismaRunInputCompiler(new __UnavailableMemoryGatewayClient())(missing, _transaction())).rejects.toThrow(/tool definitions are invalid/);
		await expect(__CreatePrismaRunInputCompiler(new __UnavailableMemoryGatewayClient())(mutated, _transaction())).rejects.toThrow(/tool definitions are invalid/);
	});
});
