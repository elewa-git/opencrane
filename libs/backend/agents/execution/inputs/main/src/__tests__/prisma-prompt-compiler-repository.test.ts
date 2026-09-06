import { describe, expect, it, vi } from "vitest";

import { PROMPT_COMPILER_VERSION } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { PrismaPromptCompilerRepository, PrismaPromptCompilerUnitOfWork } from "../prisma-prompt-compiler-repository";

/** Build the narrow transaction doubles used by immutable prompt repository tests. */
function _Transaction()
{
	const schema = { type: "object", additionalProperties: false };
	return {
		personaRevision: { findFirst: vi.fn().mockResolvedValue({ compiledInstructions: "Be helpful." }) },
		mcpToolRevision: { findMany: vi.fn().mockResolvedValue([{ id: "tool-1", siloId: "silo-1", name: "calendar.read", description: "Read calendar", inputSchema: schema, inputSchemaDigest: ___DigestCanonicalJson(schema), serverRevision: { siloId: "silo-1", state: "Retired", server: { siloId: "silo-1", status: "Disabled", approvalStatus: "Revoked", requiresApproval: true } } }]) },
		artifactRevision: { findMany: vi.fn().mockResolvedValue([{ id: "artifact-1", mediaType: "text/plain" }]) },
		skillRevision: { findMany: vi.fn().mockResolvedValue([{ id: "skill-1", skillId: "skill-parent-1" }]) },
		modelDefinition: { findFirst: vi.fn().mockResolvedValue({ id: "model-1", siloId: "silo-1", publicModelName: "changed-model", litellmModelId: "changed-deployment", generatedOutputCapabilities: [] }) },
	};
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
		const snapshot = { runId: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", snapshotVersion: 1, conversationId: null, messageIds: [], personaRevisionId: null, preferenceFactIds: [], artifactRevisionIds: [], skillRevisionIds: [], memoryQueryPolicy: {}, mcpTools: [], modelRoute: { alias: "tenant-model", modelDefinitionId: "model-1", litellmModelId: "deployment-1", generatedOutputCapabilities: ["image_png"] }, budgetPolicy: { maxCompletionTokens: 100, maxCostUsdMicros: 100, maxToolInvocations: 1, wallClockDeadlineEpochMs: 2_000_000_000_000 }, executionSubject: {} as never, promptCompilerVersion: PROMPT_COMPILER_VERSION, digest: `sha256:${"a".repeat(64)}`, compiledAt: "2026-09-06T00:00:00.000Z" };

		await expect(compiler.compile(snapshot, 1)).resolves.toEqual(expect.objectContaining({ runId: "run-1", messages: [], model: expect.objectContaining({ modelAlias: "tenant-model" }) }));
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
		await expect(repository.loadToolDefinitions([{ toolRevisionId: "tool-1", name: "calendar.read", description: "Read calendar", inputSchema: schema, inputSchemaDigest: ___DigestCanonicalJson(schema) }])).resolves.toEqual([{ toolRevisionId: "tool-1", name: "calendar.read", description: "Read calendar", requiresApproval: true, parametersSchema: schema, parametersSchemaDigest: ___DigestCanonicalJson(schema) }]);
		await expect(repository.loadArtifactSummaries(["artifact-1"])).resolves.toEqual(["text/plain artifact artifact-1"]);
		await expect(repository.loadSkillSummaries(["skill-1"])).resolves.toEqual(["skill skill-parent-1 revision skill-1"]);
		await expect(repository.resolveModelRoute("silo-1", { alias: "tenant-model", modelDefinitionId: "model-1", litellmModelId: "deployment-1", maxOutputTokens: 384, generatedOutputCapabilities: ["image_png"] })).resolves.toEqual({ modelAlias: "tenant-model", maxOutputTokens: 384, generatedOutputCapabilities: ["image_png"] });
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
