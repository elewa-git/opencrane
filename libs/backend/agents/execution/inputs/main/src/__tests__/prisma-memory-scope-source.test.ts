import { describe, expect, it, vi } from "vitest";

import { PrismaMemoryScopeSource } from "../prisma-memory-scope-source.js";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

/** Create one personal run delegated to its authenticated user. */
function _Run(overrides: Partial<InitialRunAuthority> = {}): InitialRunAuthority
{
	return { agentServiceId: "service-1", agentRevisionId: "revision-1", agentKind: "personal", effectiveContractDigest: "sha256:contract", promptCompilerVersion: "v1", trigger: "interactive", delegatedUserId: "user-1", rootRunId: "run-1", parentRunId: null, ...overrides };
}

/** Create admission coordinates for the delegated personal user. */
function _Command(overrides: Record<string, unknown> = {})
{
	return { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", threadId: "thread-1", executionSubjectId: "user-1", requestIdempotencyKey: "request-1", ...overrides } as never;
}

/** Create signed identity evidence scoped to the user's organization. */
function _Identity()
{
	return { executionSubjectId: "user-1", organizationId: "org-1" } as never;
}

/** Create the narrow transaction façade used by the personal-memory source. */
function _Transaction(dataset: unknown, facts: readonly unknown[] = []): RunAdmissionTransaction
{
	return { prisma: { memoryDataset: { findFirst: vi.fn().mockResolvedValue(dataset) }, memoryFactCatalog: { findMany: vi.fn().mockResolvedValue(facts) } } as never, admittedAt: "2026-07-25T00:00:00.000Z", admittedAtEpochMs: Date.parse("2026-07-25T00:00:00.000Z") };
}

describe("PrismaMemoryScopeSource", function _DescribeMemoryScopeSource()
{
	it("pins only active consented facts with complete digest and provenance evidence", async function _PinsProvenFacts()
	{
		const digest = `sha256:${"a".repeat(64)}`;
		const transaction = _Transaction({ id: "dataset-1" }, [{ id: "fact-1", contentDigest: digest, provenance: { sourceKind: "explicit-user-fact", sourceId: "statement-1", sourceUserId: "user-1", capturedAt: "2026-07-25T00:00:00.000Z" } }, { id: "bad-fact", contentDigest: "not-a-digest", provenance: {} }, { id: "bad-time", contentDigest: digest, provenance: { sourceKind: "message", sourceId: "message-1", capturedAt: "2026" } }]);
		await expect(new PrismaMemoryScopeSource().load(_Command(), _Run(), _Identity(), transaction)).resolves.toEqual({ outcome: "loaded", value: { memoryQueryPolicy: { kind: "personal", datasetId: "dataset-1", subjectId: "user-1", maxFacts: 100 }, memoryFacts: [{ datasetId: "dataset-1", factId: "fact-1", contentDigest: digest, provenance: [{ sourceKind: "explicit-user-fact", sourceId: "statement-1", sourceUserId: "user-1", capturedAt: "2026-07-25T00:00:00.000Z" }] }] } });
	});

	it("returns the explicit no-memory policy without borrowing another scope when no personal dataset exists", async function _DoesNotBroadenScope()
	{
		const transaction = _Transaction(null);
		await expect(new PrismaMemoryScopeSource().load(_Command(), _Run(), _Identity(), transaction)).resolves.toEqual({ outcome: "loaded", value: { memoryQueryPolicy: { kind: "none" }, memoryFacts: [] } });
		expect(transaction.prisma.memoryFactCatalog.findMany).not.toHaveBeenCalled();
	});

	it("rejects subject mismatch and makes managed runs explicitly memory-free", async function _FencesPersonalMemory()
	{
		await expect(new PrismaMemoryScopeSource().load(_Command({ executionSubjectId: "user-2" }), _Run(), _Identity(), _Transaction({ id: "dataset-1" }))).resolves.toEqual({ outcome: "denied", reason: "memory_scope_unavailable" });
		await expect(new PrismaMemoryScopeSource().load(_Command(), _Run({ agentKind: "managed", delegatedUserId: null }), _Identity(), _Transaction({ id: "dataset-1" }))).resolves.toEqual({ outcome: "loaded", value: { memoryQueryPolicy: { kind: "none" }, memoryFacts: [] } });
	});
});
