import { describe, expect, it, vi } from "vitest";

import { PersonalMemoryScopeSource } from "../personal-memory-scope-source.js";

/** Fixed digests reused across freezing assertions. */
const _DIGEST_A = `sha256:${"a".repeat(64)}`;

/** Fixed digests reused across freezing assertions. */
const _DIGEST_B = `sha256:${"b".repeat(64)}`;

/** Build a dataset repository resolving the one verified personal dataset. */
function _Datasets(): { findActivePersonalDataset: ReturnType<typeof vi.fn> }
{
	return { findActivePersonalDataset: vi.fn().mockResolvedValue({ datasetId: "dataset-1", cogneeDatasetId: "cognee-personal-1" }) };
}

/** Build an admission transaction whose messages resolve deterministically by id. */
function _Transaction(rows: Record<string, { role: string; blocks: unknown }>): { prisma: { conversationMessage: { findUnique: ReturnType<typeof vi.fn> } } }
{
	return { prisma: { conversationMessage: { findUnique: vi.fn(async function _findUnique(query: { where: { id: string } }) { return rows[query.where.id] ?? null; }) } } };
}

describe("PersonalMemoryScopeSource", function _describePersonalMemoryScopeSource()
{
	it("freezes gateway-selected fact references and the derived query policy", async function _freezesSelectedFacts()
	{
		const datasets = _Datasets();
		const selector = { select: vi.fn().mockResolvedValue([{ factId: "fact-1", contentDigest: _DIGEST_A }, { factId: "fact-2", contentDigest: _DIGEST_B }]) };
		const transaction = _Transaction({ "message-2": { role: "User", blocks: [{ text: "what did we decide" }] } });
		const source = new PersonalMemoryScopeSource(datasets as never, selector);

		await expect(source.load({ siloId: "silo-1" } as never, { agentKind: "personal" } as never, { kind: "user", organizationId: "org-1", executionSubjectId: "user-1" } as never, { messageIds: ["message-1", "message-2"] }, transaction as never)).resolves.toEqual({
			outcome: "loaded",
			value: {
				memoryQueryPolicy: { scope: "personal", datasetId: "dataset-1", cogneeDatasetId: "cognee-personal-1", queryText: "what did we decide", maxFacts: 8 },
				memoryFacts: [{ datasetId: "dataset-1", factId: "fact-1", contentDigest: _DIGEST_A, provenance: [] }, { datasetId: "dataset-1", factId: "fact-2", contentDigest: _DIGEST_B, provenance: [] }],
			},
		});
		expect(datasets.findActivePersonalDataset).toHaveBeenCalledWith(transaction, { siloId: "silo-1", organizationId: "org-1", subjectId: "user-1" });
		expect(selector.select).toHaveBeenCalledWith({ siloId: "silo-1", cogneeDatasetId: "cognee-personal-1", subjectId: "user-1", queryText: "what did we decide", maxFacts: 8 });
	});

	it("derives the query from the newest user turn, skipping trailing assistant turns", async function _derivesNewestUserTurn()
	{
		const selector = { select: vi.fn().mockResolvedValue([]) };
		const transaction = _Transaction({ "message-3": { role: "Assistant", blocks: [{ text: "an answer" }] }, "message-2": { role: "User", blocks: "latest question" } });
		const source = new PersonalMemoryScopeSource(_Datasets() as never, selector);

		await source.load({ siloId: "silo-1" } as never, { agentKind: "personal" } as never, { kind: "user", organizationId: "org-1", executionSubjectId: "user-1" } as never, { messageIds: ["message-1", "message-2", "message-3"] }, transaction as never);

		expect(selector.select).toHaveBeenCalledWith(expect.objectContaining({ queryText: "latest question" }));
	});

	it("freezes coordinates with no facts when the thread has no user message", async function _freezesEmptyWithoutUserMessage()
	{
		const selector = { select: vi.fn() };
		const source = new PersonalMemoryScopeSource(_Datasets() as never, selector);

		await expect(source.load({ siloId: "silo-1" } as never, { agentKind: "personal" } as never, { kind: "user", organizationId: "org-1", executionSubjectId: "user-1" } as never, { messageIds: [] }, _Transaction({}) as never)).resolves.toEqual({ outcome: "loaded", value: { memoryQueryPolicy: { scope: "personal", datasetId: "dataset-1", cogneeDatasetId: "cognee-personal-1" }, memoryFacts: [] } });
		expect(selector.select).not.toHaveBeenCalled();
	});

	it("fails the admission closed when the selector throws instead of freezing an empty selection", async function _deniesOnSelectorFailure()
	{
		const selector = { select: vi.fn().mockRejectedValue(new Error("gateway unreachable")) };
		const transaction = _Transaction({ "message-1": { role: "User", blocks: "question" } });
		const source = new PersonalMemoryScopeSource(_Datasets() as never, selector);

		await expect(source.load({ siloId: "silo-1" } as never, { agentKind: "personal" } as never, { kind: "user", organizationId: "org-1", executionSubjectId: "user-1" } as never, { messageIds: ["message-1"] }, transaction as never)).resolves.toEqual({ outcome: "denied", reason: "memory_unavailable" });
	});

	it("refuses a managed run before personal dataset lookup", async function _deniesManagedRun()
	{
		const datasets = { findActivePersonalDataset: vi.fn() };
		const source = new PersonalMemoryScopeSource(datasets as never, { select: vi.fn() });

		await expect(source.load({ siloId: "silo-1" } as never, { agentKind: "managed" } as never, { kind: "user", organizationId: "org-1", executionSubjectId: "user-1" } as never, { messageIds: [] }, _Transaction({}) as never)).resolves.toEqual({ outcome: "denied", reason: "memory_scope_unavailable" });
		expect(datasets.findActivePersonalDataset).not.toHaveBeenCalled();
	});
});
