import { AgentRunState, AgentRunTerminalReason, Prisma, WarmRuntimeReservationState, WorkloadAssignmentState, WorkloadKind, type PrismaClient } from "@prisma/client";

import type { AgentRunWarmRuntimeActivationCommand, AgentRunWarmRuntimeControllerAuthority, AgentRunWarmRuntimeDeletionCommand, AgentRunWarmRuntimeDeletionOutcome, AgentRunWarmRuntimeReadinessCommand, AgentRunWarmRuntimeReservationCommand, AgentRunWarmRuntimeUnreservedCancellationOutcome, AgentRunWorkflowControllerRecord, AgentRunWorkflowObservation, AgentRunTaskInput } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import { __CancelPendingRunApprovalAuthority } from "@opencrane/backend/server/iam/authorization";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import { RunEventTypes } from "@opencrane/models/agents";

import type { AgentRunWarmRuntimePersistenceRepository, AgentRunWorkflowControllerAuthorityOptions } from "./agent-run-workflow-controller-authority.types";
import { __DeliverChildRunCompletionInTransaction } from "./prisma-child-run-completion-repository";
import { __AgentRunWorkflowBootstrapClaimDigest, __AgentRunWorkflowBootstrapReferenceForTask, __AgentRunWorkflowRuntimeIdentity, __CanCreateOrObserveAgentRunWorkflowTask, __CurrentAgentRunWorkflowTask, PrismaAgentRunWorkflowTaskReadRepository } from "./prisma-agent-run-workflow-task-read-repository";

/** Retries expected unique and serializable conflicts during concurrent reservations. */
const _SERIALIZABLE_ATTEMPTS = 3;

/** Names a receipt-fenced task row from the shared controller reader. */
type AgentRunWorkflowTaskRow = NonNullable<Awaited<ReturnType<PrismaAgentRunWorkflowTaskReadRepository["read"]>>>;

/** Implements warm reservation transitions inside one caller-owned transaction. */
class PrismaAgentRunWarmRuntimeRepository implements AgentRunWarmRuntimePersistenceRepository
{
	/** Reads and writes through the transaction that owns the lifecycle decision. */
	private readonly transaction: Prisma.TransactionClient;
	/** Supplies namespace and lifetime limits selected by server composition. */
	private readonly options: AgentRunWorkflowControllerAuthorityOptions;
	/** Reloads the exact task receipt before every transition. */
	private readonly taskReader: PrismaAgentRunWorkflowTaskReadRepository;

	/** Creates the warm reservation repository within one serializable transaction. */
	constructor(transaction: Prisma.TransactionClient, options: AgentRunWorkflowControllerAuthorityOptions)
	{
		this.transaction = transaction;
		this.options = options;
		this.taskReader = new PrismaAgentRunWorkflowTaskReadRepository(this.transaction);
	}

	/** Reloads server-approved facts and accepts a matching warm reservation on replay. */
	async loadForTask(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt): Promise<AgentRunWorkflowControllerRecord | null>
	{
		const task = await this.taskReader.read(input, receipt);
		const identity = task === null ? null : __CurrentAgentRunWorkflowTask(task, input);
		if (task === null || task.run.service === null || !__CanCreateOrObserveAgentRunWorkflowTask(task.run.state))
		{
			return null;
		}
		if (task.run.state !== AgentRunState.Cancelling && identity === null)
		{
			return null;
		}
		const runtime = __AgentRunWorkflowRuntimeIdentity(task.run.service.kind, this.options);
		const reservation = await this.transaction.warmRuntimeReservation.findUnique({ where: { runId_attempt: { runId: input.runId, attempt: input.attempt } } });
		const trustedUntil = identity?.trustedUntil.getTime() ?? Date.now() + this.options.assignmentTtlMilliseconds;
		const expiresAt = task.assignmentExpiresAt ?? new Date(Math.min(Date.now() + this.options.assignmentTtlMilliseconds, trustedUntil));
		if (reservation !== null && (reservation.siloId !== input.siloId || reservation.namespace !== runtime.namespace || reservation.claimedProfile !== task.run.service.workloadProfile || reservation.idleDeadline.getTime() !== expiresAt.getTime()))
		{
			return null;
		}
		return { runId: input.runId, attempt: input.attempt, siloId: input.siloId, agentServiceId: task.run.agentServiceId, agentRevisionId: task.run.agentRevisionId, workloadProfile: task.run.service.workloadProfile, namespace: runtime.namespace, bootstrapReference: __AgentRunWorkflowBootstrapReferenceForTask(task), assignmentExpiresAt: expiresAt.toISOString(), observation: _Observation(task.run.state) };
	}

	/** Reserves one generic Pod and creates the runtime assignment in the same transaction. */
	async reserveWarmPod(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt, command: AgentRunWarmRuntimeReservationCommand): Promise<"bound" | "idempotent" | "conflict">
	{
		const task = await this.taskReader.read(input, receipt);
		const identity = task === null ? null : __CurrentAgentRunWorkflowTask(task, input);
		if (task === null || identity === null || task.run.service === null || !_ReservationCommand(command, task.run.service.workloadProfile))
		{
			return "conflict";
		}
		const runtime = __AgentRunWorkflowRuntimeIdentity(task.run.service.kind, this.options);
		const existing = await this.transaction.warmRuntimeReservation.findUnique({ where: { runId_attempt: { runId: input.runId, attempt: input.attempt } } });
		if (existing !== null)
		{
			return _ReservationMatches(existing, command, input, runtime.namespace) ? "idempotent" : "conflict";
		}
		if (task.assignmentExpiresAt !== null || (task.run.state !== AgentRunState.Accepted && task.run.state !== AgentRunState.Queued))
		{
			return "conflict";
		}
		const now = new Date();
		const expiresAt = new Date(Math.min(now.getTime() + this.options.assignmentTtlMilliseconds, identity.trustedUntil.getTime()));
		if (task.run.state === AgentRunState.Accepted)
		{
			const queued = await this.transaction.agentRun.updateMany({ where: { id: input.runId, attempt: input.attempt, state: AgentRunState.Accepted }, data: { state: AgentRunState.Queued } });
			if (queued.count !== 1) return "conflict";
		}
		const assigned = await this.transaction.agentRun.updateMany({ where: { id: input.runId, attempt: input.attempt, state: AgentRunState.Queued }, data: { state: AgentRunState.Assigned } });
		if (assigned.count !== 1) return "conflict";
		await this.transaction.warmRuntimeReservation.create({ data: { runId: input.runId, attempt: input.attempt, siloId: input.siloId, namespace: runtime.namespace, deploymentName: command.deploymentName, deploymentUid: command.deploymentUid, podName: command.podName, podUid: command.podUid, podResourceVersion: command.podResourceVersion, genericProfile: command.genericProfile, claimedProfile: command.claimedProfile, serviceAccountName: command.serviceAccountName, state: WarmRuntimeReservationState.Reserved, idleDeadline: expiresAt } });
		const assignment = await this.transaction.workloadAssignment.create({ data: { runId: input.runId, attempt: input.attempt, agentServiceId: task.run.agentServiceId, agentRevisionId: task.run.agentRevisionId, siloId: input.siloId, subjectId: identity.subjectId, audience: runtime.audience, serviceAccountName: command.serviceAccountName, namespace: runtime.namespace, workloadKind: WorkloadKind.Deployment, workloadUid: command.podUid, workloadProfile: command.workloadProfile, podUid: command.podUid, state: WorkloadAssignmentState.PendingPod, expiresAt, createdAt: now } });
		const reference = __AgentRunWorkflowBootstrapReferenceForTask(task);
		await this.transaction.workloadBootstrap.create({ data: { id: reference, runId: input.runId, attempt: input.attempt, agentServiceId: task.run.agentServiceId, agentRevisionId: task.run.agentRevisionId, siloId: input.siloId, subjectId: identity.subjectId, audience: runtime.audience, serviceAccountName: command.serviceAccountName, namespace: runtime.namespace, workloadKind: WorkloadKind.Deployment, workloadUid: command.podUid, claimDigest: __AgentRunWorkflowBootstrapClaimDigest(reference, assignment), expiresAt, createdAt: now } });
		await this.transaction.agentRunWorkflowTask.update({ where: { runId_attempt: { runId: input.runId, attempt: input.attempt } }, data: { assignmentExpiresAt: expiresAt } });
		return "bound";
	}

	/** Saves the exact profile patch result for the reserved Pod. */
	async recordWarmProfileActivation(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt, command: AgentRunWarmRuntimeActivationCommand): Promise<"bound" | "idempotent" | "conflict">
	{
		const reservation = await this._Reservation(input, receipt);
		if (reservation === null || reservation.podUid !== command.podUid || reservation.claimedProfile !== command.profile)
		{
			return "conflict";
		}
		if (reservation.profileActivatedAt !== null)
		{
			return reservation.podResourceVersion === command.resourceVersion ? "idempotent" : "conflict";
		}
		const updated = await this.transaction.warmRuntimeReservation.updateMany({ where: { runId: input.runId, attempt: input.attempt, state: WarmRuntimeReservationState.Reserved, podUid: command.podUid, podResourceVersion: reservation.podResourceVersion }, data: { state: WarmRuntimeReservationState.ProfileActivating, podResourceVersion: command.resourceVersion, profileActivatedAt: new Date() } });
		return updated.count === 1 ? "bound" : "conflict";
	}

	/** Saves readiness while leaving stream authority closed until the Pod binds its proof key. */
	async recordWarmReadiness(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt, command: AgentRunWarmRuntimeReadinessCommand): Promise<"bound" | "idempotent" | "conflict">
	{
		const reservation = await this._Reservation(input, receipt);
		const observedAt = new Date(command.observedAt);
		if (reservation === null || reservation.podUid !== command.podUid || reservation.podResourceVersion !== command.resourceVersion || reservation.claimedProfile !== command.profile || Number.isNaN(observedAt.getTime()))
		{
			return "conflict";
		}
		if (reservation.readinessObservedAt !== null)
		{
			return "idempotent";
		}
		const updated = await this.transaction.warmRuntimeReservation.updateMany({ where: { runId: input.runId, attempt: input.attempt, state: WarmRuntimeReservationState.ProfileActivating, podUid: command.podUid, podResourceVersion: command.resourceVersion }, data: { state: WarmRuntimeReservationState.Ready, readinessObservedAt: observedAt } });
		if (updated.count !== 1)
		{
			return "conflict";
		}
		return "bound";
	}

	/** Records deletion intent before the controller removes the exact Pod. */
	async requestWarmPodDeletion(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt, command: AgentRunWarmRuntimeDeletionCommand): Promise<"bound" | "idempotent" | "conflict">
	{
		const reservation = await this._Reservation(input, receipt);
		if (reservation === null || !_DeletionMatches(reservation, command))
		{
			return "conflict";
		}
		if (reservation.deleteRequestedAt !== null)
		{
			return "idempotent";
		}
		const updated = await this.transaction.warmRuntimeReservation.updateMany({ where: { runId: input.runId, attempt: input.attempt, state: { in: [WarmRuntimeReservationState.Reserved, WarmRuntimeReservationState.ProfileActivating, WarmRuntimeReservationState.Ready, WarmRuntimeReservationState.Claimed] } }, data: { state: WarmRuntimeReservationState.DeleteRequested, deleteRequestedAt: new Date() } });
		return updated.count === 1 ? "bound" : "conflict";
	}

	/** Records successful deletion and revokes assignment and proof-key authority. */
	async recordWarmPodDeleted(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt, command: AgentRunWarmRuntimeDeletionCommand): Promise<AgentRunWarmRuntimeDeletionOutcome>
	{
		const task = await this.taskReader.read(input, receipt);
		if (task === null)
		{
			return "conflict";
		}
		const reservation = await this.transaction.warmRuntimeReservation.findUnique({ where: { runId_attempt: { runId: input.runId, attempt: input.attempt } } });
		if (reservation === null || !_DeletionMatches(reservation, command))
		{
			return "conflict";
		}
		const wasDeleted = reservation.deletedAt !== null;
		const now = new Date();
		if (!wasDeleted)
		{
			const updated = await this.transaction.warmRuntimeReservation.updateMany({ where: { runId: input.runId, attempt: input.attempt, state: WarmRuntimeReservationState.DeleteRequested }, data: { state: WarmRuntimeReservationState.Deleted, deletedAt: now } });
			if (updated.count !== 1)
			{
				return "conflict";
			}
			await this.transaction.workloadAssignment.updateMany({ where: { runId: input.runId, attempt: input.attempt, workloadUid: command.podUid }, data: { state: WorkloadAssignmentState.Revoked, revokedAt: now } });
			await this.transaction.runProofKey.updateMany({ where: { runId: input.runId, attempt: input.attempt, revokedAt: null }, data: { revokedAt: now } });
		}
		if (task.run.state === AgentRunState.Cancelling)
		{
			const cancellation = await __CancelPendingRunApprovalAuthority(this.transaction, { runId: input.runId, attempt: input.attempt, now });
			if (cancellation.activeClaimCount > 0)
			{
				return "deferred";
			}
			await this._FinalizeCancelledRun(task.run, now);
			return "bound";
		}
		return wasDeleted ? "idempotent" : "bound";
	}

	/** Finalizes a cancelled task only after typed reads prove no warm claim was committed. */
	async finalizeCancellationWithoutWarmReservation(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt): Promise<AgentRunWarmRuntimeUnreservedCancellationOutcome>
	{
		const task = await this.taskReader.read(input, receipt);
		if (task === null)
		{
			return "conflict";
		}
		if (task.run.state === AgentRunState.Cancelled)
		{
			return "idempotent";
		}
		if (task.run.state !== AgentRunState.Cancelling)
		{
			return "conflict";
		}
		const reservation = await this.transaction.warmRuntimeReservation.findUnique({ where: { runId_attempt: { runId: input.runId, attempt: input.attempt } } });
		const assignment = await this.transaction.workloadAssignment.findUnique({ where: { runId_attempt: { runId: input.runId, attempt: input.attempt } } });
		if (reservation !== null || assignment !== null)
		{
			return "reservation_exists";
		}
		const now = new Date();
		const cancellation = await __CancelPendingRunApprovalAuthority(this.transaction, { runId: input.runId, attempt: input.attempt, now });
		if (cancellation.activeClaimCount > 0)
		{
			return "deferred";
		}
		await this._FinalizeCancelledRun(task.run, now);
		return "bound";
	}

	/** Records a workflow setup failure without writing the retired Job cleanup outbox. */
	async terminalizeFailedTask(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt): Promise<void>
	{
		const task = await this.taskReader.read(input, receipt);
		if (task === null)
		{
			return;
		}
		await this.transaction.agentRun.updateMany({ where: { id: input.runId, attempt: input.attempt, state: { in: [AgentRunState.Accepted, AgentRunState.Queued, AgentRunState.Assigned, AgentRunState.Running, AgentRunState.WaitingForInput, AgentRunState.RecoveryRequired] } }, data: { state: AgentRunState.Failed, terminalReason: AgentRunTerminalReason.RuntimeFailure, finishedAt: new Date() } });
	}

	/** Reads the current receipt-bound run state. */
	async observe(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt): Promise<AgentRunWorkflowObservation>
	{
		const task = await this.taskReader.read(input, receipt);
		if (task === null || task.run.attempt !== input.attempt)
		{
			return "stale";
		}
		return _Observation(task.run.state);
	}

	/** Returns the reservation only while the task receipt remains current. */
	private async _Reservation(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt)
	{
		const task = await this.taskReader.read(input, receipt);
		if (task === null)
		{
			return null;
		}
		return await this.transaction.warmRuntimeReservation.findUnique({ where: { runId_attempt: { runId: input.runId, attempt: input.attempt } } });
	}

	/** Finalizes cancellation only after no provider output lease remains active. */
	private async _FinalizeCancelledRun(run: AgentRunWorkflowTaskRow["run"], now: Date): Promise<void>
	{
		const finalized = await this.transaction.agentRun.updateMany({ where: { id: run.id, attempt: run.attempt, state: AgentRunState.Cancelling }, data: { state: AgentRunState.Cancelled, terminalReason: AgentRunTerminalReason.UserCancelled, finishedAt: now } });
		if (finalized.count !== 1)
		{
			throw new Error("warm runtime cancellation lost its final state fence");
		}
		await __DeliverChildRunCompletionInTransaction(this.transaction, { childRunId: run.id });
		if (run.conversationId !== null)
		{
			const maximum = await this.transaction.conversationRunEvent.aggregate({ where: { runId: run.id }, _max: { sequence: true } });
			await this.transaction.conversationRunEvent.create({ data: { conversationId: run.conversationId, runId: run.id, sequence: (maximum._max.sequence ?? 0) + 1, type: RunEventTypes.RunCancelled, payload: { terminalReason: "user_cancelled" }, occurredAt: now } });
		}
	}
}

/** Opens serializable transactions for the one-shot warm AgentRun lifecycle. */
export class PrismaAgentRunWarmRuntimeUnitOfWork implements AgentRunWarmRuntimeControllerAuthority
{
	/** Opens transactions against the main product database. */
	private readonly prisma: PrismaClient;
	/** Supplies fixed server runtime settings. */
	private readonly options: AgentRunWorkflowControllerAuthorityOptions;

	/** Creates the authority from application-owned dependencies. */
	constructor(prisma: PrismaClient, options: AgentRunWorkflowControllerAuthorityOptions)
	{
		this.prisma = prisma;
		this.options = options;
	}

	/** Loads current task facts. */
	async loadForTask(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<AgentRunWorkflowControllerRecord | null> { return await this._Run(async function _Load(repository) { return await repository.loadForTask(input, task); }); }
	/** Reserves one generic Pod. */
	async reserveWarmPod(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, command: AgentRunWarmRuntimeReservationCommand): Promise<"bound" | "idempotent" | "conflict"> { return await this._Run(async function _Reserve(repository) { return await repository.reserveWarmPod(input, task, command); }); }
	/** Saves profile activation. */
	async recordWarmProfileActivation(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, command: AgentRunWarmRuntimeActivationCommand): Promise<"bound" | "idempotent" | "conflict"> { return await this._Run(async function _Record(repository) { return await repository.recordWarmProfileActivation(input, task, command); }); }
	/** Saves readiness evidence. */
	async recordWarmReadiness(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, command: AgentRunWarmRuntimeReadinessCommand): Promise<"bound" | "idempotent" | "conflict"> { return await this._Run(async function _Record(repository) { return await repository.recordWarmReadiness(input, task, command); }); }
	/** Saves deletion intent. */
	async requestWarmPodDeletion(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, command: AgentRunWarmRuntimeDeletionCommand): Promise<"bound" | "idempotent" | "conflict"> { return await this._Run(async function _Request(repository) { return await repository.requestWarmPodDeletion(input, task, command); }); }
	/** Saves successful deletion. */
	async recordWarmPodDeleted(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, command: AgentRunWarmRuntimeDeletionCommand): Promise<AgentRunWarmRuntimeDeletionOutcome> { return await this._Run(async function _Record(repository) { return await repository.recordWarmPodDeleted(input, task, command); }); }
	/** Finalizes cancellation only when no warm claim exists. */
	async finalizeCancellationWithoutWarmReservation(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<AgentRunWarmRuntimeUnreservedCancellationOutcome> { return await this._Run(async function _Finalize(repository) { return await repository.finalizeCancellationWithoutWarmReservation(input, task); }); }
	/** Records setup failure. */
	async terminalizeFailedTask(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<void> { await this._Run(async function _Fail(repository) { await repository.terminalizeFailedTask(input, task); }); }
	/** Reads current run state. */
	async observe(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<AgentRunWorkflowObservation> { return await this._Run(async function _Observe(repository) { return await repository.observe(input, task); }); }

	/** Retries expected reservation conflicts under serializable isolation. */
	private async _Run<TResult>(operation: (repository: PrismaAgentRunWarmRuntimeRepository) => Promise<TResult>): Promise<TResult>
	{
		let conflict: Prisma.PrismaClientKnownRequestError | null = null;
		for (let attempt = 1; attempt <= _SERIALIZABLE_ATTEMPTS; attempt += 1)
		{
			try
			{
				const options = this.options;
				return await this.prisma.$transaction(async function _Transaction(transaction): Promise<TResult> { return await operation(new PrismaAgentRunWarmRuntimeRepository(transaction, options)); }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
			}
			catch (error)
			{
				if (!(error instanceof Prisma.PrismaClientKnownRequestError) || (error.code !== "P2002" && error.code !== "P2034"))
				{
					throw error;
				}
				conflict = error;
			}
		}
		throw new Error("warm runtime reservation conflicted after three attempts", { cause: conflict ?? undefined });
	}
}

/** Checks stable fields before they enter the reservation table. */
function _ReservationCommand(command: AgentRunWarmRuntimeReservationCommand, workloadProfile: string): boolean
{
	return command.workloadProfile === workloadProfile && command.genericProfile !== command.claimedProfile && [command.deploymentName, command.deploymentUid, command.podName, command.podUid, command.podResourceVersion, command.genericProfile, command.claimedProfile, command.serviceAccountName].every(function _Bounded(value) { return value.trim().length > 0 && value.length <= 256; });
}

/** Checks whether an existing reservation is the exact replay. */
function _ReservationMatches(reservation: { readonly runId: string; readonly attempt: number; readonly siloId: string; readonly namespace: string; readonly deploymentName: string; readonly deploymentUid: string; readonly podName: string; readonly podUid: string; readonly genericProfile: string; readonly claimedProfile: string; readonly serviceAccountName: string }, command: AgentRunWarmRuntimeReservationCommand, input: AgentRunTaskInput, namespace: string): boolean
{
	return reservation.runId === input.runId && reservation.attempt === input.attempt && reservation.siloId === input.siloId && reservation.namespace === namespace && reservation.deploymentName === command.deploymentName && reservation.deploymentUid === command.deploymentUid && reservation.podName === command.podName && reservation.podUid === command.podUid && reservation.genericProfile === command.genericProfile && reservation.claimedProfile === command.claimedProfile && reservation.serviceAccountName === command.serviceAccountName;
}

/** Checks a deletion command against the persisted one-use Pod identity. */
function _DeletionMatches(reservation: { readonly podName: string; readonly podUid: string; readonly deploymentUid: string; readonly genericProfile: string; readonly claimedProfile: string }, command: AgentRunWarmRuntimeDeletionCommand): boolean
{
	return reservation.podName === command.podName && reservation.podUid === command.podUid && reservation.deploymentUid === command.deploymentUid && (command.profile === reservation.genericProfile || command.profile === reservation.claimedProfile);
}

/** Maps the durable run state to the bounded workflow observation vocabulary. */
function _Observation(state: AgentRunState): AgentRunWorkflowObservation
{
	if (state === AgentRunState.Completed)
	{
		return "completed";
	}
	if (state === AgentRunState.Failed)
	{
		return "failed";
	}
	if (state === AgentRunState.Cancelling)
	{
		return "cancelling";
	}
	if (state === AgentRunState.Cancelled)
	{
		return "cancelled";
	}
	return "running";
}
