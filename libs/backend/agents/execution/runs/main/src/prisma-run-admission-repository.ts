import { Prisma, RunOutboxEventKind, type PrismaClient } from "@prisma/client";

import type { RunInputSnapshot } from "@opencrane/contracts";
import { ___CreateLogger, type Logger } from "@opencrane/observability";
import { ___CloneCanonicalJson } from "@opencrane/util";
import type { JsonValue } from "@opencrane/util";

import type { InitialRunAuthority, RunAdmissionBuild, RunAdmissionBuildResult, RunAdmissionClock, RunAdmissionCommand, RunAdmissionRepository, RunAdmissionResult, RunAdmissionTransaction } from "./run-admission.types.js";

/**
 * Prisma-backed authority for the first durable instant of a logical run.
 * It serialises the user-visible idempotency key before compilation and commits the run, its sole
 * immutable snapshot, and both initial outbox events together; failure leaves none of them visible.
 */
export class PrismaRunAdmissionRepository implements RunAdmissionRepository
{
	/** Canonical OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient;
	/** Server-owned clock that freezes an admission instant only after a non-duplicate request reaches this boundary. */
	private readonly clock: RunAdmissionClock;
	/** Structured persistence-failure signal with process-wide secret redaction. */
	private readonly log: Logger;

	/**
	 * Creates an initial-admission repository over canonical Postgres.
	 * @param prisma - Canonical product-authority database client.
	 * @param clock - Server-owned admission clock, replaceable only for deterministic tests.
	 * @param log - Structured redacting logger for otherwise fail-closed persistence failures.
	 */
	constructor(prisma: PrismaClient, clock: RunAdmissionClock = { now: function _now(): Date { return new Date(); } }, log: Logger = ___CreateLogger("personal-run-admission"))
	{
		this.prisma = prisma;
		this.clock = clock;
		this.log = log;
	}

	/**
	 * Returns the first frozen snapshot for duplicate delivery, otherwise compiles under the service
	 * lock and exposes an accepted result only after every run/snapshot/outbox write can commit.
	 */
	async admit<TDenial>(command: RunAdmissionCommand, build: (transaction: RunAdmissionTransaction) => Promise<RunAdmissionBuildResult<TDenial>>): Promise<RunAdmissionResult<TDenial>>
	{
		const clock = this.clock;
		try
		{
			return await this.prisma.$transaction(async function _admit(transaction: Prisma.TransactionClient): Promise<RunAdmissionResult<TDenial>>
			{
				// 1. Serialize the user-visible key before loading inputs so a duplicate never recompiles at a later instant.
				await transaction.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${command.siloId}\u0000${command.requestIdempotencyKey}`}, 0))`);
				const existing = await transaction.agentRun.findUnique({ where: { siloId_requestIdempotencyKey: { siloId: command.siloId, requestIdempotencyKey: command.requestIdempotencyKey } } });
				if (existing !== null)
				{
					if (!_matchesIdempotencyScope(existing, command)) return { outcome: "denied", reason: "authority_conflict" };
					const existingSnapshot = await transaction.runInputSnapshot.findUnique({ where: { runId_digest: { runId: existing.id, digest: existing.inputSnapshotDigest } } });
					if (existingSnapshot !== null)
					{
						if (!_matchesSnapshotScope(existingSnapshot, command)) return { outcome: "denied", reason: "authority_conflict" };
						return { outcome: "idempotent", snapshot: _snapshot(existingSnapshot) };
					}
				}

				// 2. Lock the service before every source revalidates its inputs, preserving the established run lock order.
				await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_services" WHERE "id" = ${command.agentServiceId} AND "silo_id" = ${command.siloId} FOR UPDATE`);
				const admittedAtDate = clock.now();
				const admittedAt = admittedAtDate.toISOString();
				const compiled = await build({ prisma: transaction, admittedAt, admittedAtEpochMs: admittedAtDate.getTime() });
				if (compiled.outcome === "denied") return compiled;
				if (!_matchesCommand(compiled.value, command) || !_matchesInteractiveDelegation(compiled.value.authority, command)) return { outcome: "denied", reason: "authority_conflict" };

				// 3. Insert both sides of the deferred snapshot relation plus ordered acceptance and dispatch events in one commit.
				await _persistInitialAdmission(transaction, command, compiled.value, admittedAtDate);
				return { outcome: "accepted", snapshot: compiled.value.snapshot };
			});
		}
		catch (error)
		{
			if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
			{
				try
				{
					const existing = await this.prisma.agentRun.findUnique({ where: { siloId_requestIdempotencyKey: { siloId: command.siloId, requestIdempotencyKey: command.requestIdempotencyKey } } });
					if (existing !== null)
					{
						if (!_matchesIdempotencyScope(existing, command)) return { outcome: "denied", reason: "authority_conflict" };
						const existingSnapshot = await this.prisma.runInputSnapshot.findUnique({ where: { runId_digest: { runId: existing.id, digest: existing.inputSnapshotDigest } } });
						if (existingSnapshot !== null)
						{
							if (!_matchesSnapshotScope(existingSnapshot, command)) return { outcome: "denied", reason: "authority_conflict" };
							return { outcome: "idempotent", snapshot: _snapshot(existingSnapshot) };
						}
					}
				}
				catch (recoveryError)
				{
					this.log.error({ err: recoveryError, runId: command.runId, siloId: command.siloId, agentServiceId: command.agentServiceId, failureKind: "duplicate_recovery_failed" }, "personal run admission persistence failed");
					return { outcome: "denied", reason: "persistence_unavailable" };
				}
			}
			this.log.error({ err: error, runId: command.runId, siloId: command.siloId, agentServiceId: command.agentServiceId, failureKind: "transaction_failed" }, "personal run admission persistence failed");
			return { outcome: "denied", reason: "persistence_unavailable" };
		}
	}
}

/** Returns whether an existing same-key row has the durable coordinates needed before loading its snapshot. */
function _matchesIdempotencyScope(existing: { siloId: string; agentServiceId: string; threadId: string | null; trigger: string; delegatedUserId: string | null }, command: RunAdmissionCommand): boolean
{
	return existing.siloId === command.siloId
		&& existing.agentServiceId === command.agentServiceId
		&& existing.threadId === command.threadId
		&& (existing.trigger !== "Interactive" || existing.delegatedUserId === command.executionSubjectId);
}

/** Returns whether a recovered immutable snapshot belongs to the exact execution subject requesting it. */
function _matchesSnapshotScope(snapshot: { siloId: string; agentServiceId: string; threadId: string | null; identitySnapshot: Prisma.JsonValue }, command: RunAdmissionCommand): boolean
{
	if (snapshot.siloId !== command.siloId || snapshot.agentServiceId !== command.agentServiceId || snapshot.threadId !== command.threadId) return false;
	if (!snapshot.identitySnapshot || typeof snapshot.identitySnapshot !== "object" || Array.isArray(snapshot.identitySnapshot)) return false;
	return snapshot.identitySnapshot["executionSubjectId"] === command.executionSubjectId;
}

/** Returns whether interactive run custody and its signed snapshot are bound to the same subject. */
function _matchesInteractiveDelegation(authority: InitialRunAuthority, command: RunAdmissionCommand): boolean
{
	return authority.trigger !== "interactive" || authority.delegatedUserId === command.executionSubjectId;
}

/** Returns whether the transaction-fenced authority exactly matches immutable caller coordinates. */
function _matchesCommand(value: RunAdmissionBuild, command: RunAdmissionCommand): boolean
{
	return value.authority.agentServiceId === command.agentServiceId
		&& value.snapshot.runId === command.runId
		&& value.snapshot.siloId === command.siloId
		&& value.snapshot.agentServiceId === command.agentServiceId
		&& value.snapshot.threadId === command.threadId
		&& value.snapshot.identitySnapshot.executionSubjectId === command.executionSubjectId;
}

/** Inserts the run, its only snapshot, and the ordered initial run-domain events. */
async function _persistInitialAdmission(transaction: Prisma.TransactionClient, command: RunAdmissionCommand, value: RunAdmissionBuild, admittedAt: Date): Promise<void>
{
	await transaction.agentRun.create({ data: {
		id: command.runId,
		siloId: command.siloId,
		agentServiceId: value.authority.agentServiceId,
		agentRevisionId: value.authority.agentRevisionId,
		threadId: command.threadId,
		trigger: _trigger(value.authority.trigger),
		delegatedUserId: value.authority.delegatedUserId,
		requestIdempotencyKey: command.requestIdempotencyKey,
		rootRunId: value.authority.rootRunId,
		parentRunId: value.authority.parentRunId,
		effectiveContractDigest: value.authority.effectiveContractDigest,
		inputSnapshotDigest: value.snapshot.digest,
		acceptedAt: admittedAt,
	} });
	await transaction.runInputSnapshot.create({ data: _snapshotData(value.snapshot) });
	await transaction.outboxEvent.createMany({ data: [
		{ runId: command.runId, attempt: 1, sequence: 1, kind: RunOutboxEventKind.RunAccepted, idempotencyKey: `${command.runId}:accepted`, payload: { runId: command.runId, inputSnapshotDigest: value.snapshot.digest }, availableAt: admittedAt },
		{ runId: command.runId, attempt: 1, sequence: 2, kind: RunOutboxEventKind.RunAttemptRequested, idempotencyKey: `${command.runId}:attempt:1`, payload: { runId: command.runId, attempt: 1, inputSnapshotDigest: value.snapshot.digest }, availableAt: admittedAt },
	] });
}

/** Maps a dependency-light trigger to the owned database enum representation. */
function _trigger(value: InitialRunAuthority["trigger"]): "Interactive" | "Schedule" | "ManagedInvocation"
{
	if (value === "interactive") return "Interactive";
	if (value === "schedule") return "Schedule";
	return "ManagedInvocation";
}

/** Deep-copies JSON through canonical form before Prisma owns the durable payload. */
function _json(value: unknown): Prisma.InputJsonValue
{
	return ___CloneCanonicalJson(value as JsonValue) as Prisma.InputJsonValue;
}

/** Maps an immutable contract snapshot into its canonical Postgres row. */
function _snapshotData(snapshot: RunInputSnapshot): Prisma.RunInputSnapshotUncheckedCreateInput
{
	return {
		runId: snapshot.runId,
		snapshotVersion: snapshot.snapshotVersion,
		siloId: snapshot.siloId,
		agentServiceId: snapshot.agentServiceId,
		agentRevisionId: snapshot.agentRevisionId,
		effectiveContractDigest: snapshot.effectiveContractDigest,
		personaRevisionId: snapshot.personaRevisionId,
		threadId: snapshot.threadId,
		messageIds: [...snapshot.messageIds],
		preferenceFactIds: [...snapshot.preferenceFactIds],
		artifactRevisionIds: [...snapshot.artifactRevisionIds],
		memoryFacts: _json(snapshot.memoryFacts),
		identitySnapshot: _json(snapshot.identitySnapshot),
		modelRoute: _json(snapshot.modelRoute),
		toolGrantIds: [...snapshot.toolGrantIds],
		skillRevisionIds: [...snapshot.skillRevisionIds],
		memoryQueryPolicy: _json(snapshot.memoryQueryPolicy),
		budgetPolicy: _json(snapshot.budgetPolicy),
		capabilitySetDigest: snapshot.capabilitySetDigest,
		promptCompilerVersion: snapshot.promptCompilerVersion,
		digest: snapshot.digest,
		compiledAt: new Date(snapshot.compiledAt),
	};
}

/** Maps one persisted snapshot row back into the immutable cross-domain contract. */
function _snapshot(row: { runId: string; siloId: string; agentServiceId: string; agentRevisionId: string; snapshotVersion: number; threadId: string | null; messageIds: string[]; personaRevisionId: string | null; preferenceFactIds: string[]; artifactRevisionIds: string[]; skillRevisionIds: string[]; memoryFacts: Prisma.JsonValue; memoryQueryPolicy: Prisma.JsonValue; toolGrantIds: string[]; modelRoute: Prisma.JsonValue; budgetPolicy: Prisma.JsonValue; identitySnapshot: Prisma.JsonValue; capabilitySetDigest: string; effectiveContractDigest: string; promptCompilerVersion: string; digest: string; compiledAt: Date }): RunInputSnapshot
{
	return {
		runId: row.runId,
		siloId: row.siloId,
		agentServiceId: row.agentServiceId,
		agentRevisionId: row.agentRevisionId,
		snapshotVersion: row.snapshotVersion,
		threadId: row.threadId,
		messageIds: row.messageIds,
		personaRevisionId: row.personaRevisionId,
		preferenceFactIds: row.preferenceFactIds,
		artifactRevisionIds: row.artifactRevisionIds,
		skillRevisionIds: row.skillRevisionIds,
		memoryFacts: row.memoryFacts as unknown as RunInputSnapshot["memoryFacts"],
		memoryQueryPolicy: row.memoryQueryPolicy as RunInputSnapshot["memoryQueryPolicy"],
		toolGrantIds: row.toolGrantIds,
		modelRoute: row.modelRoute as RunInputSnapshot["modelRoute"],
		budgetPolicy: row.budgetPolicy as RunInputSnapshot["budgetPolicy"],
		identitySnapshot: row.identitySnapshot as unknown as RunInputSnapshot["identitySnapshot"],
		capabilitySetDigest: row.capabilitySetDigest,
		effectiveContractDigest: row.effectiveContractDigest,
		promptCompilerVersion: row.promptCompilerVersion,
		digest: row.digest,
		compiledAt: row.compiledAt.toISOString(),
	};
}
