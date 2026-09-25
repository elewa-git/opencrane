import { AgentRoutineFiringDisposition, AgentRoutineFiringTrigger, AgentRunTrigger, Prisma, type AgentRun, type PrismaClient, type RunInputSnapshot as PrismaRunInputSnapshot } from "@prisma/client";

import { ___CreateLogger, type Logger } from "@opencrane/backend/observability";
import { PrismaAuthorizationAuthority, PrismaManagedAuthorizationGrantRepository, type ManagedAuthorizationGrantRepository } from "@opencrane/backend/server/iam/authorization";
import { AgentRunTriggers, RUN_INPUT_SNAPSHOT_VERSION, ___ExecutionSubjectSchema, ___ParseRunBudgetPolicy, ___RunInputOriginSchema, type RunInputSnapshot } from "@opencrane/contracts";
import { ExecutionSubjectMembershipKinds } from "@opencrane/models/agents";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";
import { ___CloneCanonicalJson, type JsonValue } from "@opencrane/util";

import type { RunAdmissionPersistenceRepository } from "./run-admission-persistence.types";
import { RunAdmissionBuildOutcomes, RunAdmissionDenialReasons, RunAdmissionExistingVerificationOutcomes, RunAdmissionMessageInputModes, RunAdmissionOutcomes, type InitialRunAuthority, type RunAdmissionBuild, type RunAdmissionBuildResult, type RunAdmissionClock, type RunAdmissionCommand, type RunAdmissionCommit, type RunAdmissionExistingVerifier, type RunAdmissionPrepare, type RunAdmissionRepository, type RunAdmissionResult, type RunAdmissionTransaction } from "./run-admission.types";

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
 * Called by: application-owned personal and company run composition behind conversation turn admission.
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
					if (duplicate.outcome === RunAdmissionOutcomes.Denied)
						return duplicate;
					const verifiedAt = clock.now();
					const verified = await verifyExisting(duplicate.snapshot, { prisma: transaction, authorization, admittedAt: verifiedAt.toISOString(), admittedAtEpochMs: verifiedAt.getTime() });
					if (verified.outcome === RunAdmissionExistingVerificationOutcomes.Denied)
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
				if (compiled.outcome === RunAdmissionBuildOutcomes.Denied)
					throw new _AdmissionDenied(compiled.reason);
				if (!_MatchesAdmission(compiled.value, command))
					throw new _AdmissionDenied(RunAdmissionDenialReasons.AuthorityConflict);

				// 4. Persist both deferred-relation sides before the caller's claimed computer continues the turn.
				await persistence.persist(command, compiled.value, admittedAt);
				if (commit !== undefined)
					await commit(transactionContext, compiled.value);
				return { outcome: RunAdmissionOutcomes.Accepted, snapshot: compiled.value.snapshot };
			});
		}
		catch (error)
		{
			if (error instanceof _AdmissionDenied)
				return { outcome: RunAdmissionOutcomes.Denied, reason: error.reason as TDenial };
			if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
			{
				const recovered = await this._RecoverDuplicate(command, verifyExisting);
				if (recovered !== null)
					return recovered;
			}
			this._logger.error({ err: error, runId: command.runId, siloId: command.siloId, agentServiceId: command.agentServiceId }, "Run admission persistence failed");
			return { outcome: RunAdmissionOutcomes.Denied, reason: RunAdmissionDenialReasons.PersistenceUnavailable };
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
				if (recovered === null || recovered.outcome === RunAdmissionOutcomes.Denied)
					return recovered;
				const verifiedAt = clock.now();
				const verified = await verifyExisting(recovered.snapshot, { prisma: transaction, authorization, admittedAt: verifiedAt.toISOString(), admittedAtEpochMs: verifiedAt.getTime() });
				return verified.outcome === RunAdmissionExistingVerificationOutcomes.Denied ? { outcome: RunAdmissionOutcomes.Denied, reason: verified.reason } : recovered;
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
			const managedGrants = new PrismaManagedAuthorizationGrantRepository(transaction);
			const repository = new PrismaRunAdmissionRepository(transaction, managedGrants);
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
	/** Writes the new personal run's owner grant in the admission transaction. */
	private readonly _managedGrants: ManagedAuthorizationGrantRepository;

	/** Bind persistence to the unit of work's exact transaction. */
	constructor(transaction: Prisma.TransactionClient, managedGrants: ManagedAuthorizationGrantRepository)
	{
		this._transaction = transaction;
		this._managedGrants = managedGrants;
	}

	/** Return an exact duplicate, an authority conflict, or null when this key remains unused. */
	async resolveExisting(command: RunAdmissionCommand): Promise<RunAdmissionResult<never> | null>
	{
		const run = await this._transaction.agentRun.findUnique({ where: { siloId_requestIdempotencyKey: { siloId: command.siloId, requestIdempotencyKey: command.requestIdempotencyKey } } });
		if (run === null)
			return null;
		if (!_MatchesRun(run, command))
			return { outcome: RunAdmissionOutcomes.Denied, reason: RunAdmissionDenialReasons.AuthorityConflict };
		if (command.trigger !== AgentRunTriggers.Interactive && !await this._MatchesRoutineFiring(run.id, command))
			return { outcome: RunAdmissionOutcomes.Denied, reason: RunAdmissionDenialReasons.AuthorityConflict };
		const row = await this._transaction.runInputSnapshot.findUnique({ where: { runId_attempt_digest: { runId: run.id, attempt: run.attempt, digest: run.inputSnapshotDigest } } });
		if (row === null || !_MatchesSnapshot(row, run.id, command))
			return { outcome: RunAdmissionOutcomes.Denied, reason: RunAdmissionDenialReasons.AuthorityConflict };
		return { outcome: RunAdmissionOutcomes.Idempotent, snapshot: _RunInputSnapshot(row) };
	}

	/** Persist the logical run and its first append-only snapshot as one deferred-relation pair. */
	async persist(command: RunAdmissionCommand, value: RunAdmissionBuild, admittedAt: Date): Promise<void>
	{
		const subject = _ExecutionSubject(value.snapshot.executionSubject, value.snapshot.executionSubject.agentIdentityId, value.snapshot.executionSubject.principalId);
		const routine = command.trigger === AgentRunTriggers.Interactive ? null : command.routineInput;
		const data: Prisma.AgentRunUncheckedCreateInput = { id: command.runId, siloId: command.siloId, agentServiceId: value.authority.agentServiceId, agentRevisionId: value.authority.agentRevisionId, conversationId: command.conversationId, trigger: _PrismaRunTrigger(command), routineFiringId: routine?.firingId ?? null, routineId: routine?.routineId ?? null, routineRevision: routine?.routineRevision ?? null, routineScheduledSlot: routine?.scheduledSlot === null || routine === null ? null : new Date(routine.scheduledSlot), agentIdentityId: subject.agentIdentityId, principalId: subject.principalId, executionSubject: _Json(subject), requestIdempotencyKey: command.requestIdempotencyKey, inputSnapshotDigest: value.snapshot.digest, acceptedAt: admittedAt };
		await this._transaction.agentRun.create({ data });
		await this._transaction.runInputSnapshot.create({ data: _RunInputSnapshotData(value.snapshot) });
		if (command.trigger !== AgentRunTriggers.Interactive)
			await this._BindRoutineFiring(command);
		await this._GrantPersonalOwnerRead(value, admittedAt);
	}

	/** Link one prepared firing to the run only when every stored occurrence coordinate still matches. */
	private async _BindRoutineFiring(command: Exclude<RunAdmissionCommand, { readonly trigger: `${AgentRunTriggers.Interactive}` }>): Promise<void>
	{
		const routine = command.routineInput;
		const result = await this._transaction.agentRoutineFiring.updateMany({
			where: { id: routine.firingId, siloId: command.siloId, routineId: routine.routineId, routineRevision: routine.routineRevision, conversationId: command.conversationId!, requesterPrincipalId: routine.requesterPrincipalId, trigger: _PrismaRoutineTrigger(command), scheduledSlot: routine.scheduledSlot === null ? null : new Date(routine.scheduledSlot), runId: null, disposition: AgentRoutineFiringDisposition.Preparing, workflowTaskId: routine.workflowTaskId, workflowTaskName: routine.workflowTaskName, workflowTaskKey: routine.workflowTaskKey },
			data: { runId: command.runId },
		});
		if (result.count !== 1)
			throw new _AdmissionDenied(RunAdmissionDenialReasons.AuthorityConflict);
	}

	/** Verify a duplicate still owns the exact firing and saved occurrence workflow fence. */
	private async _MatchesRoutineFiring(runId: string, command: Exclude<RunAdmissionCommand, { readonly trigger: `${AgentRunTriggers.Interactive}` }>): Promise<boolean>
	{
		const routine = command.routineInput;
		const firing = await this._transaction.agentRoutineFiring.findUnique({ where: { id: routine.firingId } });
		return firing !== null && _AllowsDuplicateRoutineAdmission(firing.disposition) && firing.siloId === command.siloId && firing.routineId === routine.routineId && firing.routineRevision === routine.routineRevision
			&& firing.conversationId === command.conversationId && firing.requesterPrincipalId === routine.requesterPrincipalId && firing.trigger === _PrismaRoutineTrigger(command)
			&& _SameInstant(firing.scheduledSlot, routine.scheduledSlot) && firing.runId === runId && firing.workflowTaskId === routine.workflowTaskId
			&& firing.workflowTaskName === routine.workflowTaskName && firing.workflowTaskKey === routine.workflowTaskKey;
	}

	/**
	 * Gives the verified personal owner read access when the run is first created.
	 * Company runs retain their managed identity. Duplicate admission never calls this method,
	 * so retrying a request cannot restore a revoked grant. Any grant failure rolls back the run.
	 * @see PersonalConversationExecutionSubjectAuthority for personal ownership verification.
	 */
	private async _GrantPersonalOwnerRead(value: RunAdmissionBuild, admittedAt: Date): Promise<void>
	{
		const subject = value.snapshot.executionSubject;
		if (subject.membership.kind === ExecutionSubjectMembershipKinds.Managed)
			return;
		const principalId = subject.principalId;
		if (principalId !== subject.requester.requesterPrincipalId)
			throw new _AdmissionDenied(RunAdmissionDenialReasons.AuthorityConflict);
		const resource = { kind: ProductAuthorizationResourceKinds.AgentRun, id: value.snapshot.runId } as const;
		const capability = __ProductAuthorizationCapability(resource.kind, ProductAuthorizationActions.Read);
		if (capability === null)
			throw new Error("Personal run read capability is unavailable");
		await this._managedGrants.reconcileManagedResourceGrants({ siloId: value.snapshot.siloId, managerId: "personal-run-owner", resource, now: admittedAt, grants: [{ subject: { kind: AuthorizationSubjectKinds.Principal, principalId }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource, priority: 0, createdByPrincipalId: principalId }] });
	}
}

/** Check the immutable run coordinates selected by the user-visible idempotency key. */
function _MatchesRun(run: AgentRun, command: RunAdmissionCommand): boolean
{
	if (run.siloId !== command.siloId || run.agentServiceId !== command.agentServiceId || run.conversationId !== command.conversationId || run.trigger !== _PrismaRunTrigger(command))
		return false;
	if (command.trigger === AgentRunTriggers.Interactive)
		return run.routineFiringId === null && run.routineId === null && run.routineRevision === null && run.routineScheduledSlot === null;
	return run.routineFiringId === command.routineInput.firingId
		&& run.routineId === command.routineInput.routineId
		&& run.routineRevision === command.routineInput.routineRevision
		&& _SameInstant(run.routineScheduledSlot, command.routineInput.scheduledSlot);
}

/** Check the current immutable snapshot coordinates before returning stored JSON to a duplicate caller. */
function _MatchesSnapshot(snapshot: PrismaRunInputSnapshot, storedRunId: string, command: RunAdmissionCommand): boolean
{
	const parsed = ___ExecutionSubjectSchema.safeParse(snapshot.executionSubject);
	if (!parsed.success || parsed.data.principalId !== snapshot.principalId || parsed.data.agentIdentityId !== snapshot.agentIdentityId)
		return false;
	return snapshot.snapshotVersion === RUN_INPUT_SNAPSHOT_VERSION && snapshot.runId === storedRunId && snapshot.siloId === command.siloId && snapshot.agentServiceId === command.agentServiceId && snapshot.conversationId === command.conversationId
		&& _MatchesOrigin(snapshot.origin, command) && _MatchesRequester(parsed.data.requester.requesterPrincipalId, command) && _MatchesMessageInput(command, snapshot.messageIds);
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
		&& _MatchesOrigin(value.snapshot.origin, command)
		&& _MatchesMessageInput(command, value.snapshot.messageIds)
		&& _MatchesRequester(parsed.data.requester.requesterPrincipalId, command)
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
	if (command.trigger !== AgentRunTriggers.Interactive)
		return command.messageInput === null && snapshotMessageIds.length > 0 && new Set(snapshotMessageIds).size === snapshotMessageIds.length;
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

/** Match the human author for interactive work or the stored routine requester for service work. */
function _MatchesRequester(requesterPrincipalId: string, command: RunAdmissionCommand): boolean
{
	if (command.trigger === AgentRunTriggers.Interactive)
		return command.messageInput === null || requesterPrincipalId === command.messageInput.author.principalId;
	return requesterPrincipalId === command.routineInput.requesterPrincipalId;
}

/** Match every immutable trigger coordinate before accepting or releasing a snapshot. */
function _MatchesOrigin(value: unknown, command: RunAdmissionCommand): boolean
{
	const parsed = ___RunInputOriginSchema.safeParse(value);
	if (!parsed.success || parsed.data.kind !== command.trigger)
		return false;
	const origin = parsed.data;
	if (origin.kind === AgentRunTriggers.Interactive)
		return command.trigger === AgentRunTriggers.Interactive
			&& origin.messageId === (command.messageInput?.messageId ?? null)
			&& origin.historyRevision === (command.messageInput?.historyRevision ?? null);
	if (command.trigger === AgentRunTriggers.Interactive)
		return false;
	return origin.routineId === command.routineInput.routineId
		&& origin.routineRevision === command.routineInput.routineRevision
		&& origin.firingId === command.routineInput.firingId
		&& origin.scheduledSlot === command.routineInput.scheduledSlot
		&& origin.requesterPrincipalId === command.routineInput.requesterPrincipalId
		&& origin.requesterIssuer === command.routineInput.requesterIssuer
		&& origin.requesterSubjectId === command.routineInput.requesterSubjectId
		&& origin.requesterAuthenticatedAt === command.routineInput.requesterAuthenticatedAt
		&& origin.workflowTaskId === command.routineInput.workflowTaskId
		&& origin.workflowTaskName === command.routineInput.workflowTaskName
		&& origin.workflowTaskKey === command.routineInput.workflowTaskKey;
}

/** Map the public serialized trigger to Prisma's enum member name. */
function _PrismaRunTrigger(command: RunAdmissionCommand): AgentRunTrigger
{
	if (command.trigger === AgentRunTriggers.Interactive)
		return AgentRunTrigger.Interactive;
	return command.trigger === AgentRunTriggers.Scheduled ? AgentRunTrigger.Scheduled : AgentRunTrigger.Manual;
}

/** Map scheduled run provenance to the occurrence authority's trigger vocabulary. */
function _PrismaRoutineTrigger(command: Exclude<RunAdmissionCommand, { readonly trigger: `${AgentRunTriggers.Interactive}` }>): AgentRoutineFiringTrigger
{
	return command.trigger === AgentRunTriggers.Scheduled ? AgentRoutineFiringTrigger.Automatic : AgentRoutineFiringTrigger.Manual;
}

/** Deny replay after an occurrence is cancelled, refused, failed, or deliberately skipped. */
function _AllowsDuplicateRoutineAdmission(disposition: AgentRoutineFiringDisposition): boolean
{
	return disposition !== AgentRoutineFiringDisposition.Cancelled && disposition !== AgentRoutineFiringDisposition.Refused
		&& disposition !== AgentRoutineFiringDisposition.Failed && disposition !== AgentRoutineFiringDisposition.SkippedOverlap;
}

/** Compare a nullable stored DateTime with its canonical snapshot representation. */
function _SameInstant(stored: Date | null, expected: string | null): boolean
{
	return stored === null ? expected === null : expected !== null && stored.toISOString() === expected;
}

/**
 * Copy every contract field into Prisma's current append-only snapshot create shape.
 *
 * Called by: `PrismaRunAdmissionRepository.persist` for the admitted attempt-one snapshot.
 * @see _RunInputSnapshot for the inverse projection.
 */
function _RunInputSnapshotData(snapshot: RunInputSnapshot): Prisma.RunInputSnapshotUncheckedCreateInput
{
	const subject = _ExecutionSubject(snapshot.executionSubject, snapshot.executionSubject.agentIdentityId, snapshot.executionSubject.principalId);
	return { runId: snapshot.runId, attempt: snapshot.attempt, snapshotVersion: snapshot.snapshotVersion, origin: _Json(snapshot.origin), siloId: snapshot.siloId, agentServiceId: snapshot.agentServiceId, agentRevisionId: snapshot.agentRevisionId, agentIdentityId: subject.agentIdentityId, principalId: subject.principalId, executionSubject: _Json(subject), personaRevisionId: snapshot.personaRevisionId, conversationId: snapshot.conversationId, messageIds: [...snapshot.messageIds], preferenceFactIds: [...snapshot.preferenceFactIds], artifactRevisionIds: [...snapshot.artifactRevisionIds], modelRoute: _Json(snapshot.modelRoute), mcpTools: _Json(snapshot.mcpTools), skillRevisionIds: [...snapshot.skillRevisionIds], memoryQueryPolicy: _Json(snapshot.memoryQueryPolicy), budgetPolicy: _Json(snapshot.budgetPolicy), promptCompilerVersion: snapshot.promptCompilerVersion, digest: snapshot.digest, compiledAt: new Date(snapshot.compiledAt) };
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
	const parsedOrigin = ___RunInputOriginSchema.safeParse(row.origin);
	if (!parsedOrigin.success)
		throw new Error("Run input snapshot origin is invalid");
	const origin = parsedOrigin.data;
	return { runId: row.runId, attempt: row.attempt, siloId: row.siloId, agentServiceId: row.agentServiceId, agentRevisionId: row.agentRevisionId, snapshotVersion: row.snapshotVersion, origin, conversationId: row.conversationId, messageIds: row.messageIds, personaRevisionId: row.personaRevisionId, preferenceFactIds: row.preferenceFactIds, artifactRevisionIds: row.artifactRevisionIds, skillRevisionIds: row.skillRevisionIds, memoryQueryPolicy: row.memoryQueryPolicy as RunInputSnapshot["memoryQueryPolicy"], mcpTools: row.mcpTools as unknown as RunInputSnapshot["mcpTools"], modelRoute: row.modelRoute as RunInputSnapshot["modelRoute"], budgetPolicy: ___ParseRunBudgetPolicy(row.budgetPolicy), executionSubject, promptCompilerVersion: row.promptCompilerVersion, digest: row.digest, compiledAt: row.compiledAt.toISOString() };
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
