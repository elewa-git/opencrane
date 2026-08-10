import type { PrismaClient } from "@prisma/client";
import { RunInputSnapshotIdentityKinds, type RunInputSnapshot } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { PrismaChildRunReservationRepository } from "../prisma-child-run-reservation-repository.js";
import { __DigestRunInputSnapshot } from "../run-input-snapshot-digest.js";

/** Builds a digest-sealed snapshot with the smallest valid runtime input for a reservation test. */
function _snapshot(runId: string, serviceId: string, revisionId: string): RunInputSnapshot
{
	const value = { runId, siloId: "silo-1", agentServiceId: serviceId, agentRevisionId: revisionId, snapshotVersion: 1, conversationId: null, messageIds: [], personaRevisionId: null, preferenceFactIds: [], artifactRevisionIds: [], skillRevisionIds: [], memoryFacts: [], memoryQueryPolicy: { scope: "none" }, integrationAssignments: [], modelRoute: { alias: "test" }, budgetPolicy: { maxTokens: 1_000, maxCostUsdMicros: 5_000_000 }, identitySnapshot: { kind: RunInputSnapshotIdentityKinds.User, executionSubjectId: "user-1", organizationId: "org-1", fleetMembershipRevision: 1, fleetMembershipIssuer: "issuer", fleetMembershipIssuerKeyId: "key", fleetMembershipAssertionId: "assertion", fleetMembershipPayloadDigest: `sha256:${"a".repeat(64)}`, fleetMembershipTrustedUntil: "2026-07-30T00:00:00.000Z" }, capabilitySetDigest: `sha256:${"b".repeat(64)}`, effectiveContractDigest: `sha256:${"c".repeat(64)}`, promptCompilerVersion: "v1", compiledAt: "2026-07-26T00:00:00.000Z" } as const;
	return { ...value, digest: __DigestRunInputSnapshot(value) };
}

describe("PrismaChildRunReservationRepository", function _describeReservationRepository()
{
	it("locks a running parent and atomically persists its bounded child authority", async function _persistsReservation()
	{
		const parent = _snapshot("parent-1", "parent-service", "parent-revision");
		const childBase = _snapshot("child-1", "child-service", "child-revision");
		const child = { ...childBase, budgetPolicy: { maxTokens: 100, maxCostUsdMicros: 500_000 } };
		const childSnapshot = { ...child, digest: __DigestRunInputSnapshot(child) };
		const transaction = { $queryRaw: vi.fn().mockResolvedValue([]), agentRun: { findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "parent-1", state: "Running", siloId: "silo-1", rootRunId: "root-1", parentRunId: "root-1", inputSnapshotDigest: parent.digest }), create: vi.fn() }, runInputSnapshot: { findUnique: vi.fn().mockResolvedValue({ ...parent, compiledAt: new Date(parent.compiledAt) }), create: vi.fn() }, childRunReservation: { findUnique: vi.fn().mockResolvedValue({ depth: 1 }), aggregate: vi.fn().mockResolvedValue({ _count: { childRunId: 0 }, _sum: { maxTokens: null, maxCostUsdMicros: null } }), create: vi.fn() }, outboxEvent: { createMany: vi.fn() } };
		const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaChildRunReservationRepository(prisma);
		const result = await repository.reserve({ requestIdempotencyKey: "child-request", parentSnapshotDigest: parent.digest, prepared: { depth: 99, runId: "child-1", parentRunId: "parent-1", rootRunId: "root-1", siloId: "silo-1", executionSubjectId: "user-1", agentServiceId: "child-service", agentRevisionId: "child-revision", trigger: "managed_invocation", budget: { maxTokens: 100, maxCostUsdMicros: 500_000 } }, limits: { maximumDepth: 3, maximumChildrenPerParent: 2 }, targetAuthorization: { authorize: async function _authorize() { return { outcome: "authorized" }; } } }, { build: async function _build() { return { snapshot: childSnapshot, effectiveContractDigest: childSnapshot.effectiveContractDigest }; } });
		expect(result).toEqual({ outcome: "reserved", snapshot: childSnapshot });
		expect(transaction.agentRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id: "child-1", parentRunId: "parent-1", trigger: "ManagedInvocation" }) });
		expect(transaction.childRunReservation.create).toHaveBeenCalledWith({ data: expect.objectContaining({ childRunId: "child-1", depth: 2, maxTokens: 100, maxCostUsdMicros: 500_000n }) });
		expect(transaction.outboxEvent.createMany).toHaveBeenCalledTimes(1);
	});
});
