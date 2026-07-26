import { AuthorizationScopeKind, MemoryConsentState, MemoryDatasetState, MemoryFactState } from "@prisma/client";
import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { describe, expect, it, vi } from "vitest";

import { PrismaPreferenceFactSource } from "../prisma-preference-fact-source.js";

/** Creates the smallest immutable initial authority needed to select preference behavior. */
function _Run(agentKind: InitialRunAuthority["agentKind"]): InitialRunAuthority
{
	return { agentServiceId: "service-1", agentRevisionId: "revision-1", agentKind, effectiveContractDigest: "sha256:contract", promptCompilerVersion: "v1", trigger: agentKind === "personal" ? "interactive" : "managed_invocation", delegatedUserId: agentKind === "personal" ? "user-1" : null, rootRunId: "run-1", parentRunId: null };
}

describe("PrismaPreferenceFactSource", function _DescribePrismaPreferenceFactSource()
{
	it("keeps managed execution free of personal preference facts", async function _LoadsManagedEmptyPreferences()
	{
		await expect(new PrismaPreferenceFactSource().load({ identityKind: "service", trigger: "managed_invocation" } as never, _Run("managed"), { kind: "service" } as never, {} as never)).resolves.toEqual({ outcome: "loaded", value: [] });
	});

	it("loads only active consented explicit facts from the verified user's exact personal organization", async function _LoadsVerifiedPreferences()
	{
		const transaction = _Transaction({ id: "dataset-1" }, [{ id: "fact-1", provenance: { sourceKind: "explicit-user-fact", sourceUserId: "user-1" } }, { id: "fact-2", provenance: { sourceKind: "message", sourceUserId: "user-1" } }]);
		await expect(new PrismaPreferenceFactSource().load({ siloId: "silo-1", identityKind: "user", trigger: "interactive", executionSubjectId: "user-1" } as never, _Run("personal"), { kind: "user", executionSubjectId: "user-1", organizationId: "org-1" } as never, transaction)).resolves.toEqual({ outcome: "loaded", value: [{ id: "fact-1" }] });
		expect(transaction.prisma.memoryDataset.findFirst).toHaveBeenCalledWith({ where: { siloId: "silo-1", scopeKind: AuthorizationScopeKind.Personal, organizationId: "org-1", scopeResourceId: "user-1", state: MemoryDatasetState.Active }, select: { id: true } });
		expect(transaction.prisma.memoryFactCatalog.findMany).toHaveBeenCalledWith({ where: { datasetId: "dataset-1", state: MemoryFactState.Active, consentState: { in: [MemoryConsentState.Explicit, MemoryConsentState.Confirmed] } }, select: { id: true, provenance: true } });
	});
});

/** Creates the narrow transaction facade used to read personal dataset facts. */
function _Transaction(dataset: unknown, facts: readonly unknown[]): RunAdmissionTransaction
{
	return { prisma: { memoryDataset: { findFirst: vi.fn().mockResolvedValue(dataset) }, memoryFactCatalog: { findMany: vi.fn().mockResolvedValue(facts) } } as never, admittedAt: "2026-07-26T00:00:00.000Z", admittedAtEpochMs: Date.parse("2026-07-26T00:00:00.000Z") };
}
