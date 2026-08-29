import { AgentRunState, Prisma, WorkloadAssignmentState, type PrismaClient } from "@prisma/client";

import { __CancelPendingRunApprovalAuthority } from "@opencrane/backend/server/iam/authorization";

import { PrismaAgentRunWorkflowTaskRepository } from "./prisma-agent-run-workflow-task-repository";
import type { RequestRunCancellationCommand, RequestRunCancellationResult, RunCancellationPersistenceRepository, RunCancellationRepository } from "./run-cancellation.types";

/**
 * Owns the Serializable database transaction for an AgentRun cancellation.
 *
 * The run fence, workload and proof-key revocations, and pending approval cancellation commit or
 * roll back together. A request returns `cancelling` when accepted, `idempotent`
 * when the attempt is already cancelling or cancelled, `not_found` for a missing run, or `conflict`
 * when the command or saved authority does not permit the change.
 *
 * Called by: `apps/opencrane/src/app/run-cancellation-composition.ts`, which supplies this authority
 * to the public self-run cancellation route.
 *
 * @see RunCancellationRepository for the boundary exposed to route composition.
 */
export class PrismaRunCancellationUnitOfWork implements RunCancellationRepository
{
	/** Provides the OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient;
	/** Provides one application timestamp for each serializable operation. */
	private readonly now: () => Date;

	/** Creates cancellation authority over the OpenCrane product database. */
	constructor(prisma: PrismaClient, now: () => Date = function _Now() { return new Date(); })
	{
		this.prisma = prisma;
		this.now = now;
	}

	/**
	 * Fences the current attempt and records workflow-owned finalization work.
	 *
	 * @param command - Run and expected attempt already authorized by the caller.
	 * @returns The accepted, repeated, missing, or refused cancellation outcome.
	 * @throws When Prisma cannot complete the transaction or the lifecycle compare-and-set loses its fence.
	 */
	async requestCancellationAtomically(command: RequestRunCancellationCommand): Promise<RequestRunCancellationResult>
	{
		if (!_CancellationCommandIsValid(command))
			return { status: "conflict", reason: "invalid_request" };
		const now = this.now();
		return this.prisma.$transaction(async function _Cancel(transaction)
		{
			return await new PrismaRunCancellationRepository(transaction).requestCancellation(command, now);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}

/** Persists one cancellation request inside a caller-owned serializable transaction. */
class PrismaRunCancellationRepository implements RunCancellationPersistenceRepository
{
	/** Provides the transaction that owns every run, credential, approval, and workflow fence. */
	private readonly transaction: Prisma.TransactionClient;

	/** Binds this repository to the unit of work's transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Revokes the current attempt so its workflow can finish cancellation. */
	async requestCancellation(command: RequestRunCancellationCommand, now: Date): Promise<RequestRunCancellationResult>
	{
		const run = await this.transaction.agentRun.findUnique({ where: { id: command.runId } });
		if (run === null)
			return { status: "not_found" };
		if (run.attempt !== command.expectedAttempt)
			return { status: "conflict", reason: "attempt_conflict" };
		if (run.state === AgentRunState.Cancelling || run.state === AgentRunState.Cancelled)
		{
			return { status: "idempotent", runId: run.id, attempt: run.attempt, state: run.state === AgentRunState.Cancelling ? "cancelling" : "cancelled" };
		}
		if (run.state === AgentRunState.Completed || run.state === AgentRunState.Failed)
			return { status: "conflict", reason: "terminal_run" };
		const task = await PrismaAgentRunWorkflowTaskRepository.__ReadBoundTask(this.transaction, run.id, run.attempt);
		if (task === null || task.taskId === null || task.runId !== run.id || task.attempt !== run.attempt || task.siloId !== run.siloId)
			return { status: "conflict", reason: "authority_conflict" };

		const entered = await this.transaction.agentRun.updateMany({ where: { id: run.id, attempt: run.attempt, state: run.state }, data: { state: AgentRunState.Cancelling } });
		if (entered.count !== 1)
			throw new Error("run cancellation lost its lifecycle fence");
		await this.transaction.workloadAssignment.updateMany({ where: { runId: run.id, attempt: run.attempt, state: { in: [WorkloadAssignmentState.PendingPod, WorkloadAssignmentState.Registered] } }, data: { state: WorkloadAssignmentState.Revoked, revokedAt: now } });
		await this.transaction.runProofKey.updateMany({ where: { runId: run.id, attempt: run.attempt, revokedAt: null }, data: { revokedAt: now } });
		await __CancelPendingRunApprovalAuthority(this.transaction, { runId: run.id, attempt: run.attempt, now });
		return { status: "cancelling", runId: run.id, attempt: run.attempt };
	}
}

/** Reject malformed cancellation coordinates before opening a transaction. */
function _CancellationCommandIsValid(command: RequestRunCancellationCommand): boolean
{
	return command.runId.length > 0 && command.runId.length <= 256 && Number.isSafeInteger(command.expectedAttempt) && command.expectedAttempt > 0;
}
