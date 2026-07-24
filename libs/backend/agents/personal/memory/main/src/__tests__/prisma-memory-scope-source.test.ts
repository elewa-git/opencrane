import { describe, expect, it, vi } from "vitest";

import { PrismaMemoryScopeSource } from "../prisma-memory-scope-source.js";

describe("PrismaMemoryScopeSource", function _describeMemoryScope()
{
	it("freezes only the caller's active consented facts into a pinned-only policy", async function _loadsPersonalFacts()
	{
		const findMany = vi.fn().mockResolvedValue([{ id: "fact-1", datasetId: "dataset-1", contentDigest: `sha256:${"a".repeat(64)}`, sourceArtifactRevisionId: null, sourceMessageId: "message-1", recordedAt: new Date("2026-07-24T00:00:00.000Z") }]);
		const result = await new PrismaMemoryScopeSource().load({ siloId: "silo-1", executionSubjectId: "user-1" } as never, { agentKind: "personal" } as never, { prisma: { memoryFactCatalog: { findMany } } } as never);
		expect(result).toEqual({ outcome: "loaded", value: { memoryFacts: [{ datasetId: "dataset-1", factId: "fact-1", contentDigest: `sha256:${"a".repeat(64)}`, provenance: [{ sourceKind: "message", sourceId: "message-1", capturedAt: "2026-07-24T00:00:00.000Z" }] }], memoryQueryPolicy: { mode: "pinned-only", datasetIds: ["dataset-1"] } } });
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ recordedBy: "user-1", dataset: expect.objectContaining({ scopeKind: "Personal", scopeResourceId: "user-1" }) }) }));
	});

	it("gives managed work no personal facts or broad retrieval authority", async function _emptiesManagedScope()
	{
		expect(await new PrismaMemoryScopeSource().load({} as never, { agentKind: "managed" } as never, {} as never)).toEqual({ outcome: "loaded", value: { memoryFacts: [], memoryQueryPolicy: { mode: "pinned-only", datasetIds: [] } } });
	});
});
