import { describe, expect, it, vi } from "vitest";
import { PersonalMemoryScopeSource } from "../personal-memory-scope-source";

/** Build a dataset repository resolving the one verified personal dataset. */
function _Datasets(): { findActivePersonalDataset: ReturnType<typeof vi.fn> }
{
	return { findActivePersonalDataset: vi.fn().mockResolvedValue({ datasetId: "dataset-1", cogneeDatasetId: "cognee-personal-1" }) };
}

/** Builds a fake admission transaction that returns a fixed message for each id. */
function _Transaction(rows: Record<string, { role: string; blocks: unknown }>): { prisma: { conversationMessage: { findUnique: ReturnType<typeof vi.fn> } } }
{
	return { prisma: { conversationMessage: { findUnique: vi.fn(async function _findUnique(query: { where: { id: string } }) { return rows[query.where.id] ?? null; }) } } };
}

describe("PersonalMemoryScopeSource", function _describePersonalMemoryScopeSource()
{
	it("freezes only verified dataset coordinates and never user text or fact content", async function _FreezesOnlyDatasetCoordinates()
	{
		const datasets = _Datasets();
		const transaction = _Transaction({ "message-2": { role: "User", blocks: [{ text: "what did we decide" }] } });
		const source = new PersonalMemoryScopeSource(function _CreatePersonalMemory() { return datasets as never; });

		await expect(source.load({ siloId: "silo-1" } as never, { agentKind: "personal" } as never, { kind: "user", organizationId: "org-1", executionSubjectId: "user-1" } as never, { messageIds: ["message-1", "message-2"], pendingUserMessage: null }, transaction as never)).resolves.toEqual({
			outcome: "loaded",
			value: {
				memoryQueryPolicy: { scope: "personal", datasetId: "dataset-1", cogneeDatasetId: "cognee-personal-1" },
			},
		});
		expect(datasets.findActivePersonalDataset).toHaveBeenCalledWith({ siloId: "silo-1", organizationId: "org-1", subjectId: "user-1" });
		expect(transaction.prisma.conversationMessage.findUnique).not.toHaveBeenCalled();
	});

	it("freezes coordinates with no facts when the conversation has no user message", async function _freezesEmptyWithoutUserMessage()
	{
		const datasets = _Datasets();
		const source = new PersonalMemoryScopeSource(function _CreatePersonalMemory() { return datasets as never; });

		await expect(source.load({ siloId: "silo-1" } as never, { agentKind: "personal" } as never, { kind: "user", organizationId: "org-1", executionSubjectId: "user-1" } as never, { messageIds: [], pendingUserMessage: null }, _Transaction({}) as never)).resolves.toEqual({ outcome: "loaded", value: { memoryQueryPolicy: { scope: "personal", datasetId: "dataset-1", cogneeDatasetId: "cognee-personal-1" } } });
	});

	it("refuses a managed run before personal dataset lookup", async function _deniesManagedRun()
	{
		const datasets = { findActivePersonalDataset: vi.fn() };
		const source = new PersonalMemoryScopeSource(function _CreatePersonalMemory() { return datasets as never; });

		await expect(source.load({ siloId: "silo-1" } as never, { agentKind: "managed" } as never, { kind: "user", organizationId: "org-1", executionSubjectId: "user-1" } as never, { messageIds: [], pendingUserMessage: null }, _Transaction({}) as never)).resolves.toEqual({ outcome: "denied", reason: "memory_scope_unavailable" });
		expect(datasets.findActivePersonalDataset).not.toHaveBeenCalled();
	});

});
