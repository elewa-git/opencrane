import { Prisma, RunOutboxEventKind, type PrismaClient } from "@prisma/client";

import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import type { RunInputSnapshot } from "@opencrane/contracts";
import { ___CreateLogger, type Logger } from "@opencrane/observability";
import { ___CloneCanonicalJson } from "@opencrane/util";
import type { JsonValue } from "@opencrane/util";

import type { ChildRunReservationBuild, ChildRunReservationCommand, ChildRunReservationParent, ChildRunReservationRepository, ChildRunReservationResult } from "./child-run-reservation.types.js";

/**
 * Prisma-backed authority for one governed child run.
 *
 * It serialises every prospective sibling on the parent row, then commits the derived child,
 * immutable snapshot, immutable reservation, and initial dispatch events together. Any incomplete
 * parent authority or persistence failure is a denial rather than a partially visible child.
 */
export class PrismaChildRunReservationRepository implements ChildRunReservationRepository
{
	/** Canonical OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient;
	/** Structured persistence-failure signal with process-wide secret redaction. */
	private readonly log: Logger;

	/**
	 * Creates a child-run reservation authority over canonical Postgres.
	 * @param prisma - Canonical product-authority database client.
	 * @param log - Structured redacting logger for otherwise fail-closed persistence failures.
	 */
	constructor(prisma: PrismaClient, log: Logger = ___CreateLogger("child-run-reservation"))
	{
		this.prisma = prisma;
		this.log = log;
	}

	/**
	 * Locks one parent, revalidates its frozen authority, and atomically reserves one derived child.
	 */
	async reserve(command: ChildRunReservationCommand, build: (parent: ChildRunReservationParent) => Promise<ChildRunReservationBuild>): Promise<ChildRunReservationResult>
	{
		if (!_isCommandValid(command)) return { outcome: "denied", reason: "invalid_command" };
		try
		{
			return await this.prisma.$transaction(async function _reserve(transaction: Prisma.TransactionClient): Promise<ChildRunReservationResult>
			{
				// 1. Lock the parent before checking siblings so every accepted allocation observes the same durable lineage.
				await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_runs" WHERE "id" = ${command.parentRunId} FOR UPDATE`);
				const parentRun = await transaction.agentRun.findUnique({ where: { id: command.parentRunId } });
				if (parentRun === null) return { outcome: "denied", reason: "parent_unavailable" };
				if (parentRun.inputSnapshotDigest !== command.parentSnapshotDigest) return { outcome: "denied", reason: "parent_snapshot_stale" };

				// 2. Serialize the silo key while the parent remains locked, so duplicate delivery never builds a second child.
				await transaction.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${command.authorization.siloId}\u0000${command.requestIdempotencyKey}`}, 0))`);
				const parentSnapshot = await transaction.runInputSnapshot.findUnique({ where: { runId_digest: { runId: parentRun.id, digest: parentRun.inputSnapshotDigest } } });
				if (parentSnapshot === null) return { outcome: "denied", reason: "persistence_unavailable" };
				if (!_matchesParent(parentRun, parentSnapshot, command)) return { outcome: "denied", reason: "authority_conflict" };

				const existing = await transaction.agentRun.findUnique({ where: { siloId_requestIdempotencyKey: { siloId: command.authorization.siloId, requestIdempotencyKey: command.requestIdempotencyKey } } });
				if (existing !== null) return _idempotentResult(transaction, existing, command);
				const aggregate = await transaction.childRunReservation.aggregate({ where: { parentRunId: parentRun.id }, _count: { childRunId: true }, _sum: { maxModelTurns: true, maxTotalTokens: true, maxCostUsdMicros: true, maxDurationMs: true } });
				if (!_hasRemainingCapacity(parentSnapshot, aggregate, command)) return { outcome: "denied", reason: "authority_conflict" };

				// 3. Build only after locks and exact parent evidence are held, preventing stale or sibling-expanded compilation.
				const value = await build({ snapshot: _snapshot(parentSnapshot), agentServiceId: parentRun.agentServiceId });
				if (!_matchesBuild(value, _snapshot(parentSnapshot), command)) return { outcome: "denied", reason: "authority_conflict" };

				// 4. Commit every durable child authority record and initial dispatch events in this same parent-fenced transaction.
				await _persistReservation(transaction, command, value);
				return { outcome: "reserved", snapshot: value.snapshot };
			});
		}
		catch (error)
		{
			this.log.error({ err: error, childRunId: command.childRunId, parentRunId: command.parentRunId, siloId: command.authorization.siloId, failureKind: "transaction_failed" }, "child run reservation persistence failed");
			return { outcome: "denied", reason: "persistence_unavailable" };
		}
	}
}

/** Returns whether a caller provided enough well-formed coordinates for a fail-closed reservation attempt. */
function _isCommandValid(command: ChildRunReservationCommand): boolean
{
	const authorization = command.authorization;
	return _present(command.childRunId) && _present(command.requestIdempotencyKey) && _present(command.parentRunId) && _digest(command.parentSnapshotDigest)
		&& _present(authorization.siloId) && _present(authorization.rootRunId) && authorization.parentRunId === command.parentRunId
		&& _present(authorization.agentServiceId) && _digest(authorization.capabilitySetDigest) && Number.isSafeInteger(authorization.depth) && authorization.depth > 0
		&& Number.isSafeInteger(command.maximumChildrenPerParent) && command.maximumChildrenPerParent >= 0
		&& _positiveBudget(authorization.budget.maxModelTurns) && _positiveBudget(authorization.budget.maxTotalTokens) && _positiveBudget(authorization.budget.maxCostUsdMicros) && _positiveBudget(authorization.budget.maxDurationMs);
}

/** Returns whether durable sibling allocations and fan-out leave capacity in the immutable parent policy. */
function _hasRemainingCapacity(parentSnapshot: { budgetPolicy: Prisma.JsonValue; compiledAt: Date }, aggregate: { _count: { childRunId: number }; _sum: { maxModelTurns: number | null; maxTotalTokens: number | null; maxCostUsdMicros: bigint | null; maxDurationMs: number | null } }, command: ChildRunReservationCommand): boolean
{
	const capacity = _parentCapacity(parentSnapshot.budgetPolicy, parentSnapshot.compiledAt);
	if (capacity === null || aggregate._count.childRunId >= command.maximumChildrenPerParent) return false;
	const allocation = command.authorization.budget;
	return _within(capacity.maxModelTurns, aggregate._sum.maxModelTurns, allocation.maxModelTurns)
		&& _within(capacity.maxTotalTokens, aggregate._sum.maxTotalTokens, allocation.maxTotalTokens)
		&& _withinBigInt(capacity.maxCostUsdMicros, aggregate._sum.maxCostUsdMicros, allocation.maxCostUsdMicros)
		&& _within(capacity.maxDurationMs, aggregate._sum.maxDurationMs, allocation.maxDurationMs);
}

/** Parses the frozen parent budget policy into the four finite capacities that children may reserve. */
function _parentCapacity(value: Prisma.JsonValue, compiledAt: Date): { readonly maxModelTurns: number; readonly maxTotalTokens: number; readonly maxCostUsdMicros: number; readonly maxDurationMs: number } | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
	const policy = value as Record<string, unknown>;
	const deadline = policy["wallClockDeadlineEpochMs"];
	const duration = typeof deadline === "number" ? deadline - compiledAt.getTime() : NaN;
	return _positiveBudget(policy["maxModelTurns"]) && _positiveBudget(policy["maxTotalTokens"]) && _positiveBudget(policy["maxCostUsdMicros"]) && _positiveBudget(duration)
		? { maxModelTurns: policy["maxModelTurns"], maxTotalTokens: policy["maxTotalTokens"], maxCostUsdMicros: policy["maxCostUsdMicros"], maxDurationMs: duration }
		: null;
}

/** Returns whether an existing total plus one candidate allocation remains inside one finite capacity. */
function _within(capacity: number, consumed: number | null, requested: number): boolean
{
	return Number.isSafeInteger(consumed ?? 0) && (consumed ?? 0) >= 0 && requested <= capacity - (consumed ?? 0);
}

/** Returns whether an existing bigint cost allocation plus one candidate remains within the parent ceiling. */
function _withinBigInt(capacity: number, consumed: bigint | null, requested: number): boolean
{
	return consumed !== null && consumed < 0n ? false : BigInt(requested) <= BigInt(capacity) - (consumed ?? 0n);
}

/** Returns whether the locked parent and its snapshot exactly bind the detached authorization coordinates. */
function _matchesParent(parentRun: { id: string; siloId: string; rootRunId: string; inputSnapshotDigest: string }, parentSnapshot: { runId: string; siloId: string; digest: string }, command: ChildRunReservationCommand): boolean
{
	return parentRun.id === command.authorization.parentRunId && parentRun.siloId === command.authorization.siloId
		&& parentRun.rootRunId === command.authorization.rootRunId && parentRun.inputSnapshotDigest === command.parentSnapshotDigest
		&& parentSnapshot.runId === parentRun.id && parentSnapshot.siloId === parentRun.siloId && parentSnapshot.digest === command.parentSnapshotDigest;
}

/** Returns an existing first child only when all durable reservation coordinates match this request exactly. */
async function _idempotentResult(transaction: Prisma.TransactionClient, existing: { id: string; siloId: string; agentServiceId: string; parentRunId: string | null; rootRunId: string; trigger: string; inputSnapshotDigest: string }, command: ChildRunReservationCommand): Promise<ChildRunReservationResult>
{
	if (existing.id !== command.childRunId || existing.siloId !== command.authorization.siloId || existing.agentServiceId !== command.authorization.agentServiceId
		|| existing.parentRunId !== command.authorization.parentRunId || existing.rootRunId !== command.authorization.rootRunId || existing.trigger !== "ManagedInvocation") return { outcome: "denied", reason: "authority_conflict" };
	const reservation = await transaction.childRunReservation.findUnique({ where: { childRunId: existing.id } });
	if (!_matchesReservation(reservation, command)) return { outcome: "denied", reason: "authority_conflict" };
	const snapshot = await transaction.runInputSnapshot.findUnique({ where: { runId_digest: { runId: existing.id, digest: existing.inputSnapshotDigest } } });
	if (snapshot === null || !_matchesExistingSnapshot(snapshot, command)) return { outcome: "denied", reason: "authority_conflict" };
	return { outcome: "idempotent", snapshot: _snapshot(snapshot) };
}

/** Returns whether the immutable reservation retained exactly the parent-authorised finite allocation. */
function _matchesReservation(reservation: { childRunId: string; parentRunId: string; rootRunId: string; depth: number; maxModelTurns: number; maxTotalTokens: number; maxCostUsdMicros: bigint; maxDurationMs: number; task: Prisma.JsonValue; taskDigest: string } | null, command: ChildRunReservationCommand): boolean
{
	return reservation !== null && reservation.childRunId === command.childRunId && reservation.parentRunId === command.authorization.parentRunId && reservation.rootRunId === command.authorization.rootRunId
		&& reservation.depth === command.authorization.depth && reservation.maxModelTurns === command.authorization.budget.maxModelTurns
		&& reservation.maxTotalTokens === command.authorization.budget.maxTotalTokens && reservation.maxCostUsdMicros === BigInt(command.authorization.budget.maxCostUsdMicros) && reservation.maxDurationMs === command.authorization.budget.maxDurationMs
		&& reservation.taskDigest === __DigestCanonicalJson(command.authorization.task) && _sameJson(reservation.task, command.authorization.task);
}

/** Returns whether a rebuilt child has the exact reservation-bound coordinates and context subset. */
function _matchesBuild(value: ChildRunReservationBuild, parent: RunInputSnapshot, command: ChildRunReservationCommand): boolean
{
	const snapshot = value.snapshot;
	const context = command.authorization.context;
	return snapshot.runId === command.childRunId && snapshot.siloId === command.authorization.siloId && snapshot.agentServiceId === command.authorization.agentServiceId
		&& snapshot.agentRevisionId === value.agentRevisionId && snapshot.effectiveContractDigest === value.effectiveContractDigest
		&& snapshot.capabilitySetDigest === command.authorization.capabilitySetDigest && _sameStrings(snapshot.messageIds, context.messageIds)
		&& _sameStrings(snapshot.memoryFacts.map(function _factId(fact): string { return fact.factId; }), context.memoryFactIds)
		&& _sameStrings(snapshot.artifactRevisionIds, context.artifactRevisionIds) && _sameStrings(snapshot.skillRevisionIds, context.skillRevisionIds)
		&& snapshot.threadId === parent.threadId
		&& snapshot.personaRevisionId === parent.personaRevisionId && _sameStrings(snapshot.preferenceFactIds, parent.preferenceFactIds)
		&& _sameJson(snapshot.memoryQueryPolicy, parent.memoryQueryPolicy) && _sameJson(snapshot.integrationAssignments, parent.integrationAssignments)
		&& _sameJson(snapshot.modelRoute, parent.modelRoute) && _sameJson(snapshot.identitySnapshot, parent.identitySnapshot)
		&& _matchesChildBudget(snapshot, command.authorization.budget);
}

/** Returns whether the runtime-visible child budget exactly represents the durable reservation allocation. */
function _matchesChildBudget(snapshot: RunInputSnapshot, budget: { readonly maxModelTurns: number; readonly maxTotalTokens: number; readonly maxCostUsdMicros: number; readonly maxDurationMs: number }): boolean
{
	if (snapshot.budgetPolicy === null || typeof snapshot.budgetPolicy !== "object" || Array.isArray(snapshot.budgetPolicy)) return false;
	const policy = snapshot.budgetPolicy as Record<string, unknown>;
	const expectedDeadline = Date.parse(snapshot.compiledAt) + budget.maxDurationMs;
	return policy["maxModelTurns"] === budget.maxModelTurns && policy["maxTotalTokens"] === budget.maxTotalTokens && policy["maxCostUsdMicros"] === budget.maxCostUsdMicros && policy["wallClockDeadlineEpochMs"] === expectedDeadline;
}

/** Returns whether two JSON values are equal after canonicalisation removes object-key ordering ambiguity. */
function _sameJson(left: unknown, right: unknown): boolean
{
	return JSON.stringify(___CloneCanonicalJson(left as JsonValue)) === JSON.stringify(___CloneCanonicalJson(right as JsonValue));
}

/** Returns whether a recovered child snapshot still proves the immutable idempotency authority scope. */
function _matchesExistingSnapshot(snapshot: { runId: string; siloId: string; agentServiceId: string; capabilitySetDigest: string }, command: ChildRunReservationCommand): boolean
{
	return snapshot.runId === command.childRunId && snapshot.siloId === command.authorization.siloId
		&& snapshot.agentServiceId === command.authorization.agentServiceId && snapshot.capabilitySetDigest === command.authorization.capabilitySetDigest;
}

/** Persists one child run, its frozen snapshot, immutable reservation, and initial dispatch events. */
async function _persistReservation(transaction: Prisma.TransactionClient, command: ChildRunReservationCommand, value: ChildRunReservationBuild): Promise<void>
{
	await transaction.agentRun.create({ data: {
		id: command.childRunId, siloId: command.authorization.siloId, agentServiceId: command.authorization.agentServiceId, agentRevisionId: value.agentRevisionId,
		threadId: value.snapshot.threadId, trigger: "ManagedInvocation", delegatedUserId: null, requestIdempotencyKey: command.requestIdempotencyKey,
		rootRunId: command.authorization.rootRunId, parentRunId: command.authorization.parentRunId, effectiveContractDigest: value.effectiveContractDigest, inputSnapshotDigest: value.snapshot.digest,
	} });
	await transaction.runInputSnapshot.create({ data: _snapshotData(value.snapshot) });
	await transaction.childRunReservation.create({ data: {
		childRunId: command.childRunId, parentRunId: command.authorization.parentRunId, rootRunId: command.authorization.rootRunId, depth: command.authorization.depth,
		maxModelTurns: command.authorization.budget.maxModelTurns, maxTotalTokens: command.authorization.budget.maxTotalTokens, maxCostUsdMicros: BigInt(command.authorization.budget.maxCostUsdMicros), maxDurationMs: command.authorization.budget.maxDurationMs,
		task: _json(command.authorization.task), taskDigest: __DigestCanonicalJson(command.authorization.task),
	} });
	await transaction.outboxEvent.createMany({ data: [
		{ runId: command.childRunId, attempt: 1, sequence: 1, kind: RunOutboxEventKind.RunAccepted, idempotencyKey: `${command.childRunId}:accepted`, payload: { runId: command.childRunId, inputSnapshotDigest: value.snapshot.digest } },
		{ runId: command.childRunId, attempt: 1, sequence: 2, kind: RunOutboxEventKind.RunAttemptRequested, idempotencyKey: `${command.childRunId}:attempt:1`, payload: { runId: command.childRunId, attempt: 1, inputSnapshotDigest: value.snapshot.digest } },
	] });
}

/** Returns whether two ordered immutable identifier lists are equal without accepting reordering or duplicates. */
function _sameStrings(actual: readonly string[], expected: readonly string[]): boolean
{
	return actual.length === expected.length && actual.every(function _matches(value, index): boolean { return value === expected[index]; });
}

/** Maps an immutable contract snapshot into its canonical Postgres row. */
function _snapshotData(snapshot: RunInputSnapshot): Prisma.RunInputSnapshotUncheckedCreateInput
{
	return {
		runId: snapshot.runId, snapshotVersion: snapshot.snapshotVersion, siloId: snapshot.siloId, agentServiceId: snapshot.agentServiceId, agentRevisionId: snapshot.agentRevisionId,
		effectiveContractDigest: snapshot.effectiveContractDigest, personaRevisionId: snapshot.personaRevisionId, threadId: snapshot.threadId, messageIds: [...snapshot.messageIds],
		preferenceFactIds: [...snapshot.preferenceFactIds], artifactRevisionIds: [...snapshot.artifactRevisionIds], memoryFacts: _json(snapshot.memoryFacts), identitySnapshot: _json(snapshot.identitySnapshot),
		modelRoute: _json(snapshot.modelRoute), integrationAssignments: _json(snapshot.integrationAssignments), skillRevisionIds: [...snapshot.skillRevisionIds], memoryQueryPolicy: _json(snapshot.memoryQueryPolicy),
		budgetPolicy: _json(snapshot.budgetPolicy), capabilitySetDigest: snapshot.capabilitySetDigest, promptCompilerVersion: snapshot.promptCompilerVersion, digest: snapshot.digest, compiledAt: new Date(snapshot.compiledAt),
	};
}

/** Deep-copies JSON through canonical form before Prisma owns the durable payload. */
function _json(value: unknown): Prisma.InputJsonValue
{
	return ___CloneCanonicalJson(value as JsonValue) as Prisma.InputJsonValue;
}

/** Maps one persisted snapshot row back into the immutable cross-domain contract. */
function _snapshot(row: { runId: string; siloId: string; agentServiceId: string; agentRevisionId: string; snapshotVersion: number; threadId: string | null; messageIds: string[]; personaRevisionId: string | null; preferenceFactIds: string[]; artifactRevisionIds: string[]; skillRevisionIds: string[]; memoryFacts: Prisma.JsonValue; memoryQueryPolicy: Prisma.JsonValue; integrationAssignments: Prisma.JsonValue; modelRoute: Prisma.JsonValue; budgetPolicy: Prisma.JsonValue; identitySnapshot: Prisma.JsonValue; capabilitySetDigest: string; effectiveContractDigest: string; promptCompilerVersion: string; digest: string; compiledAt: Date }): RunInputSnapshot
{
	return {
		runId: row.runId, siloId: row.siloId, agentServiceId: row.agentServiceId, agentRevisionId: row.agentRevisionId, snapshotVersion: row.snapshotVersion, threadId: row.threadId,
		messageIds: row.messageIds, personaRevisionId: row.personaRevisionId, preferenceFactIds: row.preferenceFactIds, artifactRevisionIds: row.artifactRevisionIds, skillRevisionIds: row.skillRevisionIds,
		memoryFacts: row.memoryFacts as unknown as RunInputSnapshot["memoryFacts"], memoryQueryPolicy: row.memoryQueryPolicy as RunInputSnapshot["memoryQueryPolicy"], integrationAssignments: row.integrationAssignments as unknown as RunInputSnapshot["integrationAssignments"],
		modelRoute: row.modelRoute as RunInputSnapshot["modelRoute"], budgetPolicy: row.budgetPolicy as RunInputSnapshot["budgetPolicy"], identitySnapshot: row.identitySnapshot as unknown as RunInputSnapshot["identitySnapshot"],
		capabilitySetDigest: row.capabilitySetDigest, effectiveContractDigest: row.effectiveContractDigest, promptCompilerVersion: row.promptCompilerVersion, digest: row.digest, compiledAt: row.compiledAt.toISOString(),
	};
}

/** Returns whether a value is a non-whitespace identifier. */
function _present(value: string): boolean
{
	return value.trim().length > 0;
}

/** Returns whether a value is a canonical SHA-256 content digest. */
function _digest(value: string): boolean
{
	return /^sha256:[0-9a-f]{64}$/u.test(value);
}

/** Returns whether a finite delegated allocation is a positive safe integer. */
function _positiveBudget(value: unknown): value is number
{
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
