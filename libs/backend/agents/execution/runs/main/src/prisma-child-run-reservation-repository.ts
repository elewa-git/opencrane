import { AgentRunState, Prisma, RunOutboxEventKind, type PrismaClient } from "@prisma/client";

import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import type { RunInputSnapshot } from "@opencrane/contracts";
import { ___CreateLogger, type Logger } from "@opencrane/observability";
import { ___CloneCanonicalJson } from "@opencrane/util";
import type { JsonValue } from "@opencrane/util";

import type { GovernedChildRunBudget, GovernedChildRunSpawnAuthorization } from "./child-run-admission.types.js";
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
	/** Server-owned clock used to bind every delegated duration to an absolute parent deadline. */
	private readonly nowEpochMs: () => number;

	/**
	 * Creates a child-run reservation authority over canonical Postgres.
	 * @param prisma - Canonical product-authority database client.
	 * @param log - Structured redacting logger for otherwise fail-closed persistence failures.
	 * @param nowEpochMs - Server-owned clock, injectable only to make authority boundary tests deterministic.
	 */
	constructor(prisma: PrismaClient, log: Logger = ___CreateLogger("child-run-reservation"), nowEpochMs: () => number = Date.now)
	{
		this.prisma = prisma;
		this.log = log;
		this.nowEpochMs = nowEpochMs;
	}

	/**
	 * Locks one parent, revalidates its frozen authority, and atomically reserves one derived child.
	 */
	async reserve(command: ChildRunReservationCommand, build: (parent: ChildRunReservationParent) => Promise<ChildRunReservationBuild | null>): Promise<ChildRunReservationResult>
	{
		if (!_isCommandValid(command)) return { outcome: "denied", reason: "invalid_command" };
		const nowEpochMs = this.nowEpochMs;
		try
		{
			return await this.prisma.$transaction(async function _reserve(transaction: Prisma.TransactionClient): Promise<ChildRunReservationResult>
			{
				// 1. Lock the parent before checking siblings so every accepted allocation observes the same durable lineage.
				await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_runs" WHERE "id" = ${command.parentRunId} FOR UPDATE`);
				const parentRun = await transaction.agentRun.findUnique({ where: { id: command.parentRunId } });
				if (parentRun === null) return { outcome: "denied", reason: "parent_unavailable" };
				if (parentRun.inputSnapshotDigest !== command.parentSnapshotDigest) return { outcome: "denied", reason: "parent_snapshot_stale" };
				if (parentRun.state !== AgentRunState.Running || parentRun.attempt !== command.parentAttempt) return { outcome: "denied", reason: "authority_conflict" };

				// 2. Serialize the silo key while the parent remains locked, so duplicate delivery never builds a second child.
				await transaction.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${command.request.siloId}\u0000${command.requestIdempotencyKey}`}, 0))`);
				const parentSnapshot = await transaction.runInputSnapshot.findUnique({ where: { runId_digest: { runId: parentRun.id, digest: parentRun.inputSnapshotDigest } } });
				if (parentSnapshot === null) return { outcome: "denied", reason: "persistence_unavailable" };
				if (!_matchesParent(parentRun, parentSnapshot, command)) return { outcome: "denied", reason: "authority_conflict" };

				const existing = await transaction.agentRun.findUnique({ where: { siloId_requestIdempotencyKey: { siloId: command.request.siloId, requestIdempotencyKey: command.requestIdempotencyKey } } });
				if (existing !== null) return _idempotentResult(transaction, existing, command);
				const aggregate = await transaction.childRunReservation.aggregate({ where: { parentRunId: parentRun.id }, _count: { childRunId: true }, _sum: { maxModelTurns: true, maxTotalTokens: true, maxCostUsdMicros: true, maxDurationMs: true } });
				const authorizedAtEpochMs = nowEpochMs();
				const remainingBudget = _remainingBudget(parentSnapshot, aggregate, authorizedAtEpochMs);
				if (remainingBudget === null || aggregate._count.childRunId >= command.maximumChildrenPerParent) return { outcome: "denied", reason: "authority_conflict" };
				const depth = await _parentDepth(transaction, parentRun);
				if (depth === null) return { outcome: "denied", reason: "authority_conflict" };

				// 3. Build only after locks and exact parent evidence are held, preventing stale or sibling-expanded compilation.
				const value = await build({ transaction, snapshot: _snapshot(parentSnapshot), agentServiceId: parentRun.agentServiceId, rootRunId: parentRun.rootRunId, depth, existingChildCount: aggregate._count.childRunId, remainingBudget, authorizedAt: new Date(authorizedAtEpochMs).toISOString() });
				if (value === null) return { outcome: "denied", reason: "authority_conflict" };
				if (!_matchesBuild(value, _snapshot(parentSnapshot), parentRun, command, depth, remainingBudget)) return { outcome: "denied", reason: "authority_conflict" };

				// 4. Commit every durable child authority record and initial dispatch events in this same parent-fenced transaction.
				await _persistReservation(transaction, command, value);
				return { outcome: "reserved", snapshot: value.snapshot };
			});
		}
		catch (error)
		{
			this.log.error({ err: error, childRunId: command.childRunId, parentRunId: command.parentRunId, siloId: command.request.siloId, failureKind: "transaction_failed" }, "child run reservation persistence failed");
			return { outcome: "denied", reason: "persistence_unavailable" };
		}
	}
}

/** Returns whether a caller provided enough well-formed coordinates for a fail-closed reservation attempt. */
function _isCommandValid(command: ChildRunReservationCommand): boolean
{
	return _present(command.childRunId) && _present(command.requestIdempotencyKey) && _present(command.parentRunId) && _digest(command.parentSnapshotDigest)
		&& Number.isSafeInteger(command.parentAttempt) && command.parentAttempt > 0
		&& _present(command.request.siloId) && _present(command.request.agentServiceId) && _digest(command.request.capabilitySetDigest)
		&& Number.isSafeInteger(command.maximumChildrenPerParent) && command.maximumChildrenPerParent >= 0
		&& _positiveBudget(command.request.budget.maxModelTurns) && _positiveBudget(command.request.budget.maxTotalTokens) && _positiveBudget(command.request.budget.maxCostUsdMicros) && _positiveBudget(command.request.budget.maxDurationMs);
}

/** Calculates capacity left after each earlier sibling reservation under the same parent lock. */
function _remainingBudget(parentSnapshot: { budgetPolicy: Prisma.JsonValue }, aggregate: { _sum: { maxModelTurns: number | null; maxTotalTokens: number | null; maxCostUsdMicros: bigint | null; maxDurationMs: number | null } }, authorizedAtEpochMs: number): GovernedChildRunBudget | null
{
	const capacity = _parentCapacity(parentSnapshot.budgetPolicy, authorizedAtEpochMs);
	if (capacity === null || !_validConsumed(aggregate)) return null;
	const maxCostUsdMicros = BigInt(capacity.maxCostUsdMicros) - (aggregate._sum.maxCostUsdMicros ?? 0n);
	if (maxCostUsdMicros <= 0n || maxCostUsdMicros > BigInt(Number.MAX_SAFE_INTEGER)) return null;
	const remaining = {
		maxModelTurns: capacity.maxModelTurns - (aggregate._sum.maxModelTurns ?? 0), maxTotalTokens: capacity.maxTotalTokens - (aggregate._sum.maxTotalTokens ?? 0), maxCostUsdMicros: Number(maxCostUsdMicros), maxDurationMs: capacity.maxDurationMs - (aggregate._sum.maxDurationMs ?? 0),
	};
	return _positiveBudget(remaining.maxModelTurns) && _positiveBudget(remaining.maxTotalTokens) && _positiveBudget(remaining.maxCostUsdMicros) && _positiveBudget(remaining.maxDurationMs) ? remaining : null;
}

/** Parses the frozen parent budget policy into the four finite capacities that children may reserve. */
function _parentCapacity(value: Prisma.JsonValue, authorizedAtEpochMs: number): { readonly maxModelTurns: number; readonly maxTotalTokens: number; readonly maxCostUsdMicros: number; readonly maxDurationMs: number } | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
	const policy = value as Record<string, unknown>;
	const deadline = policy["wallClockDeadlineEpochMs"];
	const duration = typeof deadline === "number" ? deadline - authorizedAtEpochMs : NaN;
	return _positiveBudget(policy["maxModelTurns"]) && _positiveBudget(policy["maxTotalTokens"]) && _positiveBudget(policy["maxCostUsdMicros"]) && _positiveBudget(duration)
		? { maxModelTurns: policy["maxModelTurns"], maxTotalTokens: policy["maxTotalTokens"], maxCostUsdMicros: policy["maxCostUsdMicros"], maxDurationMs: duration }
		: null;
}

/** Returns whether every aggregate total is a non-negative safe value before it informs an authority decision. */
function _validConsumed(aggregate: { _sum: { maxModelTurns: number | null; maxTotalTokens: number | null; maxCostUsdMicros: bigint | null; maxDurationMs: number | null } }): boolean
{
	return Number.isSafeInteger(aggregate._sum.maxModelTurns ?? 0) && (aggregate._sum.maxModelTurns ?? 0) >= 0
		&& Number.isSafeInteger(aggregate._sum.maxTotalTokens ?? 0) && (aggregate._sum.maxTotalTokens ?? 0) >= 0
		&& (aggregate._sum.maxCostUsdMicros === null || aggregate._sum.maxCostUsdMicros >= 0n)
		&& Number.isSafeInteger(aggregate._sum.maxDurationMs ?? 0) && (aggregate._sum.maxDurationMs ?? 0) >= 0;
}

/** Loads the locked parent depth from its reservation, treating every incomplete child lineage as unavailable. */
async function _parentDepth(transaction: Prisma.TransactionClient, parentRun: { id: string; parentRunId: string | null }): Promise<number | null>
{
	if (parentRun.parentRunId === null) return 0;
	const reservation = await transaction.childRunReservation.findUnique({ where: { childRunId: parentRun.id }, select: { depth: true } });
	return reservation !== null && Number.isSafeInteger(reservation.depth) && reservation.depth > 0 ? reservation.depth : null;
}

/** Returns whether the locked parent and its snapshot exactly bind the detached authorization coordinates. */
function _matchesParent(parentRun: { id: string; siloId: string; rootRunId: string; inputSnapshotDigest: string }, parentSnapshot: { runId: string; siloId: string; digest: string }, command: ChildRunReservationCommand): boolean
{
	return parentRun.id === command.parentRunId && parentRun.siloId === command.request.siloId
		&& parentRun.inputSnapshotDigest === command.parentSnapshotDigest
		&& parentSnapshot.runId === parentRun.id && parentSnapshot.siloId === parentRun.siloId && parentSnapshot.digest === command.parentSnapshotDigest;
}

/** Returns an existing first child only when all durable reservation coordinates match this request exactly. */
async function _idempotentResult(transaction: Prisma.TransactionClient, existing: { id: string; siloId: string; agentServiceId: string; parentRunId: string | null; rootRunId: string; trigger: string; inputSnapshotDigest: string }, command: ChildRunReservationCommand): Promise<ChildRunReservationResult>
{
	if (existing.id !== command.childRunId || existing.siloId !== command.request.siloId || existing.agentServiceId !== command.request.agentServiceId
		|| existing.parentRunId !== command.parentRunId || existing.trigger !== "ManagedInvocation") return { outcome: "denied", reason: "authority_conflict" };
	const reservation = await transaction.childRunReservation.findUnique({ where: { childRunId: existing.id } });
	if (!_matchesReservation(reservation, command)) return { outcome: "denied", reason: "authority_conflict" };
	const snapshot = await transaction.runInputSnapshot.findUnique({ where: { runId_digest: { runId: existing.id, digest: existing.inputSnapshotDigest } } });
	if (snapshot === null || !_matchesExistingSnapshot(snapshot, command)) return { outcome: "denied", reason: "authority_conflict" };
	return { outcome: "idempotent", snapshot: _snapshot(snapshot) };
}

/** Returns whether the immutable reservation retained exactly the parent-authorised finite allocation. */
function _matchesReservation(reservation: { childRunId: string; parentRunId: string; rootRunId: string; depth: number; maxModelTurns: number; maxTotalTokens: number; maxCostUsdMicros: bigint; maxDurationMs: number; task: Prisma.JsonValue; taskDigest: string } | null, command: ChildRunReservationCommand): boolean
{
	return reservation !== null && reservation.childRunId === command.childRunId && reservation.parentRunId === command.parentRunId
		&& reservation.maxModelTurns === command.request.budget.maxModelTurns
		&& reservation.maxTotalTokens === command.request.budget.maxTotalTokens && reservation.maxCostUsdMicros === BigInt(command.request.budget.maxCostUsdMicros) && reservation.maxDurationMs === command.request.budget.maxDurationMs
		&& reservation.taskDigest === __DigestCanonicalJson(command.request.task) && _sameJson(reservation.task, command.request.task);
}

/** Returns whether a rebuilt child has the exact reservation-bound coordinates and context subset. */
function _matchesBuild(value: ChildRunReservationBuild, parent: RunInputSnapshot, parentRun: { id: string; siloId: string; rootRunId: string }, command: ChildRunReservationCommand, parentDepth: number, remainingBudget: GovernedChildRunBudget): boolean
{
	const snapshot = value.snapshot;
	const authorization = value.authorization;
	const context = authorization.context;
	return _matchesAuthorization(authorization, parentRun, command, parentDepth, remainingBudget)
		&& snapshot.runId === command.childRunId && snapshot.siloId === authorization.siloId && snapshot.agentServiceId === authorization.agentServiceId
		&& snapshot.agentRevisionId === value.agentRevisionId && snapshot.effectiveContractDigest === value.effectiveContractDigest
		&& snapshot.capabilitySetDigest === authorization.capabilitySetDigest && _sameJson(snapshot.capabilitySet, authorization.capabilitySet.capabilities) && _sameStrings(snapshot.messageIds, context.messageIds)
		&& _sameStrings(snapshot.memoryFacts.map(function _factId(fact): string { return fact.factId; }), context.memoryFactIds)
		&& _sameStrings(snapshot.artifactRevisionIds, context.artifactRevisionIds) && _sameStrings(snapshot.skillRevisionIds, context.skillRevisionIds)
		&& snapshot.threadId === parent.threadId
		&& snapshot.personaRevisionId === parent.personaRevisionId && _sameStrings(snapshot.preferenceFactIds, parent.preferenceFactIds)
		&& _sameJson(snapshot.memoryQueryPolicy, parent.memoryQueryPolicy) && _sameJson(snapshot.integrationAssignments, parent.integrationAssignments)
		&& _sameJson(snapshot.modelRoute, parent.modelRoute) && _sameJson(snapshot.identitySnapshot, parent.identitySnapshot)
		&& _matchesChildBudget(snapshot, authorization.budget);
}

/** Returns whether the lock-held callback preserved the raw request while adding only verified parent coordinates. */
function _matchesAuthorization(authorization: GovernedChildRunSpawnAuthorization, parentRun: { id: string; siloId: string; rootRunId: string }, command: ChildRunReservationCommand, parentDepth: number, remainingBudget: GovernedChildRunBudget): boolean
{
	const request = command.request;
	return authorization.siloId === parentRun.siloId && authorization.rootRunId === parentRun.rootRunId && authorization.parentRunId === parentRun.id && authorization.depth === parentDepth + 1
		&& authorization.agentServiceId === request.agentServiceId && authorization.capabilitySetDigest === request.capabilitySetDigest
		&& _sameStrings(authorization.context.messageIds, request.context.messageIds) && _sameStrings(authorization.context.memoryFactIds, request.context.memoryFactIds)
		&& _sameStrings(authorization.context.artifactRevisionIds, request.context.artifactRevisionIds) && _sameStrings(authorization.context.skillRevisionIds, request.context.skillRevisionIds)
		&& _sameJson(authorization.task, request.task) && _sameBudget(authorization.budget, request.budget) && _fitsRemainingBudget(authorization.budget, remainingBudget);
}

/** Returns whether two finite allocations have exactly the same authority coordinates. */
function _sameBudget(left: GovernedChildRunBudget, right: GovernedChildRunBudget): boolean
{
	return left.maxModelTurns === right.maxModelTurns && left.maxTotalTokens === right.maxTotalTokens && left.maxCostUsdMicros === right.maxCostUsdMicros && left.maxDurationMs === right.maxDurationMs;
}

/** Returns whether the verified allocation remains inside the capacity calculated under the parent lock. */
function _fitsRemainingBudget(allocation: GovernedChildRunBudget, remaining: GovernedChildRunBudget): boolean
{
	return allocation.maxModelTurns <= remaining.maxModelTurns && allocation.maxTotalTokens <= remaining.maxTotalTokens
		&& allocation.maxCostUsdMicros <= remaining.maxCostUsdMicros && allocation.maxDurationMs <= remaining.maxDurationMs;
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
	return snapshot.runId === command.childRunId && snapshot.siloId === command.request.siloId
		&& snapshot.agentServiceId === command.request.agentServiceId && snapshot.capabilitySetDigest === command.request.capabilitySetDigest;
}

/** Persists one child run, its frozen snapshot, immutable reservation, and initial dispatch events. */
async function _persistReservation(transaction: Prisma.TransactionClient, command: ChildRunReservationCommand, value: ChildRunReservationBuild): Promise<void>
{
	const authorization = value.authorization;
	await transaction.agentRun.create({ data: {
		id: command.childRunId, siloId: authorization.siloId, agentServiceId: authorization.agentServiceId, agentRevisionId: value.agentRevisionId,
		threadId: value.snapshot.threadId, trigger: "ManagedInvocation", delegatedUserId: null, requestIdempotencyKey: command.requestIdempotencyKey,
		rootRunId: authorization.rootRunId, parentRunId: authorization.parentRunId, effectiveContractDigest: value.effectiveContractDigest, inputSnapshotDigest: value.snapshot.digest,
	} });
	await transaction.runInputSnapshot.create({ data: _snapshotData(value.snapshot) });
	await transaction.childRunReservation.create({ data: {
		childRunId: command.childRunId, parentRunId: authorization.parentRunId, rootRunId: authorization.rootRunId, depth: authorization.depth,
		maxModelTurns: authorization.budget.maxModelTurns, maxTotalTokens: authorization.budget.maxTotalTokens, maxCostUsdMicros: BigInt(authorization.budget.maxCostUsdMicros), maxDurationMs: authorization.budget.maxDurationMs,
		task: _json(authorization.task), taskDigest: __DigestCanonicalJson(authorization.task),
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
		budgetPolicy: _json(snapshot.budgetPolicy), capabilitySetDigest: snapshot.capabilitySetDigest, capabilitySet: _json(snapshot.capabilitySet), promptCompilerVersion: snapshot.promptCompilerVersion, digest: snapshot.digest, compiledAt: new Date(snapshot.compiledAt),
	};
}

/** Deep-copies JSON through canonical form before Prisma owns the durable payload. */
function _json(value: unknown): Prisma.InputJsonValue
{
	return ___CloneCanonicalJson(value as JsonValue) as Prisma.InputJsonValue;
}

/** Maps one persisted snapshot row back into the immutable cross-domain contract. */
function _snapshot(row: { runId: string; siloId: string; agentServiceId: string; agentRevisionId: string; snapshotVersion: number; threadId: string | null; messageIds: string[]; personaRevisionId: string | null; preferenceFactIds: string[]; artifactRevisionIds: string[]; skillRevisionIds: string[]; memoryFacts: Prisma.JsonValue; memoryQueryPolicy: Prisma.JsonValue; integrationAssignments: Prisma.JsonValue; modelRoute: Prisma.JsonValue; budgetPolicy: Prisma.JsonValue; identitySnapshot: Prisma.JsonValue; capabilitySetDigest: string; capabilitySet: Prisma.JsonValue; effectiveContractDigest: string; promptCompilerVersion: string; digest: string; compiledAt: Date }): RunInputSnapshot
{
	return {
		runId: row.runId, siloId: row.siloId, agentServiceId: row.agentServiceId, agentRevisionId: row.agentRevisionId, snapshotVersion: row.snapshotVersion, threadId: row.threadId,
		messageIds: row.messageIds, personaRevisionId: row.personaRevisionId, preferenceFactIds: row.preferenceFactIds, artifactRevisionIds: row.artifactRevisionIds, skillRevisionIds: row.skillRevisionIds,
		memoryFacts: row.memoryFacts as unknown as RunInputSnapshot["memoryFacts"], memoryQueryPolicy: row.memoryQueryPolicy as RunInputSnapshot["memoryQueryPolicy"], integrationAssignments: row.integrationAssignments as unknown as RunInputSnapshot["integrationAssignments"],
		modelRoute: row.modelRoute as RunInputSnapshot["modelRoute"], budgetPolicy: row.budgetPolicy as RunInputSnapshot["budgetPolicy"], identitySnapshot: row.identitySnapshot as unknown as RunInputSnapshot["identitySnapshot"],
		capabilitySetDigest: row.capabilitySetDigest, capabilitySet: row.capabilitySet as unknown as RunInputSnapshot["capabilitySet"], effectiveContractDigest: row.effectiveContractDigest, promptCompilerVersion: row.promptCompilerVersion, digest: row.digest, compiledAt: row.compiledAt.toISOString(),
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
