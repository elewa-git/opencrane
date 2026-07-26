import { AuthorizationScopeKind, MemoryConsentState, MemoryDatasetState, MemoryFactState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaPreferenceFactSource } from "../prisma-preference-fact-source.js";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

/** Create one personal interactive run delegated to its authenticated user. */
function _PersonalRun(overrides: Partial<InitialRunAuthority> = {}): InitialRunAuthority
{
	return { agentServiceId: "service-1", agentRevisionId: "revision-1", agentKind: "personal", effectiveContractDigest: "sha256:contract", promptCompilerVersion: "v1", trigger: "interactive", delegatedUserId: "user-1", rootRunId: "run-1", parentRunId: null, ...overrides };
}

/** Create minimal command coordinates scoped to the same personal owner. */
function _Command(overrides: Record<string, unknown> = {})
{
	return { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", threadId: "thread-1", executionSubjectId: "user-1", requestIdempotencyKey: "request-1", ...overrides } as never;
}

/** Create signed identity evidence scoped to the user's organization. */
function _Identity()
{
	return { executionSubjectId: "user-1", organizationId: "org-1" } as never;
}

/** Create the narrow memory-query transaction façade. */
function _Transaction(dataset: unknown, facts: readonly unknown[] = []): RunAdmissionTransaction
{
	return { prisma: { memoryDataset: { findFirst: vi.fn().mockResolvedValue(dataset) }, memoryFactCatalog: { findMany: vi.fn().mockResolvedValue(facts) } } as never, admittedAt: "2026-07-25T00:00:00.000Z", admittedAtEpochMs: Date.parse("2026-07-25T00:00:00.000Z") };
}

describe("PrismaPreferenceFactSource", function _DescribePreferenceFactSource()
{
	it("loads only active consented facts with explicit provenance for the delegated owner", async function _LoadsOwnerPreferences()
	{
		const transaction = _Transaction({ id: "dataset-1" }, [{ id: "fact-1", provenance: { sourceKind: "explicit-user-fact", sourceUserId: "user-1" } }, { id: "fact-2", provenance: { sourceKind: "message", sourceUserId: "user-1" } }, { id: "fact-3", provenance: { sourceKind: "explicit-user-fact", sourceUserId: "user-2" } }]);
		await expect(new PrismaPreferenceFactSource().load(_Command(), _PersonalRun(), _Identity(), transaction)).resolves.toEqual({ outcome: "loaded", value: [{ id: "fact-1" }] });
		expect(transaction.prisma.memoryDataset.findFirst).toHaveBeenCalledWith({ where: { siloId: "silo-1", scopeKind: AuthorizationScopeKind.Personal, organizationId: "org-1", scopeResourceId: "user-1", state: MemoryDatasetState.Active }, select: { id: true } });
		expect(transaction.prisma.memoryFactCatalog.findMany).toHaveBeenCalledWith({ where: { datasetId: "dataset-1", state: MemoryFactState.Active, consentState: { in: [MemoryConsentState.Explicit, MemoryConsentState.Confirmed] } }, select: { id: true, provenance: true } });
	});

	it("treats a missing personal dataset as no optional preferences rather than borrowing a shared dataset", async function _DoesNotBroadenScope()
	{
		const transaction = _Transaction(null);
		await expect(new PrismaPreferenceFactSource().load(_Command(), _PersonalRun(), _Identity(), transaction)).resolves.toEqual({ outcome: "loaded", value: [] });
		expect(transaction.prisma.memoryFactCatalog.findMany).not.toHaveBeenCalled();
	});

	it("rejects a personal run when delegation and authenticated subject disagree", async function _RejectsImpersonation()
	{
		const transaction = _Transaction({ id: "dataset-1" });
		await expect(new PrismaPreferenceFactSource().load(_Command({ executionSubjectId: "user-2" }), _PersonalRun(), _Identity(), transaction)).resolves.toEqual({ outcome: "denied", reason: "memory_scope_unavailable" });
		expect(transaction.prisma.memoryDataset.findFirst).not.toHaveBeenCalled();
	});

	it("keeps managed runs free of personal facts", async function _KeepsManagedRunsFree()
	{
		const transaction = _Transaction({ id: "dataset-1" });
		await expect(new PrismaPreferenceFactSource().load(_Command(), _PersonalRun({ agentKind: "managed", delegatedUserId: null }), _Identity(), transaction)).resolves.toEqual({ outcome: "loaded", value: [] });
		expect(transaction.prisma.memoryDataset.findFirst).not.toHaveBeenCalled();
	});
});
