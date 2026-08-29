import { AgentRunState, AgentRunTrigger, Prisma, type AgentRun as PrismaAgentRun, type ChildRunReservation as PrismaChildRunReservation, type PrismaClient, type RunInputSnapshot as PrismaRunInputSnapshot } from "@prisma/client";

import type { RunInputSnapshot } from "@opencrane/contracts";
import { ___CreateLogger, type Logger } from "@opencrane/backend/observability";

import { __PrepareChildRunAdmission } from "./child-run-admission";
import type { ChildRunParentAuthority, PrepareChildRunAdmissionCommand, PreparedChildRunAdmission } from "./child-run-admission.types";
import { _RunInputSnapshot, _RunInputSnapshotData } from "./prisma-run-admission-repository";
import { __DigestRunInputSnapshot } from "./run-input-snapshot-digest";
import type { ChildRunReservationBuild, ChildRunReservationCommand, ChildRunReservationRepository, ChildRunReservationResult } from "./child-run-reservation.types";

/**
 * Atomically persists one child admission while its direct parent is rechecked.
 */
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

	/** Rechecks and commits a child run, snapshot, and immutable reservation together. */
	async reserve(command: ChildRunReservationCommand, build: ChildRunReservationBuild): Promise<ChildRunReservationResult>
	{
		if (!_isValidCommand(command)) return { outcome: "denied", reason: "invalid_command" };
		try
		{
			return await this.prisma.$transaction(async function _reserve(transaction): Promise<ChildRunReservationResult>
			{
					// 1. Check the unique inherited-silo request key before creating a child.
				const existing = await transaction.agentRun.findUnique({ where: { siloId_requestIdempotencyKey: { siloId: command.prepared.siloId, requestIdempotencyKey: command.requestIdempotencyKey } } });
				if (existing !== null)
				{
					const reservation = await transaction.childRunReservation.findUnique({ where: { childRunId: existing.id } });
					const existingSnapshot = await transaction.runInputSnapshot.findUnique({ where: { runId_digest: { runId: existing.id, digest: existing.inputSnapshotDigest } } });
					if (reservation === null || existingSnapshot === null || !_matchesExistingChild(existing, reservation, command)) return { outcome: "denied", reason: "authority_conflict" };
					return { outcome: "idempotent", snapshot: _RunInputSnapshot(existingSnapshot) };
				}

					// 2. Recheck the parent before calculating capacity. Serializable isolation prevents concurrent siblings from over-reserving it.
				const parent = await transaction.agentRun.findUnique({ where: { id: command.prepared.parentRunId } });
				if (parent === null || !_isAdmittableParent(parent, command)) return { outcome: "denied", reason: "parent_not_admittable" };
				const snapshot = await transaction.runInputSnapshot.findUnique({ where: { runId_digest: { runId: parent.id, digest: parent.inputSnapshotDigest } } });
				if (snapshot === null || !_isParentSnapshot(snapshot, command)) return { outcome: "denied", reason: "parent_snapshot_stale" };
				const parentReservation = parent.parentRunId === null ? null : await transaction.childRunReservation.findUnique({ where: { childRunId: parent.id } });
				if (parent.parentRunId !== null && parentReservation === null) return { outcome: "denied", reason: "parent_not_admittable" };

				// 3. Sum durable direct-child allocations and run target authorization again inside the parent fence.
				const aggregate = await transaction.childRunReservation.aggregate({ where: { parentRunId: parent.id }, _count: { childRunId: true }, _sum: { maxTokens: true, maxCostUsdMicros: true } });
				const parentAuthority = _parentAuthority(parent, snapshot, aggregate._count.childRunId, aggregate._sum.maxTokens, aggregate._sum.maxCostUsdMicros, parentReservation?.depth ?? 0);
				if (parentAuthority === null) return { outcome: "denied", reason: "parent_snapshot_stale" };
				const prepared = await __PrepareChildRunAdmission(parentAuthority, _prepareCommand(command), command.limits, command.targetAuthorization);
				if (prepared.outcome === "denied") return prepared;

				// 4. Build and persist only the exact child snapshot and allocation in this transaction.
				const value = await build.build(prepared.value);
				if (!_isChildSnapshot(value.snapshot, prepared.value, value.effectiveContractDigest)) return { outcome: "denied", reason: "authority_conflict" };
				await _persist(transaction, command, value.snapshot, prepared.value);
				return { outcome: "reserved", snapshot: value.snapshot };
				}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
		}
		catch (error)
		{
			this.log.error({ err: error, childRunId: command.prepared.runId, parentRunId: command.prepared.parentRunId, siloId: command.prepared.siloId, failureKind: "transaction_failed" }, "child run reservation persistence failed");
			return { outcome: "denied", reason: "persistence_unavailable" };
		}
	}
}

/** Returns whether an existing child and its immutable allocation exactly match the replayed request. */
function _matchesExistingChild(existing: PrismaAgentRun, reservation: PrismaChildRunReservation, command: ChildRunReservationCommand): boolean
{
	return existing.id === command.prepared.runId
		&& existing.siloId === command.prepared.siloId
		&& existing.agentServiceId === command.prepared.agentServiceId
		&& existing.agentRevisionId === command.prepared.agentRevisionId
		&& existing.parentRunId === command.prepared.parentRunId
		&& existing.rootRunId === command.prepared.rootRunId
		&& existing.trigger === AgentRunTrigger.ManagedInvocation
		&& reservation.depth === command.prepared.depth
		&& reservation.maxTokens === command.prepared.budget.maxTokens
		&& reservation.maxCostUsdMicros === BigInt(command.prepared.budget.maxCostUsdMicros);
}

/** Returns whether a request has the fixed non-empty authority coordinates needed for a reservation. */
function _isValidCommand(command: ChildRunReservationCommand): boolean
{
	return command.requestIdempotencyKey.trim().length > 0 && /^sha256:[0-9a-f]{64}$/u.test(command.parentSnapshotDigest);
}

/** Returns a parent authority derived solely from transaction-consistent rows and its frozen input snapshot. */
function _parentAuthority(
	parent: PrismaAgentRun,
	snapshot: PrismaRunInputSnapshot,
	admittedChildCount: number,
	usedTokensValue: number | null,
	usedCostValue: bigint | null,
	depth: number,
): ChildRunParentAuthority | null
{
	const identity = snapshot.identitySnapshot as Record<string, unknown>;
	const policy = snapshot.budgetPolicy as Record<string, unknown>;
	const subject = identity["executionSubjectId"];
	const tokens = policy["maxTokens"];
	const cost = policy["maxCostUsdMicros"];
	if (typeof subject !== "string"
		|| subject.trim().length === 0
		|| !_positiveInteger(tokens)
		|| !_positiveInteger(cost)
		|| usedCostValue !== null && usedCostValue > BigInt(Number.MAX_SAFE_INTEGER)) return null;
	const usedTokens = usedTokensValue ?? 0;
	const usedCost = Number(usedCostValue ?? 0n);
	if (usedTokens < 0 || usedCost < 0) return null;
	const authority: ChildRunParentAuthority = {
		runId: parent.id,
		siloId: parent.siloId,
		rootRunId: parent.rootRunId,
		depth,
		executionSubjectId: subject,
		remainingTokens: tokens - usedTokens,
		remainingCostUsdMicros: cost - usedCost,
		admittedChildCount,
	};
	return authority;
}

/** Returns whether the parent retains the exact running lineage and snapshot requested by the child. */
function _isAdmittableParent(parent: PrismaAgentRun, command: ChildRunReservationCommand): boolean
{
	return parent.state === AgentRunState.Running
		&& parent.siloId === command.prepared.siloId
		&& parent.rootRunId === command.prepared.rootRunId
		&& parent.inputSnapshotDigest === command.parentSnapshotDigest;
}

/** Returns whether the parent snapshot exactly binds the requested parent identity. */
function _isParentSnapshot(snapshot: PrismaRunInputSnapshot, command: ChildRunReservationCommand): boolean
{
	return snapshot.runId === command.prepared.parentRunId && snapshot.siloId === command.prepared.siloId && snapshot.digest === command.parentSnapshotDigest;
}

/** Maps the original child request into the pure admission command rechecked under the parent lock. */
function _prepareCommand(command: ChildRunReservationCommand): PrepareChildRunAdmissionCommand
{
	const prepared: PrepareChildRunAdmissionCommand = {
		childRunId: command.prepared.runId,
		targetAgentServiceId: command.prepared.agentServiceId,
		targetAgentRevisionId: command.prepared.agentRevisionId,
		requestedBudget: command.prepared.budget,
	};
	return prepared;
}

/** Returns whether the assembled child snapshot retained only prepared run identity and allocation. */
function _isChildSnapshot(snapshot: RunInputSnapshot, prepared: PreparedChildRunAdmission, effectiveContractDigest: string): boolean
{
	const { digest: _digest, ...withoutDigest } = snapshot;
	if (snapshot.runId !== prepared.runId
		|| snapshot.siloId !== prepared.siloId
		|| snapshot.agentServiceId !== prepared.agentServiceId
		|| snapshot.agentRevisionId !== prepared.agentRevisionId
		|| snapshot.effectiveContractDigest !== effectiveContractDigest
		|| snapshot.identitySnapshot.executionSubjectId !== prepared.executionSubjectId
		|| snapshot.digest !== __DigestRunInputSnapshot(withoutDigest)) return false;
	const budget = snapshot.budgetPolicy as Record<string, unknown>;
	return budget["maxTokens"] === prepared.budget.maxTokens && budget["maxCostUsdMicros"] === prepared.budget.maxCostUsdMicros;
}

/** Persists the three inseparable records that reserve a child run. */
async function _persist(transaction: Prisma.TransactionClient, command: ChildRunReservationCommand, snapshot: RunInputSnapshot, prepared: PreparedChildRunAdmission): Promise<void>
{
	const acceptedAt = new Date(snapshot.compiledAt);
	const run = _childRunData(command, snapshot, prepared, acceptedAt);
	const reservation = _reservationData(prepared);
	await transaction.agentRun.create({ data: run });
	await transaction.runInputSnapshot.create({ data: _RunInputSnapshotData(snapshot) });
	await transaction.childRunReservation.create({ data: reservation });
}

/** Initializes the exact child run row committed by the reservation transaction. */
function _childRunData(command: ChildRunReservationCommand, snapshot: RunInputSnapshot, prepared: PreparedChildRunAdmission, acceptedAt: Date): Prisma.AgentRunUncheckedCreateInput
{
	const data: Prisma.AgentRunUncheckedCreateInput = {
		id: prepared.runId,
		siloId: prepared.siloId,
		agentServiceId: prepared.agentServiceId,
		agentRevisionId: prepared.agentRevisionId,
		conversationId: snapshot.conversationId,
		trigger: AgentRunTrigger.ManagedInvocation,
		delegatedUserId: null,
		requestIdempotencyKey: command.requestIdempotencyKey,
		rootRunId: prepared.rootRunId,
		parentRunId: prepared.parentRunId,
		effectiveContractDigest: snapshot.effectiveContractDigest,
		inputSnapshotDigest: snapshot.digest,
		acceptedAt,
	};
	return data;
}

/** Initializes the immutable lineage and budget allocation owned by the child run. */
function _reservationData(prepared: PreparedChildRunAdmission): Prisma.ChildRunReservationUncheckedCreateInput
{
	const data: Prisma.ChildRunReservationUncheckedCreateInput = {
		childRunId: prepared.runId,
		parentRunId: prepared.parentRunId,
		rootRunId: prepared.rootRunId,
		depth: prepared.depth,
		maxTokens: prepared.budget.maxTokens,
		maxCostUsdMicros: BigInt(prepared.budget.maxCostUsdMicros),
	};
	return data;
}

/** Returns whether a JSON value is a positive safe-integer budget coordinate. */
function _positiveInteger(value: unknown): value is number
{
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
