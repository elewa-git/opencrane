import { Prisma, type PrismaClient, type RunInputSnapshot as PrismaRunInputSnapshot } from "@prisma/client";

import { ___CreateLogger, type Logger } from "@opencrane/backend/observability";
import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { ___ExecutionSubjectSchema, type RunInputSnapshot } from "@opencrane/contracts";
import { ___CloneCanonicalJson, type JsonValue } from "@opencrane/util";

import type { RunAdmissionPersistenceRepository } from "./run-admission-persistence.types";
import { RunAdmissionDenialReasons, RunAdmissionMessageInputModes, type InitialRunAuthority, type RunAdmissionBuild, type RunAdmissionBuildResult, type RunAdmissionClock, type RunAdmissionCommand, type RunAdmissionCommit, type RunAdmissionExistingVerifier, type RunAdmissionPrepare, type RunAdmissionRepository, type RunAdmissionResult, type RunAdmissionTransaction } from "./run-admission.types";

/** Forces Prisma to roll back authority writes whenever later admission checks refuse the run. */
class _AdmissionDenied<TDenial> extends Error
{
	/** Refusal returned after the transaction has rolled back. */
	readonly reason: TDenial;

	/** Create an internal rollback signal without putting refusal details in the error message. */
	constructor(reason: TDenial)
	{
		super("run admission denied");
		this.name = "AdmissionDenied";
		this.reason = reason;
	}
}

/**
 * Atomically persists a run and its first immutable snapshot for an already claimed conversation computer.
 *
 * Called by: application-owned personal run composition behind conversation turn admission.
 * @implements RunAdmissionRepository
 * @see PrismaRunAdmissionRepository for transaction-bound row access.
 */
export class PrismaRunAdmissionUnitOfWork implements RunAdmissionRepository
{
	/** Product database client that owns the admission transaction. */
	private readonly _prisma: PrismaClient;
	/** Trusted clock used only after duplicate detection. */
	private readonly _clock: RunAdmissionClock;
	/** Redacting logger for unknown persistence outcomes. */
	private readonly _logger: Logger;

	/** Create the transaction owner for first-attempt admission. */
	constructor(prisma: PrismaClient, clock: RunAdmissionClock = { now: function _Now(): Date { return new Date(); } }, logger: Logger = ___CreateLogger("run-admission"))
	{
		this._prisma = prisma;
		this._clock = clock;
		this._logger = logger;
	}

	/** Admit one run or return the exact immutable snapshot previously admitted under the same key. */
	async admit<TDenial>(command: RunAdmissionCommand, verifyExisting: RunAdmissionExistingVerifier<TDenial>, build: (transaction: RunAdmissionTransaction) => Promise<RunAdmissionBuildResult<TDenial>>, commit?: RunAdmissionCommit, prepare?: RunAdmissionPrepare): Promise<RunAdmissionResult<TDenial>>
	{
		const clock = this._clock;
		try
		{
			return await this._Run(Prisma.TransactionIsolationLevel.Serializable, async function _Admit(persistence, transaction, authorization)
			{
				// 1. Resolve a committed duplicate before caller preparation can create input rows twice.
				const duplicate = await persistence.resolveExisting(command);
				if (duplicate !== null)
				{
					if (duplicate.outcome === "denied")
						return duplicate;
					const verifiedAt = clock.now();
					const verified = await verifyExisting(duplicate.snapshot, { prisma: transaction, authorization, admittedAt: verifiedAt.toISOString(), admittedAtEpochMs: verifiedAt.getTime() });
					if (verified.outcome === "denied")
						throw new _AdmissionDenied(verified.reason);
					return duplicate;
				}

				// 2. Freeze one server-owned instant and let the caller create transaction-local input authority.
				const admittedAt = clock.now();
				const transactionContext = { prisma: transaction, authorization, admittedAt: admittedAt.toISOString(), admittedAtEpochMs: admittedAt.getTime() };
				if (prepare !== undefined)
					await prepare(transactionContext);

				// 3. Compile under the same snapshot and convert every refusal into a transaction rollback.
				const compiled = await build(transactionContext);
				if (compiled.outcome === "denied")
					throw new _AdmissionDenied(compiled.reason);
				if (!_MatchesAdmission(compiled.value, command))
					throw new _AdmissionDenied(RunAdmissionDenialReasons.AuthorityConflict);

				// 4. Persist both deferred-relation sides before the caller's claimed computer continues the turn.
				await persistence.persist(command, compiled.value, admittedAt);
				if (commit !== undefined)
					await commit(transactionContext, compiled.value);
				return { outcome: "accepted", snapshot: compiled.value.snapshot };
			});
		}
		catch (error)
		{
			if (error instanceof _AdmissionDenied)
				return { outcome: "denied", reason: error.reason as TDenial };
			if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
			{
				const recovered = await this._RecoverDuplicate(command, verifyExisting);
				if (recovered !== null)
					return recovered;
			}
			this._logger.error({ err: error, runId: command.runId, siloId: command.siloId, agentServiceId: command.agentServiceId }, "Run admission persistence failed");
			return { outcome: "denied", reason: RunAdmissionDenialReasons.PersistenceUnavailable };
		}
	}

	/** Recover the winning transaction after this request loses the unique idempotency-key race. */
	private async _RecoverDuplicate<TDenial>(command: RunAdmissionCommand, verifyExisting: RunAdmissionExistingVerifier<TDenial>): Promise<RunAdmissionResult<TDenial> | null>
	{
		try
		{
			const clock = this._clock;
			return await this._Run(Prisma.TransactionIsolationLevel.ReadCommitted, async function _ReadWinner(persistence, transaction, authorization)
			{
				const recovered = await persistence.resolveExisting(command);
				if (recovered === null || recovered.outcome === "denied")
					return recovered;
				const verifiedAt = clock.now();
				const verified = await verifyExisting(recovered.snapshot, { prisma: transaction, authorization, admittedAt: verifiedAt.toISOString(), admittedAtEpochMs: verifiedAt.getTime() });
				return verified.outcome === "denied" ? { outcome: "denied", reason: verified.reason } : recovered;
			});
		}
		catch (error)
		{
			this._logger.error({ err: error, runId: command.runId, siloId: command.siloId, agentServiceId: command.agentServiceId }, "Run admission duplicate recovery failed");
			return null;
		}
	}

	/** Open one transaction and construct its persistence adapter at one policy-audited ownership site. */
	private _Run<TResult>(isolationLevel: Prisma.TransactionIsolationLevel, operation: (repository: PrismaRunAdmissionRepository, transaction: Prisma.TransactionClient, authorization: PrismaAuthorizationAuthority) => Promise<TResult>): Promise<TResult>
	{
		return this._prisma.$transaction(async function _Run(transaction)
		{
			const repository = new PrismaRunAdmissionRepository(transaction);
			const authorization = new PrismaAuthorizationAuthority(transaction);
			return operation(repository, transaction, authorization);
		}, { isolationLevel });
	}
}

/**
 * Stores and recovers run admission rows through exactly one caller-owned Prisma transaction.
 *
 * Called by: `PrismaRunAdmissionUnitOfWork` inside serializable admission and duplicate recovery.
 * @implements RunAdmissionPersistenceRepository
 * @see PrismaRunAdmissionUnitOfWork for transaction ownership and failure mapping.
 */
class PrismaRunAdmissionRepository implements RunAdmissionPersistenceRepository
{
	/** Transaction shared by every duplicate read and admission write. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Bind persistence to the unit of work's exact transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/** Return an exact duplicate, an authority conflict, or null when this key remains unused. */
	async resolveExisting(command: RunAdmissionCommand): Promise<RunAdmissionResult<never> | null>
	{
		const run = await this._transaction.agentRun.findUnique({ where: { siloId_requestIdempotencyKey: { siloId: command.siloId, requestIdempotencyKey: command.requestIdempotencyKey } } });
		if (run === null)
			return null;
		if (!_MatchesRun(run, command))
			return { outcome: "denied", reason: RunAdmissionDenialReasons.AuthorityConflict };
		const row = await this._transaction.runInputSnapshot.findUnique({ where: { runId_attempt_digest: { runId: run.id, attempt: run.attempt, digest: run.inputSnapshotDigest } } });
		if (row === null || !_MatchesSnapshot(row, run.id, command))
			return { outcome: "denied", reason: RunAdmissionDenialReasons.AuthorityConflict };
		return { outcome: "idempotent", snapshot: _RunInputSnapshot(row) };
	}

	/** Persist the logical run and its first append-only snapshot as one deferred-relation pair. */
	async persist(command: RunAdmissionCommand, value: RunAdmissionBuild, admittedAt: Date): Promise<void>
	{
		const subject = _ExecutionSubject(value.snapshot.executionSubject, value.snapshot.executionSubject.agentIdentityId, value.snapshot.executionSubject.principalId);
		await this._transaction.agentRun.create({ data: { id: command.runId, siloId: command.siloId, agentServiceId: value.authority.agentServiceId, agentRevisionId: value.authority.agentRevisionId, conversationId: command.conversationId, trigger: "Interactive", agentIdentityId: subject.agentIdentityId, principalId: subject.principalId, executionSubject: _Json(subject), requestIdempotencyKey: command.requestIdempotencyKey, inputSnapshotDigest: value.snapshot.digest, acceptedAt: admittedAt } });
		await this._transaction.runInputSnapshot.create({ data: _RunInputSnapshotData(value.snapshot) });
	}
}

/** Check the immutable run coordinates selected by the user-visible idempotency key. */
function _MatchesRun(run: { readonly id: string; readonly siloId: string; readonly agentServiceId: string; readonly conversationId: string | null; readonly trigger: string }, command: RunAdmissionCommand): boolean
{
	return run.siloId === command.siloId && run.agentServiceId === command.agentServiceId && run.conversationId === command.conversationId && run.trigger === "Interactive";
}

/** Check the current immutable snapshot coordinates before returning stored JSON to a duplicate caller. */
function _MatchesSnapshot(snapshot: PrismaRunInputSnapshot, storedRunId: string, command: RunAdmissionCommand): boolean
{
	return snapshot.runId === storedRunId && snapshot.siloId === command.siloId && snapshot.agentServiceId === command.agentServiceId && snapshot.conversationId === command.conversationId && (command.messageInput === null || snapshot.principalId === command.messageInput.author.principalId) && _MatchesMessageInput(command, snapshot.messageIds);
}

/** Require the transaction-built authority, snapshot, and execution subject to name one first attempt. */
function _MatchesAdmission(value: RunAdmissionBuild, command: RunAdmissionCommand): boolean
{
	const parsed = ___ExecutionSubjectSchema.safeParse(value.snapshot.executionSubject);
	if (!parsed.success)
		return false;
	return value.authority.agentServiceId === command.agentServiceId
		&& value.authority.agentRevisionId === value.snapshot.agentRevisionId
		&& value.authority.trigger === command.trigger
		&& value.snapshot.runId === command.runId
		&& value.snapshot.attempt === 1
		&& value.snapshot.siloId === command.siloId
		&& value.snapshot.agentServiceId === command.agentServiceId
		&& value.snapshot.conversationId === command.conversationId
		&& _MatchesMessageInput(command, value.snapshot.messageIds)
		&& (command.messageInput === null || parsed.data.principalId === command.messageInput.author.principalId)
		&& parsed.data.runScope.runId === command.runId
		&& parsed.data.runScope.attempt === 1
		&& parsed.data.runScope.siloId === command.siloId
		&& parsed.data.runScope.agentServiceId === command.agentServiceId
		&& parsed.data.runScope.agentRevisionId === value.authority.agentRevisionId
		&& parsed.data.computerScope.siloId === command.siloId;
}

/** Require one exact final message provenance for a conversation and no message input for non-conversational work. */
function _MatchesMessageInput(command: RunAdmissionCommand, snapshotMessageIds: readonly string[]): boolean
{
	if (command.conversationId === null)
		return command.messageInput === null;
	if (command.messageInput === null || command.messageInput.messageId.trim().length === 0 || snapshotMessageIds.at(-1) !== command.messageInput.messageId)
		return false;
	return command.messageInput.mode === RunAdmissionMessageInputModes.PrePersistedHistory
		&& Object.keys(command.messageInput).length === 5
		&& Object.keys(command.messageInput.author).length === 4
		&& command.messageInput.historyRevision.trim().length > 0
		&& command.messageInput.orderedMessageIds.length > 0
		&& command.messageInput.orderedMessageIds.at(-1) === command.messageInput.messageId
		&& command.messageInput.orderedMessageIds.length === snapshotMessageIds.length
		&& command.messageInput.orderedMessageIds.every(function _MessageMatches(messageId, index): boolean { return snapshotMessageIds[index] === messageId; })
		&& command.messageInput.author.principalId.trim().length > 0
		&& command.messageInput.author.issuer === command.requester.issuer
		&& command.messageInput.author.subjectId === command.requester.subjectId
		&& command.messageInput.author.authenticatedAt === command.requester.authenticatedAt;
}

/** Map the contract trigger to Prisma's generated enum spelling. */

/**
 * Copy every contract field into Prisma's current append-only snapshot create shape.
 *
 * Called by: `PrismaRunAdmissionRepository.persist` for the admitted attempt-one snapshot.
 * @see _RunInputSnapshot for the inverse projection.
 */
function _RunInputSnapshotData(snapshot: RunInputSnapshot): Prisma.RunInputSnapshotUncheckedCreateInput
{
	const subject = _ExecutionSubject(snapshot.executionSubject, snapshot.executionSubject.agentIdentityId, snapshot.executionSubject.principalId);
	return { runId: snapshot.runId, attempt: snapshot.attempt, snapshotVersion: snapshot.snapshotVersion, siloId: snapshot.siloId, agentServiceId: snapshot.agentServiceId, agentRevisionId: snapshot.agentRevisionId, agentIdentityId: subject.agentIdentityId, principalId: subject.principalId, executionSubject: _Json(subject), personaRevisionId: snapshot.personaRevisionId, conversationId: snapshot.conversationId, messageIds: [...snapshot.messageIds], preferenceFactIds: [...snapshot.preferenceFactIds], artifactRevisionIds: [...snapshot.artifactRevisionIds], modelRoute: _Json(snapshot.modelRoute), mcpTools: _Json(snapshot.mcpTools), skillRevisionIds: [...snapshot.skillRevisionIds], memoryQueryPolicy: _Json(snapshot.memoryQueryPolicy), budgetPolicy: _Json(snapshot.budgetPolicy), promptCompilerVersion: snapshot.promptCompilerVersion, digest: snapshot.digest, compiledAt: new Date(snapshot.compiledAt) };
}

/**
 * Rebuild the public immutable snapshot from its current Prisma row.
 *
 * Called by: duplicate admission recovery and run-input consumers that load a frozen attempt.
 * @see _RunInputSnapshotData for the write projection.
 */
function _RunInputSnapshot(row: PrismaRunInputSnapshot): RunInputSnapshot
{
	const executionSubject = _ExecutionSubject(row.executionSubject, row.agentIdentityId, row.principalId);
	return { runId: row.runId, attempt: row.attempt, siloId: row.siloId, agentServiceId: row.agentServiceId, agentRevisionId: row.agentRevisionId, snapshotVersion: row.snapshotVersion, conversationId: row.conversationId, messageIds: row.messageIds, personaRevisionId: row.personaRevisionId, preferenceFactIds: row.preferenceFactIds, artifactRevisionIds: row.artifactRevisionIds, skillRevisionIds: row.skillRevisionIds, memoryQueryPolicy: row.memoryQueryPolicy as RunInputSnapshot["memoryQueryPolicy"], mcpTools: row.mcpTools as unknown as RunInputSnapshot["mcpTools"], modelRoute: row.modelRoute as RunInputSnapshot["modelRoute"], budgetPolicy: row.budgetPolicy as RunInputSnapshot["budgetPolicy"], executionSubject, promptCompilerVersion: row.promptCompilerVersion, digest: row.digest, compiledAt: row.compiledAt.toISOString() };
}

/** Parse subject evidence and reject a row whose indexed identity coordinates diverge. */
function _ExecutionSubject(value: unknown, agentIdentityId: string, principalId: string): RunInputSnapshot["executionSubject"]
{
	const parsed = ___ExecutionSubjectSchema.safeParse(value);
	if (!parsed.success || parsed.data.agentIdentityId !== agentIdentityId || parsed.data.principalId !== principalId)
		throw new Error("Run execution subject does not match its persisted identity coordinates");
	return parsed.data;
}

/** Give Prisma an independent JSON-safe copy of one immutable snapshot field. */
function _Json(value: unknown): Prisma.InputJsonValue
{
	return ___CloneCanonicalJson(value as JsonValue) as Prisma.InputJsonValue;
}
