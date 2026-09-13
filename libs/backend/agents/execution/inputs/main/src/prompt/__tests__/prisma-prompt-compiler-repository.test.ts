import { ExecutionSubjectMembershipKinds } from "@opencrane/models/agents";
import { describe, expect, it, vi } from "vitest";

import { PROMPT_COMPILER_VERSION, RUN_INPUT_SNAPSHOT_VERSION } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { PrismaPromptCompilerRepository, PrismaPromptCompilerUnitOfWork } from "../prisma-prompt-compiler-repository";

/** Builds the verified personal execution subject required by the compiler boundary. */
function _executionSubject()
{
	return { schemaVersion: 1, siloId: "silo-1", agentIdentityId: "identity-1", principalId: "principal-1", identity: { agentIdentityId: "identity-1", principalId: "principal-1", siloId: "silo-1", headRevision: "0", headDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "identity-decision-1", verifiedAt: "2026-09-06T00:00:00.000Z" }, membership: { kind: ExecutionSubjectMembershipKinds.Fleet, principalId: "principal-1", siloId: "silo-1", revision: 1, assertionId: "membership-1", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-decision-1", trustedUntil: "2099-01-01T00:00:00.000Z" }, capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: `sha256:${"c".repeat(64)}`, effectiveContractDigest: `sha256:${"d".repeat(64)}`, decisionEvidenceId: "capability-decision-1", decidedAt: "2026-09-06T00:00:00.000Z" }, runScope: { siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" }, computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 1 }, requester: { siloId: "silo-1", requesterPrincipalId: "principal-1", requestIdempotencyKey: "request-1", authenticatedAt: "2026-09-06T00:00:00.000Z", membership: { kind: ExecutionSubjectMembershipKinds.Fleet, principalId: "principal-1", siloId: "silo-1", revision: 1, assertionId: "requester-membership-1", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "requester-decision-1", trustedUntil: "2099-01-01T00:00:00.000Z" } }, admission: { authorizingPrincipalId: "principal-1", decisionEvidenceId: "admission-decision-1", admittedAt: "2026-09-06T00:00:00.000Z" } } as const;
}

/** Build the narrow transaction doubles used by immutable prompt repository tests. */
function _Transaction(toolRows: readonly unknown[] = [_ToolRow()])
{
	return {
		personaRevision: { findFirst: vi.fn().mockResolvedValue({ compiledInstructions: "Be helpful." }) },
		mcpToolRevision: { findMany: vi.fn().mockResolvedValue(toolRows) },
		artifactRevision: { findMany: vi.fn().mockResolvedValue([{ id: "artifact-1", mediaType: "text/plain" }]) },
		skillRevision: { findMany: vi.fn().mockResolvedValue([{ id: "skill-1", skillId: "skill-parent-1" }]) },
		modelDefinition: { findFirst: vi.fn().mockResolvedValue({ id: "model-1", siloId: "silo-1", publicModelName: "changed-model", litellmModelId: "changed-deployment", generatedOutputCapabilities: [] }) },
	};
}

/** Build one historical MCP tool row whose immutable literals remain compilable. */
function _ToolRow(overrides: Record<string, unknown> = {})
{
	const schema = { type: "object", additionalProperties: false };
	return { id: "tool-1", siloId: "silo-1", name: "calendar.read", description: "Read calendar", inputSchema: schema, inputSchemaDigest: ___DigestCanonicalJson(schema), serverRevision: { siloId: "silo-1", state: "Retired", server: { siloId: "silo-1", status: "Disabled", approvalStatus: "Revoked", requiresApproval: true } }, ...overrides };
}

describe("PrismaPromptCompilerRepository", function _PrismaPromptCompilerRepositorySuite()
{
	it("constructs message and compiler repositories inside the exact read transaction", async function _CompileInsideTransaction()
	{
		const transaction = _Transaction();
		const prisma = { $transaction: vi.fn(async function _Transaction<T>(operation: (client: typeof transaction) => Promise<T>): Promise<T> { return operation(transaction); }) };
		const messages = { loadMessages: vi.fn().mockResolvedValue([]) };
		const createMessages = vi.fn().mockReturnValue(messages);
		const compiler = new PrismaPromptCompilerUnitOfWork(prisma as never, createMessages);
		const snapshot = { runId: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", snapshotVersion: RUN_INPUT_SNAPSHOT_VERSION, conversationId: null, messageIds: [], personaRevisionId: null, preferenceFactIds: [], artifactRevisionIds: [], skillRevisionIds: [], memoryQueryPolicy: {}, mcpTools: [], modelRoute: { alias: "tenant-model", modelDefinitionId: "model-1", litellmModelId: "deployment-1", maxOutputTokens: 4096, generatedOutputCapabilities: ["image_png"] }, budgetPolicy: { maxModelTurns: 1, maxCompletionTokens: 256000, maxCostUsdMicros: 100, maxToolInvocations: 1, maxLoopIterations: 1, wallClockDeadlineEpochMs: 2_000_000_000_000 }, executionSubject: _executionSubject(), promptCompilerVersion: PROMPT_COMPILER_VERSION, digest: `sha256:${"a".repeat(64)}`, compiledAt: "2026-09-06T00:00:00.000Z" };

		await expect(compiler.compile(snapshot, 1)).resolves.toEqual(expect.objectContaining({ runId: "run-1", messages: [], model: expect.objectContaining({ modelAlias: "tenant-model", maxOutputTokens: 4096 }), budget: expect.objectContaining({ maxCompletionTokens: 256000 }) }));
		expect(createMessages).toHaveBeenCalledWith(transaction);
		expect(prisma.$transaction).toHaveBeenCalledOnce();
	});

	it("resolves exact immutable prompt inputs and preserves requested resource order", async function _ResolvePromptInputs()
	{
		const transaction = _Transaction();
		const messages = { loadMessages: vi.fn().mockResolvedValue([{ role: "user", content: "hello" }]) };
		const repository = new PrismaPromptCompilerRepository(transaction as never, messages as never, "silo-1");
		const schema = { type: "object", additionalProperties: false };

		await expect(repository.loadPersonaInstructions("persona-1")).resolves.toBe("Be helpful.");
		await expect(repository.loadMessages(["message-1"])).resolves.toEqual([{ role: "user", content: "hello" }]);
		await expect(repository.loadToolDefinitions([{ toolRevisionId: "tool-1", name: "calendar.read", description: "Read calendar", inputSchema: schema, inputSchemaDigest: ___DigestCanonicalJson(schema) }])).resolves.toEqual([{ toolRevisionId: "tool-1", name: "calendar.read", modelName: "mcp_N7odFteZclDmu0DFKlJhoEt53tfHx79bYbz59tNqNu0", description: "Read calendar", requiresApproval: true, parametersSchema: schema, parametersSchemaDigest: ___DigestCanonicalJson(schema) }]);
		await expect(repository.loadArtifactSummaries(["artifact-1"])).resolves.toEqual(["text/plain artifact artifact-1"]);
		await expect(repository.loadSkillSummaries(["skill-1"])).resolves.toEqual(["skill skill-parent-1 revision skill-1"]);
		await expect(repository.resolveModelRoute("silo-1", { alias: "tenant-model", modelDefinitionId: "model-1", litellmModelId: "deployment-1", maxOutputTokens: 384, generatedOutputCapabilities: ["image_png"] })).resolves.toEqual({ modelAlias: "tenant-model", maxOutputTokens: 384, generatedOutputCapabilities: ["image_png"] });
	});

	it("preserves dotted and long source names while deriving distinct provider names", async function _DerivesProviderNames()
	{
		const schema = { type: "object", additionalProperties: false };
		const dotted = _ToolRow({ id: "revision-dotted", name: "opencrane.files.create_csv" });
		const longName = `reports.${"x".repeat(80)}`;
		const long = _ToolRow({ id: "revision-long", name: longName });
		const repository = new PrismaPromptCompilerRepository(_Transaction([long, dotted]) as never, { loadMessages: vi.fn() } as never, "silo-1");

		await expect(repository.loadToolDefinitions([
			{ toolRevisionId: "revision-dotted", name: "opencrane.files.create_csv", description: "Read calendar", inputSchema: schema, inputSchemaDigest: ___DigestCanonicalJson(schema) },
			{ toolRevisionId: "revision-long", name: longName, description: "Read calendar", inputSchema: schema, inputSchemaDigest: ___DigestCanonicalJson(schema) },
		])).resolves.toEqual([
			expect.objectContaining({ name: "opencrane.files.create_csv", modelName: "mcp_wWKT_5cFG66QdMscL6hmB1XTsZzT1bRj_Sij6ljOg_c", toolRevisionId: "revision-dotted" }),
			expect.objectContaining({ name: longName, modelName: "mcp_lRn5FnpMinTXKgKT50uzqB-Xj5FKgtUNVaiZEh_odWk", toolRevisionId: "revision-long" }),
		]);
	});

	it("gives separate revisions distinct provider names even when source names repeat or normalize alike", async function _SeparatesSourceNames()
	{
		const schema = { type: "object", additionalProperties: false };
		const rows = [_ToolRow({ id: "revision-dotted", name: "files.export" }), _ToolRow({ id: "revision-long", name: "files.export" }), _ToolRow({ id: "revision-normalized", name: "files_export" })];
		const repository = new PrismaPromptCompilerRepository(_Transaction(rows) as never, { loadMessages: vi.fn() } as never, "silo-1");
		const definitions = await repository.loadToolDefinitions([
			{ toolRevisionId: "revision-dotted", name: "files.export", description: "Read calendar", inputSchema: schema, inputSchemaDigest: ___DigestCanonicalJson(schema) },
			{ toolRevisionId: "revision-long", name: "files.export", description: "Read calendar", inputSchema: schema, inputSchemaDigest: ___DigestCanonicalJson(schema) },
			{ toolRevisionId: "revision-normalized", name: "files_export", description: "Read calendar", inputSchema: schema, inputSchemaDigest: ___DigestCanonicalJson(schema) },
		]);

		expect(definitions.map(function _ModelName(tool): string { return tool.modelName; })).toEqual(["mcp_wWKT_5cFG66QdMscL6hmB1XTsZzT1bRj_Sij6ljOg_c", "mcp_lRn5FnpMinTXKgKT50uzqB-Xj5FKgtUNVaiZEh_odWk", "mcp_rmeDdNzbpq9wnWR61APEZO4P3Vl-0Q0vOGj43yp7yWk"]);
		expect(new Set(definitions.map(function _ModelName(tool): string { return tool.modelName; })).size).toBe(3);
	});

	it("rejects an MCP schema that differs from the admitted literal", async function _RejectChangedToolSchema()
	{
		const repository = new PrismaPromptCompilerRepository(_Transaction() as never, { loadMessages: vi.fn() } as never, "silo-1");
		await expect(repository.loadToolDefinitions([{ toolRevisionId: "tool-1", name: "calendar.read", description: "Read calendar", inputSchema: { type: "array" }, inputSchemaDigest: ___DigestCanonicalJson({ type: "array" }) }])).rejects.toThrow(/does not match the admitted snapshot/);
	});

	it("dereferences an old persona revision after its profile publishes a newer revision", async function _ResolveHistoricalPersona()
	{
		const transaction = _Transaction();
		const repository = new PrismaPromptCompilerRepository(transaction as never, { loadMessages: vi.fn() } as never, "silo-1");

		await expect(repository.loadPersonaInstructions("persona-1")).resolves.toBe("Be helpful.");
		expect(transaction.personaRevision.findFirst).toHaveBeenCalledWith({ where: { id: "persona-1", profile: { is: { siloId: "silo-1" } } }, select: { compiledInstructions: true } });
	});

	it("dereferences immutable artifact and skill revisions after their parents retire", async function _ResolveRetiredParents()
	{
		const transaction = _Transaction();
		const repository = new PrismaPromptCompilerRepository(transaction as never, { loadMessages: vi.fn() } as never, "silo-1");

		await expect(repository.loadArtifactSummaries(["artifact-1"])).resolves.toEqual(["text/plain artifact artifact-1"]);
		await expect(repository.loadSkillSummaries(["skill-1"])).resolves.toEqual(["skill skill-parent-1 revision skill-1"]);
		expect(transaction.artifactRevision.findMany).toHaveBeenCalledWith({ where: { id: { in: ["artifact-1"] }, artifact: { is: { siloId: "silo-1" } } }, select: { id: true, mediaType: true } });
		expect(transaction.skillRevision.findMany).toHaveBeenCalledWith({ where: { id: { in: ["skill-1"] }, skill: { is: { siloId: "silo-1" } } }, select: { id: true, skillId: true } });
	});

	it("returns the frozen model route after mutable model fields change", async function _ResolveFrozenModelRoute()
	{
		const transaction = _Transaction();
		const repository = new PrismaPromptCompilerRepository(transaction as never, { loadMessages: vi.fn() } as never, "silo-1");

		await expect(repository.resolveModelRoute("silo-1", { alias: "tenant-model", modelDefinitionId: "model-1", litellmModelId: "deployment-1", generatedOutputCapabilities: ["image_png"] })).resolves.toEqual({ modelAlias: "tenant-model", maxOutputTokens: null, generatedOutputCapabilities: ["image_png"] });
		transaction.modelDefinition.findFirst.mockResolvedValueOnce(null);
		await expect(repository.resolveModelRoute("silo-1", { alias: "tenant-model", modelDefinitionId: "model-1", litellmModelId: "deployment-1", generatedOutputCapabilities: ["image_png"] })).rejects.toThrow(/definition is unavailable/);
	});

	it("rejects missing resources and cross-silo model routes", async function _RejectUnavailableReferences()
	{
		const transaction = _Transaction();
		transaction.artifactRevision.findMany.mockResolvedValueOnce([]);
		transaction.modelDefinition.findFirst.mockResolvedValueOnce(null);
		const repository = new PrismaPromptCompilerRepository(transaction as never, { loadMessages: vi.fn() } as never, "silo-1");

		await expect(repository.loadArtifactSummaries(["artifact-1"])).rejects.toThrow(/set is incomplete/);
		await expect(repository.resolveModelRoute("silo-other", { alias: "tenant-model", modelDefinitionId: "model-1", litellmModelId: "deployment-1", generatedOutputCapabilities: ["image_png"] })).rejects.toThrow(/another compiler silo/);
	});
});
