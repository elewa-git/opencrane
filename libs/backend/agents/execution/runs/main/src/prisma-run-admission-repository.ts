import { Prisma, RunOutboxEventKind, type PrismaClient, type RunInputSnapshot as PrismaRunInputSnapshot } from "@prisma/client";

import type { RunInputSnapshot } from "@opencrane/contracts";
import { ___CreateLogger, type Logger } from "@opencrane/backend/observability";
import { ___CloneCanonicalJson } from "@opencrane/util";
import type { JsonValue } from "@opencrane/util";

import { RunAdmissionDenialReasons } from "./run-admission.types.js";
import type { InitialRunAuthority, RunAdmissionBuild, RunAdmissionBuildResult, RunAdmissionClock, RunAdmissionCommand, RunAdmissionCommit, RunAdmissionPrepare, RunAdmissionRepository, RunAdmissionResult, RunAdmissionTransaction } from "./run-admission.types.js";

/**
 * Turns an expected refusal into a throw, so Prisma rolls the transaction back.
 *
 * Prisma's interactive `$transaction` commits whenever its callback returns a value and rolls back
 * only when the callback throws. That is fine while nothing has been written: a `denied` return
 * commits an empty transaction. It is not fine once `prepare` has run, because the caller has already
 * inserted the rows its inputs needed — for a group `@agent` mention, the parent message, the child
 * conversation and its participants. Returning `denied` there would leave a child conversation with no
 * run in it. So this is thrown instead, and `admit` catches it and hands the caller back the same
 * ordinary `denied` result it would have returned. Callers never see this type.
 *
 * Covered by `prisma-run-admission-repository.test.ts` ("rolls back prepared child authority when
 * snapshot compilation denies" and "... when compiled coordinates conflict"), which assert that the
 * prepared rows do not commit.
 */
class _PreparedAdmissionDenied<TDenial> extends Error
{
	/** The refusal to give back to the caller once the rollback has happened. */
	readonly reason: TDenial;

	/**
	 * Builds the rollback signal. The `Error` message is fixed text and the reason stays on the field,
	 * so an unhandled throw cannot print a refusal detail into a log or stack trace.
	 */
	constructor(reason: TDenial)
	{
		super("prepared run admission denied");
		this.name = "PreparedAdmissionDenied";
		this.reason = reason;
	}
}

/**
 * Writes the first durable moment of a run to Postgres.
 *
 * One `$transaction` at `Serializable` covers everything: the duplicate check, the caller's optional
 * preparation writes, the snapshot compilation the caller supplies, the run row, its snapshot row and
 * its two outbox events. Either all of it commits or none of it does, so no reader can ever see a run
 * without its snapshot, or a snapshot without the dispatch command that starts it.
 *
 * Two locks make that safe under concurrent callers: an advisory lock on silo + idempotency key holds a
 * second delivery of the same request back until the first finishes, then a `FOR UPDATE` on the
 * AgentService row is taken before any input is re-read, in the lock order the rest of the run code
 * follows.
 *
 * This class owns the transaction, and that ownership is the contract. Callers hand in callbacks and
 * receive a `Prisma.TransactionClient`, never the `PrismaClient` held here; they must write only on the
 * client they are given and must not open a transaction of their own, which would commit separately and
 * break the all-or-nothing guarantee above. The single read outside the transaction is the duplicate
 * recovery in the catch block, which uses the root client because the transaction is already gone.
 *
 * Called by: `__AssembleRunInputSnapshot` (execution/inputs/main/src/session-assembly.ts), wired in by
 * `prisma-session-assembly-authorities.ts`.
 * @implements RunAdmissionRepository
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
	constructor(prisma: PrismaClient, clock: RunAdmissionClock = { now: function _now(): Date { return new Date(); } }, log: Logger = ___CreateLogger("run-admission"))
	{
		this.prisma = prisma;
		this.clock = clock;
		this.log = log;
	}

	/**
	 * Admits one run, or gives back the run an identical earlier request already got.
	 *
	 * A duplicate is answered from the existing rows and never recompiled, so a retry cannot freeze a
	 * newer set of inputs under the same key. Only a request that is not a duplicate reaches the clock,
	 * which is why the admission time is taken after the duplicate check rather than on entry.
	 *
	 * The compiled snapshot is then checked back against the command — same run, silo, service,
	 * conversation, trigger and execution subject — because `build` is the caller's code and a mismatch
	 * would otherwise store a snapshot describing a different run than the row it is attached to.
	 *
	 * @param command - Run coordinates and the `requestIdempotencyKey` that makes a repeat safe.
	 * @param build - Compiles the snapshot inside the transaction, with the service row already locked.
	 * @param commit - Optional writes to make after the run row exists.
	 * @param prepare - Optional writes to make before compilation, for a caller whose inputs do not
	 * exist yet. Skipped for a duplicate, and rolled back if the admission goes on to refuse.
	 * @returns `accepted` when this call created the run, `idempotent` when an earlier identical request
	 * did — both carry the same snapshot, and treating the second as the first starts a duplicate
	 * runtime. `denied` carries the reason `build` gave, or `AuthorityConflict` when the request clashes
	 * with an existing run, or `PersistenceUnavailable` when the outcome is unknown and the caller must
	 * retry with the same key.
	 * @see RunAdmissionDenialReasons for which refusals a retry can and cannot fix.
	 */
	async admit<TDenial>(command: RunAdmissionCommand, build: (transaction: RunAdmissionTransaction) => Promise<RunAdmissionBuildResult<TDenial>>, commit?: RunAdmissionCommit, prepare?: RunAdmissionPrepare): Promise<RunAdmissionResult<TDenial>>
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
					if (!_matchesIdempotencyScope(existing, command)) return { outcome: "denied", reason: RunAdmissionDenialReasons.AuthorityConflict };
					const existingSnapshot = await transaction.runInputSnapshot.findUnique({ where: { runId_digest: { runId: existing.id, digest: existing.inputSnapshotDigest } } });
					if (existingSnapshot !== null)
					{
						if (!_matchesSnapshotScope(existingSnapshot, command)) return { outcome: "denied", reason: RunAdmissionDenialReasons.AuthorityConflict };
						return { outcome: "idempotent", snapshot: _RunInputSnapshot(existingSnapshot) };
					}
				}

				// 2. Lock the service before every source revalidates its inputs, preserving the established run lock order.
				await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_services" WHERE "id" = ${command.agentServiceId} AND "silo_id" = ${command.siloId} FOR UPDATE`);
				const admittedAtDate = clock.now();
				const admittedAt = admittedAtDate.toISOString();
				// 3. Let the caller create the rows its own inputs need, so a child conversation exists
				// before the conversation source reads it. It runs here, past the duplicate check, so a
				// retried request cannot create a second child.
				if (prepare) await prepare({ prisma: transaction, admittedAt, admittedAtEpochMs: admittedAtDate.getTime() });
				const compiled = await build({ prisma: transaction, admittedAt, admittedAtEpochMs: admittedAtDate.getTime() });

				// 4. Refuse by throwing whenever preparation already wrote rows, because returning would
				// commit them without a run; see _PreparedAdmissionDenied.
				if (compiled.outcome === "denied")
				{
					if (prepare) throw new _PreparedAdmissionDenied(compiled.reason);
					return compiled;
				}
				if (!_matchesCommand(compiled.value, command) || !_matchesExecutionIdentity(compiled.value.authority, compiled.value.snapshot, command))
				{
					if (prepare) throw new _PreparedAdmissionDenied(RunAdmissionDenialReasons.AuthorityConflict);
					return { outcome: "denied", reason: RunAdmissionDenialReasons.AuthorityConflict };
				}

				// 5. Insert both sides of the deferred snapshot relation plus ordered acceptance and dispatch events in one commit.
				await _persistInitialAdmission(transaction, command, compiled.value, admittedAtDate);
				if (commit) await commit({ prisma: transaction, admittedAt, admittedAtEpochMs: admittedAtDate.getTime() }, compiled.value);
				return { outcome: "accepted", snapshot: compiled.value.snapshot };
			}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
		}
		catch (error)
		{
			// A refusal that had to roll prepared rows back is not a failure: hand the reason straight
			// back, and do not log it as one.
			if (error instanceof _PreparedAdmissionDenied) return { outcome: "denied", reason: error.reason as TDenial };
			if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
			{
				try
				{
					const existing = await this.prisma.agentRun.findUnique({ where: { siloId_requestIdempotencyKey: { siloId: command.siloId, requestIdempotencyKey: command.requestIdempotencyKey } } });
					if (existing !== null)
					{
						if (!_matchesIdempotencyScope(existing, command)) return { outcome: "denied", reason: RunAdmissionDenialReasons.AuthorityConflict };
						const existingSnapshot = await this.prisma.runInputSnapshot.findUnique({ where: { runId_digest: { runId: existing.id, digest: existing.inputSnapshotDigest } } });
						if (existingSnapshot !== null)
						{
							if (!_matchesSnapshotScope(existingSnapshot, command)) return { outcome: "denied", reason: RunAdmissionDenialReasons.AuthorityConflict };
							return { outcome: "idempotent", snapshot: _RunInputSnapshot(existingSnapshot) };
						}
					}
				}
				catch (recoveryError)
				{
					this.log.error({ err: recoveryError, runId: command.runId, siloId: command.siloId, agentServiceId: command.agentServiceId, failureKind: "duplicate_recovery_failed" }, "run admission persistence failed");
					return { outcome: "denied", reason: RunAdmissionDenialReasons.PersistenceUnavailable };
				}
			}
			this.log.error({ err: error, runId: command.runId, siloId: command.siloId, agentServiceId: command.agentServiceId, failureKind: "transaction_failed" }, "run admission persistence failed");
			return { outcome: "denied", reason: RunAdmissionDenialReasons.PersistenceUnavailable };
		}
	}
}

/** Returns whether an existing same-key row has the durable coordinates needed before loading its snapshot. */
function _matchesIdempotencyScope(existing: { siloId: string; agentServiceId: string; conversationId: string | null; trigger: string; delegatedUserId: string | null }, command: RunAdmissionCommand): boolean
{
	return existing.siloId === command.siloId
		&& existing.agentServiceId === command.agentServiceId
		&& existing.conversationId === command.conversationId
		&& existing.trigger === _trigger(command.trigger)
		&& (command.identityKind !== "user" || existing.delegatedUserId === command.executionSubjectId)
		&& (command.identityKind !== "service" || existing.delegatedUserId === null);
}

/** Returns whether a recovered immutable snapshot belongs to the exact execution subject requesting it. */
function _matchesSnapshotScope(snapshot: { siloId: string; agentServiceId: string; conversationId: string | null; identitySnapshot: Prisma.JsonValue }, command: RunAdmissionCommand): boolean
{
	if (snapshot.siloId !== command.siloId || snapshot.agentServiceId !== command.agentServiceId || snapshot.conversationId !== command.conversationId) return false;
	if (!snapshot.identitySnapshot || typeof snapshot.identitySnapshot !== "object" || Array.isArray(snapshot.identitySnapshot)) return false;
	const identity = snapshot.identitySnapshot as Record<string, unknown>;
	if (identity["kind"] !== command.identityKind) return false;
	if (command.identityKind === "user") return identity["executionSubjectId"] === command.executionSubjectId;
	return identity["agentServiceId"] === command.agentServiceId && identity["executionSubjectId"] === `agent-service:${command.agentServiceId}`;
}

/** Require authority and snapshot evidence to express only the tagged command identity. */
function _matchesExecutionIdentity(authority: InitialRunAuthority, snapshot: RunInputSnapshot, command: RunAdmissionCommand): boolean
{
	if (command.identityKind === "user")
	{
		return authority.agentKind === "personal" && authority.trigger === "interactive" && authority.delegatedUserId === command.executionSubjectId && snapshot.identitySnapshot.kind === "user" && snapshot.identitySnapshot.executionSubjectId === command.executionSubjectId;
	}
	return authority.agentKind === "managed" && authority.trigger === command.trigger && authority.delegatedUserId === null && snapshot.identitySnapshot.kind === "service" && snapshot.identitySnapshot.agentServiceId === command.agentServiceId && snapshot.identitySnapshot.executionSubjectId === `agent-service:${command.agentServiceId}`;
}

/** Returns whether the transaction-fenced authority exactly matches immutable caller coordinates. */
function _matchesCommand(value: RunAdmissionBuild, command: RunAdmissionCommand): boolean
{
	return value.authority.agentServiceId === command.agentServiceId
		&& value.snapshot.runId === command.runId
		&& value.snapshot.siloId === command.siloId
		&& value.snapshot.agentServiceId === command.agentServiceId
		&& value.snapshot.conversationId === command.conversationId
		&& value.authority.trigger === command.trigger;
}

/** Inserts the run, its only snapshot, and the ordered initial run-domain events. */
async function _persistInitialAdmission(transaction: Prisma.TransactionClient, command: RunAdmissionCommand, value: RunAdmissionBuild, admittedAt: Date): Promise<void>
{
	await transaction.agentRun.create({ data: {
		id: command.runId,
		siloId: command.siloId,
		agentServiceId: value.authority.agentServiceId,
		agentRevisionId: value.authority.agentRevisionId,
		conversationId: command.conversationId,
		trigger: _trigger(value.authority.trigger),
		delegatedUserId: value.authority.delegatedUserId,
		requestIdempotencyKey: command.requestIdempotencyKey,
		rootRunId: value.authority.rootRunId,
		parentRunId: value.authority.parentRunId,
		effectiveContractDigest: value.authority.effectiveContractDigest,
		inputSnapshotDigest: value.snapshot.digest,
		acceptedAt: admittedAt,
	} });
	await transaction.runInputSnapshot.create({ data: _RunInputSnapshotData(value.snapshot) });
	await transaction.outboxEvent.createMany({ data: _InitialRunOutboxData(command.runId, value.snapshot.digest, admittedAt) });
}

/** Maps a dependency-light trigger to the owned database enum representation. */
function _trigger(value: InitialRunAuthority["trigger"]): "Interactive" | "Schedule" | "ManagedInvocation"
{
	if (value === "interactive") return "Interactive";
	if (value === "schedule") return "Schedule";
	return "ManagedInvocation";
}

/**
 * Builds the two outbox rows every admitted run starts with.
 *
 * Admission does not dispatch anything itself; it records what should happen and lets a worker pick it
 * up, so the run and the intent to start it commit together. `RunAccepted` at sequence 1 is the record
 * that the run exists, and `RunAttemptRequested` at sequence 2 is the command that gets attempt 1
 * running — the sequence numbers are what keep a reader from seeing the attempt before the acceptance.
 * Each `idempotencyKey` is derived from the run id and the attempt, so a worker that redelivers cannot
 * start attempt 1 twice.
 *
 * @param runId - The run both events belong to.
 * @param inputSnapshotDigest - Carried in both payloads so a worker can confirm it loaded the snapshot
 * the run was admitted with.
 * @param availableAt - When a worker may claim the rows; the admission time, so they are claimable at
 * once.
 */
export function _InitialRunOutboxData(runId: string, inputSnapshotDigest: string, availableAt: Date): Prisma.OutboxEventCreateManyInput[]
{
	const accepted: Prisma.OutboxEventCreateManyInput = {
		runId,
		attempt: 1,
		sequence: 1,
		kind: RunOutboxEventKind.RunAccepted,
		idempotencyKey: `${runId}:accepted`,
		payload: { runId, inputSnapshotDigest },
		availableAt,
	};
	const attemptRequested: Prisma.OutboxEventCreateManyInput = {
		runId,
		attempt: 1,
		sequence: 2,
		kind: RunOutboxEventKind.RunAttemptRequested,
		idempotencyKey: `${runId}:attempt:1`,
		payload: { runId, attempt: 1, inputSnapshotDigest },
		availableAt,
	};
	return [accepted, attemptRequested];
}

/**
 * Copies the compiled snapshot into the row shape Prisma writes.
 *
 * Fields are listed one by one rather than spread, so a field added to the contract is stored only once
 * someone names it here — the column set never drifts by accident. Arrays are copied and the JSON fields
 * go through {@link _json}, so nothing Prisma is handed is still shared with the compiled snapshot.
 *
 * Called by: `_persistInitialAdmission` above, and `prisma-child-run-reservation-repository.ts` for a
 * child run's snapshot. Both write the same row shape, which is what lets {@link _RunInputSnapshot} read
 * either back.
 */
export function _RunInputSnapshotData(snapshot: RunInputSnapshot): Prisma.RunInputSnapshotUncheckedCreateInput
{
	const data: Prisma.RunInputSnapshotUncheckedCreateInput = {
		runId: snapshot.runId,
		snapshotVersion: snapshot.snapshotVersion,
		siloId: snapshot.siloId,
		agentServiceId: snapshot.agentServiceId,
		agentRevisionId: snapshot.agentRevisionId,
		effectiveContractDigest: snapshot.effectiveContractDigest,
		personaRevisionId: snapshot.personaRevisionId,
		conversationId: snapshot.conversationId,
		messageIds: [...snapshot.messageIds],
		preferenceFactIds: [...snapshot.preferenceFactIds],
		artifactRevisionIds: [...snapshot.artifactRevisionIds],
		identitySnapshot: _json(snapshot.identitySnapshot),
		modelRoute: _json(snapshot.modelRoute),
		integrationAssignments: _json(snapshot.integrationAssignments),
		skillRevisionIds: [...snapshot.skillRevisionIds],
		memoryQueryPolicy: _json(snapshot.memoryQueryPolicy),
		budgetPolicy: _json(snapshot.budgetPolicy),
		capabilitySetDigest: snapshot.capabilitySetDigest,
		promptCompilerVersion: snapshot.promptCompilerVersion,
		digest: snapshot.digest,
		compiledAt: new Date(snapshot.compiledAt),
	};
	return data;
}

/**
 * Reads a stored snapshot row back as the contract shape.
 *
 * This is what a duplicate request gets: the snapshot the first request froze, unchanged. The JSON
 * columns come back from Prisma as generic JSON and are cast to their contract types without
 * re-validation, which holds because {@link _RunInputSnapshotData} is the only way these rows are
 * written — a hand-edited row would not be caught here.
 */
export function _RunInputSnapshot(row: PrismaRunInputSnapshot): RunInputSnapshot
{
	const snapshot: RunInputSnapshot = {
		runId: row.runId,
		siloId: row.siloId,
		agentServiceId: row.agentServiceId,
		agentRevisionId: row.agentRevisionId,
		snapshotVersion: row.snapshotVersion,
		conversationId: row.conversationId,
		messageIds: row.messageIds,
		personaRevisionId: row.personaRevisionId,
		preferenceFactIds: row.preferenceFactIds,
		artifactRevisionIds: row.artifactRevisionIds,
		skillRevisionIds: row.skillRevisionIds,
		memoryQueryPolicy: row.memoryQueryPolicy as RunInputSnapshot["memoryQueryPolicy"],
		integrationAssignments: row.integrationAssignments as unknown as RunInputSnapshot["integrationAssignments"],
		modelRoute: row.modelRoute as RunInputSnapshot["modelRoute"],
		budgetPolicy: row.budgetPolicy as RunInputSnapshot["budgetPolicy"],
		identitySnapshot: row.identitySnapshot as unknown as RunInputSnapshot["identitySnapshot"],
		capabilitySetDigest: row.capabilitySetDigest,
		effectiveContractDigest: row.effectiveContractDigest,
		promptCompilerVersion: row.promptCompilerVersion,
		digest: row.digest,
		compiledAt: row.compiledAt.toISOString(),
	};
	return snapshot;
}

/** Makes a JSON-safe deep copy before Prisma owns an immutable snapshot field. */
function _json(value: unknown): Prisma.InputJsonValue
{
	return ___CloneCanonicalJson(value as JsonValue) as Prisma.InputJsonValue;
}
