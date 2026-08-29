import { AgentRunState, AgentRunTrigger, type PrismaClient } from "@prisma/client";
import { RunInputSnapshotIdentityKinds, type RunInputSnapshot } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { PrismaChildRunReservationRepository } from "../prisma-child-run-reservation-repository";
import { __DigestRunInputSnapshot } from "../run-input-snapshot-digest";
import type { ChildRunReservationCommand } from "../child-run-reservation.types";

/** Builds a digest-sealed snapshot with the smallest valid runtime input for a reservation test. */
function _snapshot(runId: string, serviceId: string, revisionId: string, conversationId: string | null = null): RunInputSnapshot
{
	const value = {
		runId,
		siloId: "silo-1",
		agentServiceId: serviceId,
		agentRevisionId: revisionId,
		snapshotVersion: 1,
		conversationId,
		messageIds: [],
		personaRevisionId: null,
		preferenceFactIds: [],
		artifactRevisionIds: [],
		skillRevisionIds: [],
		memoryQueryPolicy: { scope: "none" },
		mcpTools: [],
		modelRoute: { alias: "test" },
		budgetPolicy: { maxTokens: 1_000, maxCostUsdMicros: 5_000_000 },
		identitySnapshot: {
			kind: RunInputSnapshotIdentityKinds.User,
			executionIssuer: "https://issuer.test",
			executionSubjectId: "user-1",
			principalId: "principal-1",
			fleetMembershipRevision: 1,
			fleetMembershipIssuer: "issuer",
			fleetMembershipIssuerKeyId: "key",
			fleetMembershipAssertionId: "assertion",
			fleetMembershipPayloadDigest: `sha256:${"a".repeat(64)}`,
			fleetMembershipTrustedUntil: "2026-07-30T00:00:00.000Z",
		},
		capabilitySetDigest: `sha256:${"b".repeat(64)}`,
		effectiveContractDigest: `sha256:${"c".repeat(64)}`,
		promptCompilerVersion: "v1",
		compiledAt: "2026-07-26T00:00:00.000Z",
	} as const;
	return { ...value, digest: __DigestRunInputSnapshot(value) };
}

/** Builds the parent-derived child reservation command shared by persistence and replay tests. */
function _command(parent: RunInputSnapshot, suppliedDepth: number = 2): ChildRunReservationCommand
{
	const command: ChildRunReservationCommand = {
		requestIdempotencyKey: "child-request",
		parentSnapshotDigest: parent.digest,
		prepared: {
			depth: suppliedDepth,
			runId: "child-1",
			parentRunId: "parent-1",
			rootRunId: "root-1",
			siloId: "silo-1",
			executionSubjectId: "user-1",
			agentServiceId: "child-service",
			agentRevisionId: "child-revision",
			trigger: "managed_invocation",
			budget: { maxTokens: 100, maxCostUsdMicros: 500_000 },
		},
		limits: { maximumDepth: 3, maximumChildrenPerParent: 2 },
		targetAuthorization: { authorize: async function _authorize() { return { outcome: "authorized" }; } },
	};
	return command;
}

/** Wraps a transaction double in the root-client transaction contract used by the repository. */
function _prisma<TTransaction>(transaction: TTransaction): PrismaClient
{
	const prisma = {
		$transaction: vi.fn(async function _transaction(callback: (client: TTransaction) => Promise<unknown>) { return callback(transaction); }),
	};
	return prisma as unknown as PrismaClient;
}

describe("PrismaChildRunReservationRepository", function _describeReservationRepository()
{
	it("rechecks a running parent and atomically persists its bounded child authority", async function _persistsReservation()
	{
		const parent = _snapshot("parent-1", "parent-service", "parent-revision");
		const childBase = _snapshot("child-1", "child-service", "child-revision", "conversation-1");
		const child = { ...childBase, budgetPolicy: { maxTokens: 100, maxCostUsdMicros: 500_000 } };
		const childSnapshot = { ...child, digest: __DigestRunInputSnapshot(child) };
		const transaction = {
			agentRun: {
				findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
					id: "parent-1",
					state: AgentRunState.Running,
					siloId: "silo-1",
					rootRunId: "root-1",
					parentRunId: "root-1",
					inputSnapshotDigest: parent.digest,
				}),
				create: vi.fn(),
			},
			runInputSnapshot: { findUnique: vi.fn().mockResolvedValue({ ...parent, compiledAt: new Date(parent.compiledAt) }), create: vi.fn() },
			childRunReservation: {
				findUnique: vi.fn().mockResolvedValue({ depth: 1 }),
				aggregate: vi.fn().mockResolvedValue({ _count: { childRunId: 0 }, _sum: { maxTokens: null, maxCostUsdMicros: null } }),
				create: vi.fn(),
			},
		};
		const repository = new PrismaChildRunReservationRepository(_prisma(transaction));
		const result = await repository.reserve(_command(parent, 99), { build: async function _build() { return { snapshot: childSnapshot, effectiveContractDigest: childSnapshot.effectiveContractDigest }; } });
		const acceptedAt = new Date(childSnapshot.compiledAt);

		expect(result).toEqual({ outcome: "reserved", snapshot: childSnapshot });
		expect(transaction.agentRun.create).toHaveBeenCalledWith({ data: {
			id: "child-1",
			siloId: "silo-1",
			agentServiceId: "child-service",
			agentRevisionId: "child-revision",
			conversationId: "conversation-1",
			trigger: AgentRunTrigger.ManagedInvocation,
			delegatedUserId: null,
			requestIdempotencyKey: "child-request",
			rootRunId: "root-1",
			parentRunId: "parent-1",
			effectiveContractDigest: childSnapshot.effectiveContractDigest,
			inputSnapshotDigest: childSnapshot.digest,
			acceptedAt,
		} });
		expect(transaction.runInputSnapshot.create).toHaveBeenCalledWith({ data: {
			runId: childSnapshot.runId,
			snapshotVersion: childSnapshot.snapshotVersion,
			siloId: childSnapshot.siloId,
			agentServiceId: childSnapshot.agentServiceId,
			agentRevisionId: childSnapshot.agentRevisionId,
			effectiveContractDigest: childSnapshot.effectiveContractDigest,
			personaRevisionId: childSnapshot.personaRevisionId,
			conversationId: childSnapshot.conversationId,
			messageIds: [],
			preferenceFactIds: [],
			artifactRevisionIds: [],
			identitySnapshot: childSnapshot.identitySnapshot,
			modelRoute: childSnapshot.modelRoute,
			mcpTools: [],
			skillRevisionIds: [],
			memoryQueryPolicy: childSnapshot.memoryQueryPolicy,
			budgetPolicy: childSnapshot.budgetPolicy,
			capabilitySetDigest: childSnapshot.capabilitySetDigest,
			promptCompilerVersion: childSnapshot.promptCompilerVersion,
			digest: childSnapshot.digest,
			compiledAt: acceptedAt,
		} });
		expect(transaction.childRunReservation.create).toHaveBeenCalledWith({ data: {
			childRunId: "child-1",
			parentRunId: "parent-1",
			rootRunId: "root-1",
			depth: 2,
			maxTokens: 100,
			maxCostUsdMicros: 500_000n,
		} });
		expect(transaction.agentRun.create.mock.invocationCallOrder[0]).toBeLessThan(transaction.runInputSnapshot.create.mock.invocationCallOrder[0] ?? 0);
		expect(transaction.runInputSnapshot.create.mock.invocationCallOrder[0]).toBeLessThan(transaction.childRunReservation.create.mock.invocationCallOrder[0] ?? 0);
	});

	it("returns the sealed persisted snapshot for an exact idempotent replay", async function _replaysExactChild()
	{
		const parent = _snapshot("parent-1", "parent-service", "parent-revision");
		const childBase = _snapshot("child-1", "child-service", "child-revision", "conversation-1");
		const child = { ...childBase, budgetPolicy: { maxTokens: 100, maxCostUsdMicros: 500_000 } };
		const childSnapshot = { ...child, digest: __DigestRunInputSnapshot(child) };
		const transaction = {
			agentRun: {
				findUnique: vi.fn().mockResolvedValue({
					id: "child-1",
					siloId: "silo-1",
					agentServiceId: "child-service",
					agentRevisionId: "child-revision",
					parentRunId: "parent-1",
					rootRunId: "root-1",
					trigger: AgentRunTrigger.ManagedInvocation,
					inputSnapshotDigest: childSnapshot.digest,
				}),
				create: vi.fn(),
			},
			runInputSnapshot: { findUnique: vi.fn().mockResolvedValue({ id: "snapshot-1", ...childSnapshot, compiledAt: new Date(childSnapshot.compiledAt) }), create: vi.fn() },
			childRunReservation: { findUnique: vi.fn().mockResolvedValue({ depth: 2, maxTokens: 100, maxCostUsdMicros: 500_000n }), aggregate: vi.fn(), create: vi.fn() },
		};
		const repository = new PrismaChildRunReservationRepository(_prisma(transaction));
		const result = await repository.reserve(_command(parent), { build: vi.fn() });

		expect(result).toEqual({ outcome: "idempotent", snapshot: childSnapshot });
		expect(transaction.agentRun.create).not.toHaveBeenCalled();
		expect(transaction.runInputSnapshot.create).not.toHaveBeenCalled();
		expect(transaction.childRunReservation.create).not.toHaveBeenCalled();
	});
});
