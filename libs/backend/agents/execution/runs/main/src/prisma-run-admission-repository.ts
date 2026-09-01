import { Prisma, type PrismaClient, type RunInputSnapshot as PrismaRunInputSnapshot } from "@prisma/client";

import { ___ExecutionSubjectSchema, type RunInputSnapshot } from "@opencrane/contracts";
import { ___CreateLogger, type Logger } from "@opencrane/backend/observability";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";
import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { ___CloneCanonicalJson } from "@opencrane/util";
import type { JsonValue } from "@opencrane/util";

import { PrismaAgentRunWorkflowTaskAdmissionUnitOfWork } from "./prisma-agent-run-workflow-task-admission-unit-of-work";
import { RunAdmissionDenialReasons } from "./run-admission.types";
import type { InitialRunAuthority, RunAdmissionBuild, RunAdmissionBuildResult, RunAdmissionClock, RunAdmissionCommand, RunAdmissionCommit, RunAdmissionPrepare, RunAdmissionRepository, RunAdmissionResult, RunAdmissionTransaction } from "./run-admission.types";

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
 * preparation writes, the snapshot compilation the caller supplies, the run row, its snapshot row,
 * and its Absurd workflow task. Either all of it commits or none of it does,
 * so no reader can ever see a run without its snapshot or the workflow task that starts it.
 *
 * Serializable isolation and the unique silo + idempotency key make that safe under concurrent
 * callers. A losing duplicate recovers the winner's immutable snapshot after its transaction ends.
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
export class PrismaRunAdmissionUnitOfWork implements RunAdmissionRepository
{
	/** Canonical OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient;
	/** Server-owned clock that freezes an admission instant only after a non-duplicate request reaches this boundary. */
	private readonly clock: RunAdmissionClock;
	/** Structured persistence-failure signal with process-wide secret redaction. */
	private readonly log: Logger;
	/** Guarded engine that saves the controller-owned task in the run admission transaction. */
	private readonly workflow: Pick<IWorkflowEngine, "spawn">;

	/**
	 * Creates an initial-admission repository over canonical Postgres.
	 * @param prisma - Canonical product-authority database client.
	 * @param workflow - Guarded engine that saves the controller-owned task in the same transaction.
	 * @param clock - Server-owned admission clock, replaceable only for deterministic tests.
	 * @param log - Structured redacting logger for otherwise fail-closed persistence failures.
	 */
	constructor(prisma: PrismaClient, workflow: Pick<IWorkflowEngine, "spawn">, clock: RunAdmissionClock = { now: function _now(): Date { return new Date(); } }, log: Logger = ___CreateLogger("run-admission"))
	{
		this.prisma = prisma;
		this.workflow = workflow;
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
		const workflow = this.workflow;
		try
		{
			return await this.prisma.$transaction(async function _admit(transaction: Prisma.TransactionClient): Promise<RunAdmissionResult<TDenial>>
			{
				const authorization = new PrismaAuthorizationAuthority(transaction);
					// 1. Check the unique user-visible key before loading inputs so a committed duplicate is never recompiled.
				const existing = await transaction.agentRun.findUnique({ where: { siloId_requestIdempotencyKey: { siloId: command.siloId, requestIdempotencyKey: command.requestIdempotencyKey } } });
				if (existing !== null)
				{
					if (!_matchesIdempotencyScope(existing, command)) return { outcome: "denied", reason: RunAdmissionDenialReasons.AuthorityConflict };
					const existingSnapshot = await transaction.runInputSnapshot.findUnique({ where: { runId_attempt_digest: { runId: existing.id, attempt: existing.attempt, digest: existing.inputSnapshotDigest } } });
					if (existingSnapshot !== null)
					{
						if (!_matchesSnapshotScope(existingSnapshot, command)) return { outcome: "denied", reason: RunAdmissionDenialReasons.AuthorityConflict };
						return { outcome: "idempotent", snapshot: _RunInputSnapshot(existingSnapshot) };
					}
				}

					// 2. Revalidate every input against the same Serializable transaction snapshot.
				const admittedAtDate = clock.now();
				const admittedAt = admittedAtDate.toISOString();
				// 3. Let the caller create the rows its own inputs need, so a child conversation exists
				// before the conversation source reads it. It runs here, past the duplicate check, so a
				// retried request cannot create a second child.
					if (prepare)
						await prepare({ prisma: transaction, authorization, admittedAt, admittedAtEpochMs: admittedAtDate.getTime() });
				const compiled = await build({ prisma: transaction, authorization, admittedAt, admittedAtEpochMs: admittedAtDate.getTime() });

				// 4. Refuse by throwing whenever preparation already wrote rows, because returning would
				// commit them without a run; see _PreparedAdmissionDenied.
				if (compiled.outcome === "denied")
				{
					if (prepare) throw new _PreparedAdmissionDenied(compiled.reason);
					return compiled;
				}
				if (!_matchesCommand(compiled.value, command) || !_matchesExecutionSubject(compiled.value.authority, compiled.value.snapshot, command))
				{
					if (prepare) throw new _PreparedAdmissionDenied(RunAdmissionDenialReasons.AuthorityConflict);
					return { outcome: "denied", reason: RunAdmissionDenialReasons.AuthorityConflict };
				}

				// 5. Insert both sides of the deferred snapshot relation and admit the controller task.
				await _persistInitialAdmission(transaction, command, compiled.value, admittedAtDate);
				const admission = new PrismaAgentRunWorkflowTaskAdmissionUnitOfWork(transaction);
				await admission.admit(workflow, { siloId: command.siloId, runId: command.runId, attempt: 1 });
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
						const existingSnapshot = await this.prisma.runInputSnapshot.findUnique({ where: { runId_attempt_digest: { runId: existing.id, attempt: existing.attempt, digest: existing.inputSnapshotDigest } } });
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
function _matchesIdempotencyScope(existing: { readonly siloId: string; readonly agentServiceId: string; readonly conversationId: string | null; readonly trigger: string }, command: RunAdmissionCommand): boolean
{
	return existing.siloId === command.siloId
		&& existing.agentServiceId === command.agentServiceId
		&& existing.conversationId === command.conversationId
		&& existing.trigger === _trigger(command.trigger);
}

/** Returns whether a recovered immutable snapshot belongs to the exact execution subject requesting it. */
function _matchesSnapshotScope(snapshot: { readonly siloId: string; readonly agentServiceId: string; readonly conversationId: string | null }, command: RunAdmissionCommand): boolean
{
	return snapshot.siloId === command.siloId
		&& snapshot.agentServiceId === command.agentServiceId
		&& snapshot.conversationId === command.conversationId;
}

/** Requires the command and snapshot to carry one structurally valid, fully bound execution subject. */
function _matchesExecutionSubject(authority: InitialRunAuthority, snapshot: RunInputSnapshot, command: RunAdmissionCommand): boolean
{
	const parsedSnapshotSubject = ___ExecutionSubjectSchema.safeParse(snapshot.executionSubject);
	if (!parsedSnapshotSubject.success)
		return false;
	return authority.agentServiceId === command.agentServiceId
		&& authority.agentRevisionId === parsedSnapshotSubject.data.runScope.agentRevisionId
		&& authority.trigger === command.trigger
		&& snapshot.attempt === 1
		&& snapshot.agentRevisionId === authority.agentRevisionId
		&& parsedSnapshotSubject.data.runScope.runId === command.runId
		&& parsedSnapshotSubject.data.runScope.attempt === 1
		&& parsedSnapshotSubject.data.runScope.siloId === command.siloId
		&& parsedSnapshotSubject.data.runScope.agentServiceId === command.agentServiceId
		&& parsedSnapshotSubject.data.computerScope.siloId === command.siloId;
}

/** Returns whether the transaction-fenced authority exactly matches immutable caller coordinates. */
function _matchesCommand(value: RunAdmissionBuild, command: RunAdmissionCommand): boolean
{
	return value.authority.agentServiceId === command.agentServiceId
		&& value.snapshot.runId === command.runId
		&& value.snapshot.siloId === command.siloId
		&& value.snapshot.agentServiceId === command.agentServiceId
		&& value.snapshot.conversationId === command.conversationId
		&& value.authority.trigger === command.trigger
		&& value.snapshot.agentRevisionId === value.authority.agentRevisionId
		&& value.snapshot.executionSubject.runScope.runId === command.runId;
}

/** Inserts the run and its only snapshot. */
async function _persistInitialAdmission(transaction: Prisma.TransactionClient, command: RunAdmissionCommand, value: RunAdmissionBuild, admittedAt: Date): Promise<void>
{
	await transaction.agentRun.create({ data: {
		id: command.runId,
		siloId: command.siloId,
		agentServiceId: value.authority.agentServiceId,
		agentRevisionId: value.authority.agentRevisionId,
		conversationId: command.conversationId,
		trigger: _trigger(value.authority.trigger),
		agentIdentityId: value.snapshot.executionSubject.agentIdentityId,
		principalId: value.snapshot.executionSubject.principalId,
		executionSubject: _json(value.snapshot.executionSubject),
		requestIdempotencyKey: command.requestIdempotencyKey,
		rootRunId: value.authority.rootRunId,
		parentRunId: value.authority.parentRunId,
		inputSnapshotDigest: value.snapshot.digest,
		acceptedAt: admittedAt,
	} });
	await transaction.runInputSnapshot.create({ data: _RunInputSnapshotData(value.snapshot) });
}

/** Maps a dependency-light trigger to the owned database enum representation. */
function _trigger(value: InitialRunAuthority["trigger"]): "Interactive" | "Schedule" | "ManagedInvocation"
{
	if (value === "interactive") return "Interactive";
	if (value === "schedule") return "Schedule";
	return "ManagedInvocation";
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
	const executionSubject = _ExecutionSubjectFrom(snapshot.executionSubject, snapshot.executionSubject.agentIdentityId, snapshot.executionSubject.principalId);
	const data: Prisma.RunInputSnapshotUncheckedCreateInput = {
		runId: snapshot.runId,
		attempt: snapshot.attempt,
		snapshotVersion: snapshot.snapshotVersion,
		siloId: snapshot.siloId,
		agentServiceId: snapshot.agentServiceId,
		agentRevisionId: snapshot.agentRevisionId,
		agentIdentityId: executionSubject.agentIdentityId,
		principalId: executionSubject.principalId,
		executionSubject: _json(executionSubject),
		personaRevisionId: snapshot.personaRevisionId,
		conversationId: snapshot.conversationId,
		messageIds: [...snapshot.messageIds],
		preferenceFactIds: [...snapshot.preferenceFactIds],
		artifactRevisionIds: [...snapshot.artifactRevisionIds],
		modelRoute: _json(snapshot.modelRoute),
		mcpTools: _json(snapshot.mcpTools),
		skillRevisionIds: [...snapshot.skillRevisionIds],
		memoryQueryPolicy: _json(snapshot.memoryQueryPolicy),
		budgetPolicy: _json(snapshot.budgetPolicy),
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
	const executionSubject = _ExecutionSubjectFrom(row.executionSubject, row.agentIdentityId, row.principalId);
	const snapshot: RunInputSnapshot = {
		runId: row.runId,
		attempt: row.attempt,
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
		mcpTools: row.mcpTools as unknown as RunInputSnapshot["mcpTools"],
		modelRoute: row.modelRoute as RunInputSnapshot["modelRoute"],
		budgetPolicy: row.budgetPolicy as RunInputSnapshot["budgetPolicy"],
		executionSubject,
		promptCompilerVersion: row.promptCompilerVersion,
		digest: row.digest,
		compiledAt: row.compiledAt.toISOString(),
	};
	return snapshot;
}

/** Parses persisted subject evidence and rejects rows whose indexed identity coordinates diverge. */
function _ExecutionSubjectFrom(value: unknown, agentIdentityId: string, principalId: string): RunInputSnapshot["executionSubject"]
{
	const parsed = ___ExecutionSubjectSchema.safeParse(value);
	if (!parsed.success || parsed.data.agentIdentityId !== agentIdentityId || parsed.data.principalId !== principalId)
		throw new Error("run execution subject does not match its persisted identity coordinates");
	return parsed.data;
}

/** Makes a JSON-safe deep copy before Prisma owns an immutable snapshot field. */
function _json(value: unknown): Prisma.InputJsonValue
{
	return ___CloneCanonicalJson(value as JsonValue) as Prisma.InputJsonValue;
}
