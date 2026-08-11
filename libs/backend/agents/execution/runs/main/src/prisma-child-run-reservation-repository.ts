import { Prisma, RunOutboxEventKind, type PrismaClient } from "@prisma/client";

import type { RunInputSnapshot } from "@opencrane/contracts";
import { ___CreateLogger, type Logger } from "@opencrane/backend/observability";
import { ___CloneCanonicalJson } from "@opencrane/util";
import type { JsonValue } from "@opencrane/util";

import { __PrepareChildRunAdmission } from "./child-run-admission.js";
import { __DigestRunInputSnapshot } from "./run-input-snapshot-digest.js";
import type { ChildRunReservationBuild, ChildRunReservationCommand, ChildRunReservationRepository, ChildRunReservationResult } from "./child-run-reservation.types.js";

/** Atomically persists one child admission while its direct parent is locked. */
export class PrismaChildRunReservationRepository implements ChildRunReservationRepository
{
	/** Canonical product-authority database client. */
	private readonly prisma: PrismaClient;
	/** Structured redacting log for fail-closed persistence faults. */
	private readonly log: Logger;

	/** Creates the transaction-owning child-run reservation repository. */
	constructor(prisma: PrismaClient, log: Logger = ___CreateLogger("child-run-reservation"))
	{
		this.prisma = prisma;
		this.log = log;
	}

	/** Rechecks and commits a child run, snapshot, immutable reservation, and initial outbox together. */
	async reserve(command: ChildRunReservationCommand, build: ChildRunReservationBuild): Promise<ChildRunReservationResult>
	{
		if (!_isValidCommand(command)) return { outcome: "denied", reason: "invalid_command" };
		try
		{
			return await this.prisma.$transaction(async function _reserve(transaction): Promise<ChildRunReservationResult>
			{
				// 1. Serialize one inherited-silo key before observing or creating a child.
				await transaction.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${command.prepared.siloId}\u0000${command.requestIdempotencyKey}`}, 0))`);
				const existing = await transaction.agentRun.findUnique({ where: { siloId_requestIdempotencyKey: { siloId: command.prepared.siloId, requestIdempotencyKey: command.requestIdempotencyKey } } });
				if (existing !== null)
				{
					const reservation = await transaction.childRunReservation.findUnique({ where: { childRunId: existing.id } });
					const existingSnapshot = await transaction.runInputSnapshot.findUnique({ where: { runId_digest: { runId: existing.id, digest: existing.inputSnapshotDigest } } });
					if (reservation !== null && existingSnapshot !== null && existing.id === command.prepared.runId && existing.siloId === command.prepared.siloId && existing.agentServiceId === command.prepared.agentServiceId && existing.agentRevisionId === command.prepared.agentRevisionId && existing.parentRunId === command.prepared.parentRunId && existing.rootRunId === command.prepared.rootRunId && existing.trigger === "ManagedInvocation" && reservation.depth === command.prepared.depth && reservation.maxTokens === command.prepared.budget.maxTokens && reservation.maxCostUsdMicros === BigInt(command.prepared.budget.maxCostUsdMicros)) return { outcome: "idempotent", snapshot: _rowSnapshot(existingSnapshot) };
					return { outcome: "denied", reason: "authority_conflict" };
				}

				// 2. Lock the parent before calculating capacity, preventing concurrent siblings from over-reserving it.
				await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_runs" WHERE "id" = ${command.prepared.parentRunId} FOR UPDATE`);
				const parent = await transaction.agentRun.findUnique({ where: { id: command.prepared.parentRunId } });
				if (parent === null || parent.state !== "Running" || parent.siloId !== command.prepared.siloId || parent.rootRunId !== command.prepared.rootRunId || parent.inputSnapshotDigest !== command.parentSnapshotDigest) return { outcome: "denied", reason: "parent_not_admittable" };
				const snapshot = await transaction.runInputSnapshot.findUnique({ where: { runId_digest: { runId: parent.id, digest: parent.inputSnapshotDigest } } });
				if (snapshot === null || !_isParentSnapshot(snapshot, command)) return { outcome: "denied", reason: "parent_snapshot_stale" };
				const parentReservation = parent.parentRunId === null ? null : await transaction.childRunReservation.findUnique({ where: { childRunId: parent.id } });
				if (parent.parentRunId !== null && parentReservation === null) return { outcome: "denied", reason: "parent_not_admittable" };

				// 3. Sum durable direct-child allocations and run target authorization again inside the parent fence.
				const aggregate = await transaction.childRunReservation.aggregate({ where: { parentRunId: parent.id }, _count: { childRunId: true }, _sum: { maxTokens: true, maxCostUsdMicros: true } });
				const parentAuthority = _parentAuthority(parent, snapshot, aggregate, parentReservation?.depth ?? 0);
				if (parentAuthority === null) return { outcome: "denied", reason: "parent_snapshot_stale" };
				const prepared = await __PrepareChildRunAdmission(parentAuthority, { childRunId: command.prepared.runId, targetAgentServiceId: command.prepared.agentServiceId, targetAgentRevisionId: command.prepared.agentRevisionId, requestedBudget: command.prepared.budget }, command.limits, command.targetAuthorization);
				if (prepared.outcome === "denied") return prepared;

				// 4. Build and persist only an exact child snapshot, allocation, and dispatch pair in this transaction.
				const value = await build.build(prepared.value);
				if (!_isChildSnapshot(value.snapshot, prepared.value, value.effectiveContractDigest)) return { outcome: "denied", reason: "authority_conflict" };
				await _persist(transaction, command, value.snapshot, prepared.value);
				return { outcome: "reserved", snapshot: value.snapshot };
			});
		}
		catch (error)
		{
			this.log.error({ err: error, childRunId: command.prepared.runId, parentRunId: command.prepared.parentRunId, siloId: command.prepared.siloId, failureKind: "transaction_failed" }, "child run reservation persistence failed");
			return { outcome: "denied", reason: "persistence_unavailable" };
		}
	}
}

/** Returns whether a request has the fixed non-empty authority coordinates needed for a reservation. */
function _isValidCommand(command: ChildRunReservationCommand): boolean
{
	return command.requestIdempotencyKey.trim().length > 0 && /^sha256:[0-9a-f]{64}$/u.test(command.parentSnapshotDigest);
}

/** Returns a parent authority derived solely from locked rows and its frozen input snapshot. */
function _parentAuthority(parent: { id: string; siloId: string; rootRunId: string }, snapshot: { identitySnapshot: Prisma.JsonValue; budgetPolicy: Prisma.JsonValue }, aggregate: { _count: { childRunId: number }; _sum: { maxTokens: number | null; maxCostUsdMicros: bigint | null } }, depth: number): { runId: string; siloId: string; rootRunId: string; depth: number; executionSubjectId: string; remainingTokens: number; remainingCostUsdMicros: number; admittedChildCount: number } | null
{
	const identity = snapshot.identitySnapshot as Record<string, unknown>;
	const policy = snapshot.budgetPolicy as Record<string, unknown>;
	const subject = identity["executionSubjectId"];
	const tokens = policy["maxTokens"];
	const cost = policy["maxCostUsdMicros"];
	if (typeof subject !== "string" || subject.trim().length === 0 || !_positiveInteger(tokens) || !_positiveInteger(cost) || aggregate._sum.maxCostUsdMicros !== null && aggregate._sum.maxCostUsdMicros > BigInt(Number.MAX_SAFE_INTEGER)) return null;
	const usedTokens = aggregate._sum.maxTokens ?? 0;
	const usedCost = Number(aggregate._sum.maxCostUsdMicros ?? 0n);
	if (usedTokens < 0 || usedCost < 0) return null;
	return { runId: parent.id, siloId: parent.siloId, rootRunId: parent.rootRunId, depth, executionSubjectId: subject, remainingTokens: tokens - usedTokens, remainingCostUsdMicros: cost - usedCost, admittedChildCount: aggregate._count.childRunId };
}

/** Returns whether the locked parent snapshot exactly binds the requested parent identity. */
function _isParentSnapshot(snapshot: { runId: string; siloId: string; digest: string }, command: ChildRunReservationCommand): boolean
{
	return snapshot.runId === command.prepared.parentRunId && snapshot.siloId === command.prepared.siloId && snapshot.digest === command.parentSnapshotDigest;
}

/** Returns whether the assembled child snapshot retained only prepared run identity and allocation. */
function _isChildSnapshot(snapshot: RunInputSnapshot, prepared: { runId: string; siloId: string; agentServiceId: string; agentRevisionId: string; executionSubjectId: string; budget: { maxTokens: number; maxCostUsdMicros: number } }, effectiveContractDigest: string): boolean
{
	const { digest: _digest, ...withoutDigest } = snapshot;
	if (snapshot.runId !== prepared.runId || snapshot.siloId !== prepared.siloId || snapshot.agentServiceId !== prepared.agentServiceId || snapshot.agentRevisionId !== prepared.agentRevisionId || snapshot.effectiveContractDigest !== effectiveContractDigest || snapshot.identitySnapshot.executionSubjectId !== prepared.executionSubjectId || snapshot.digest !== __DigestRunInputSnapshot(withoutDigest)) return false;
	const budget = snapshot.budgetPolicy as Record<string, unknown>;
	return budget["maxTokens"] === prepared.budget.maxTokens && budget["maxCostUsdMicros"] === prepared.budget.maxCostUsdMicros;
}

/** Persists the four inseparable records that make a child eligible for dispatch. */
async function _persist(transaction: Prisma.TransactionClient, command: ChildRunReservationCommand, snapshot: RunInputSnapshot, prepared: { depth: number; runId: string; parentRunId: string; rootRunId: string; siloId: string; agentServiceId: string; agentRevisionId: string; budget: { maxTokens: number; maxCostUsdMicros: number } }): Promise<void>
{
	const now = new Date(snapshot.compiledAt);
	await transaction.agentRun.create({ data: { id: prepared.runId, siloId: prepared.siloId, agentServiceId: prepared.agentServiceId, agentRevisionId: prepared.agentRevisionId, conversationId: snapshot.conversationId, trigger: "ManagedInvocation", delegatedUserId: null, requestIdempotencyKey: command.requestIdempotencyKey, rootRunId: prepared.rootRunId, parentRunId: prepared.parentRunId, effectiveContractDigest: snapshot.effectiveContractDigest, inputSnapshotDigest: snapshot.digest, acceptedAt: now } });
	await transaction.runInputSnapshot.create({ data: _snapshotData(snapshot) });
	await transaction.childRunReservation.create({ data: { childRunId: prepared.runId, parentRunId: prepared.parentRunId, rootRunId: prepared.rootRunId, depth: prepared.depth, maxTokens: prepared.budget.maxTokens, maxCostUsdMicros: BigInt(prepared.budget.maxCostUsdMicros) } });
	await transaction.outboxEvent.createMany({ data: [{ runId: prepared.runId, attempt: 1, sequence: 1, kind: RunOutboxEventKind.RunAccepted, idempotencyKey: `${prepared.runId}:accepted`, payload: { runId: prepared.runId, inputSnapshotDigest: snapshot.digest }, availableAt: now }, { runId: prepared.runId, attempt: 1, sequence: 2, kind: RunOutboxEventKind.RunAttemptRequested, idempotencyKey: `${prepared.runId}:attempt:1`, payload: { runId: prepared.runId, attempt: 1, inputSnapshotDigest: snapshot.digest }, availableAt: now }] });
}

/** Maps the immutable contract snapshot into the owned Prisma persistence shape. */
function _snapshotData(snapshot: RunInputSnapshot): Prisma.RunInputSnapshotUncheckedCreateInput
{
	return { runId: snapshot.runId, snapshotVersion: snapshot.snapshotVersion, siloId: snapshot.siloId, agentServiceId: snapshot.agentServiceId, agentRevisionId: snapshot.agentRevisionId, effectiveContractDigest: snapshot.effectiveContractDigest, personaRevisionId: snapshot.personaRevisionId, conversationId: snapshot.conversationId, messageIds: [...snapshot.messageIds], preferenceFactIds: [...snapshot.preferenceFactIds], artifactRevisionIds: [...snapshot.artifactRevisionIds], memoryFacts: _json(snapshot.memoryFacts), identitySnapshot: _json(snapshot.identitySnapshot), modelRoute: _json(snapshot.modelRoute), integrationAssignments: _json(snapshot.integrationAssignments), skillRevisionIds: [...snapshot.skillRevisionIds], memoryQueryPolicy: _json(snapshot.memoryQueryPolicy), budgetPolicy: _json(snapshot.budgetPolicy), capabilitySetDigest: snapshot.capabilitySetDigest, promptCompilerVersion: snapshot.promptCompilerVersion, digest: snapshot.digest, compiledAt: new Date(snapshot.compiledAt) };
}

/** Makes a JSON-safe deep copy before Prisma owns an immutable snapshot field. */
function _json(value: unknown): Prisma.InputJsonValue
{
	return ___CloneCanonicalJson(value as JsonValue) as Prisma.InputJsonValue;
}

/** Maps a persisted immutable snapshot into the public runtime contract. */
function _rowSnapshot(row: { runId: string; siloId: string; agentServiceId: string; agentRevisionId: string; snapshotVersion: number; conversationId: string | null; messageIds: string[]; personaRevisionId: string | null; preferenceFactIds: string[]; artifactRevisionIds: string[]; skillRevisionIds: string[]; memoryFacts: Prisma.JsonValue; memoryQueryPolicy: Prisma.JsonValue; integrationAssignments: Prisma.JsonValue; modelRoute: Prisma.JsonValue; budgetPolicy: Prisma.JsonValue; identitySnapshot: Prisma.JsonValue; capabilitySetDigest: string; effectiveContractDigest: string; promptCompilerVersion: string; digest: string; compiledAt: Date }): RunInputSnapshot
{
	return { runId: row.runId, siloId: row.siloId, agentServiceId: row.agentServiceId, agentRevisionId: row.agentRevisionId, snapshotVersion: row.snapshotVersion, conversationId: row.conversationId, messageIds: row.messageIds, personaRevisionId: row.personaRevisionId, preferenceFactIds: row.preferenceFactIds, artifactRevisionIds: row.artifactRevisionIds, skillRevisionIds: row.skillRevisionIds, memoryFacts: row.memoryFacts as unknown as RunInputSnapshot["memoryFacts"], memoryQueryPolicy: row.memoryQueryPolicy as RunInputSnapshot["memoryQueryPolicy"], integrationAssignments: row.integrationAssignments as unknown as RunInputSnapshot["integrationAssignments"], modelRoute: row.modelRoute as RunInputSnapshot["modelRoute"], budgetPolicy: row.budgetPolicy as RunInputSnapshot["budgetPolicy"], identitySnapshot: row.identitySnapshot as unknown as RunInputSnapshot["identitySnapshot"], capabilitySetDigest: row.capabilitySetDigest, effectiveContractDigest: row.effectiveContractDigest, promptCompilerVersion: row.promptCompilerVersion, digest: row.digest, compiledAt: row.compiledAt.toISOString() };
}

/** Returns whether a JSON value is a positive safe-integer budget coordinate. */
function _positiveInteger(value: unknown): value is number
{
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
