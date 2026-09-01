import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

import { PROMPT_COMPILER_VERSION, type RunInputSnapshot } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { __CreatePrismaRunInputCompiler } from "../prisma-run-input-compiler";
import { _ExecutionSubject } from "./execution-subject.fixture";

/** Prisma test double whose model lookup remains inspectable by the assertions. */
type TestTransaction = Prisma.TransactionClient & { readonly modelDefinition: { readonly findFirst: ReturnType<typeof vi.fn> } };

/** Build a snapshot whose frozen memory policy names the exact recall coordinates. */
function _snapshot(overrides: Partial<RunInputSnapshot> = {}): RunInputSnapshot
{
	return {
		runId: "run-1",
		attempt: 1,
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
		memoryQueryPolicy: { scope: "personal", datasetId: "dataset-1", cogneeDatasetId: "cognee-personal-1", queryText: "private recall query", maxFacts: 8 },
		mcpTools: [],
		modelRoute: { alias: "silo-default", modelDefinitionId: "model-definition-1" },
		budgetPolicy: {},
		executionSubject: _ExecutionSubject(),
		promptCompilerVersion: PROMPT_COMPILER_VERSION,
		digest: `sha256:${"f".repeat(64)}`,
		compiledAt: "2026-08-04T00:00:00.000Z",
		...overrides,
	};
}

/** Build the fake transaction reads the compile steps perform. */
function _transaction(modelDefinition: unknown = { publicModelName: "silo-default", generatedOutputCapabilities: [] }): TestTransaction
{
	return {
		personaRevision: { findUnique: vi.fn().mockResolvedValue(null) },
		conversationMessage: { findMany: vi.fn().mockResolvedValue([]) },
		artifactRevision: { findMany: vi.fn().mockResolvedValue([]) },
		skillRevision: { findMany: vi.fn().mockResolvedValue([]) },
		modelDefinition: { findFirst: vi.fn().mockResolvedValue(modelDefinition) },
	} as unknown as TestTransaction;
}

describe("__CreatePrismaRunInputCompiler", function _describePrismaRunInputCompiler()
{
	it("freezes the registered model's generated-output capability into the compiled route", async function _FreezesGeneratedOutputCapability()
	{
		const transaction = _transaction({ publicModelName: "silo-default", generatedOutputCapabilities: ["image_png", "code_execution_files", "unknown"] });
		const compiled = await __CreatePrismaRunInputCompiler()(_snapshot({ memoryQueryPolicy: { scope: "none" } }), 1, transaction);

		expect(compiled.model.generatedOutputCapabilities).toEqual(["image_png", "code_execution_files"]);
		expect(transaction.modelDefinition.findFirst).toHaveBeenCalledWith({ where: { id: "model-definition-1", siloId: "silo-1", OR: [{ scope: "Global", clusterTenant: null }, { scope: "ClusterTenant", clusterTenant: "silo-1" }] }, select: { publicModelName: true, generatedOutputCapabilities: true } });
	});

	it("fails closed instead of resolving a frozen model by its public name", async function _RejectsMissingExactModel()
	{
		const missingId = _snapshot({ modelRoute: { alias: "same-name-in-another-silo" } });
		await expect(__CreatePrismaRunInputCompiler()(missingId, 1, _transaction())).rejects.toThrow(/exact model definition/);
		await expect(__CreatePrismaRunInputCompiler()(_snapshot(), 1, _transaction(null))).rejects.toThrow(/unavailable in the trusted silo/);
	});

	it("never projects memory references or recall queries into compiled input", async function _ExcludesMemoryCoordinates()
	{
		const compiled = await __CreatePrismaRunInputCompiler()(_snapshot(), 1, _transaction());
		const serialized = JSON.stringify(compiled);

		expect(compiled.instructions).not.toContain("Durable memory");
		expect(serialized).not.toContain("private-fact-reference");
		expect(serialized).not.toContain("private recall query");
	});

	it("projects the exact frozen tool schema and digest without a live catalogue lookup", async function _ProjectsFrozenToolSchema()
	{
		const parametersSchema = { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string" } } } as const;
		const snapshot = _snapshot({ memoryQueryPolicy: { scope: "none" }, mcpTools: [{ toolRevisionId: "mcp-tool-revision-1", name: "query", description: "Search records", inputSchema: parametersSchema, inputSchemaDigest: ___DigestCanonicalJson(parametersSchema) }] });

		const compiled = await __CreatePrismaRunInputCompiler()(snapshot, 1, _transaction());
		const revision = "mcp-tool-revision-1";
		const providerSafeName = `query_${___DigestCanonicalJson(revision).slice(7, 19)}`;

		expect(compiled.tools).toEqual([{ name: providerSafeName, toolRevisionId: revision, description: "Search records", requiresApproval: true, parametersSchema, parametersSchemaDigest: ___DigestCanonicalJson(parametersSchema) }]);
		expect(compiled.tools[0]?.name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
	});

	it("fails closed when a frozen tool schema is missing or changed without a new digest", async function _RejectsToolSchemaDrift()
	{
		const reviewedSchema = { type: "object", additionalProperties: false } as const;
		const definition = { toolRevisionId: "mcp-tool-revision-1", name: "query", description: "Search records", inputSchema: reviewedSchema, inputSchemaDigest: ___DigestCanonicalJson(reviewedSchema) };
		const base = { memoryQueryPolicy: { scope: "none" } } as const;
		const missing = _snapshot({ ...base, mcpTools: [{ ...definition, inputSchema: undefined } as never] });
		const mutated = _snapshot({ ...base, mcpTools: [{ ...definition, inputSchema: { type: "object", additionalProperties: true } }] });

		await expect(__CreatePrismaRunInputCompiler()(missing, 1, _transaction())).rejects.toThrow(/MCP tools are invalid/);
		await expect(__CreatePrismaRunInputCompiler()(mutated, 1, _transaction())).rejects.toThrow(/MCP tools are invalid/);
	});
});
