import { AgentRunState, Prisma, WorkloadAssignmentState, type PrismaClient } from "@prisma/client";

import { __CancelPendingRunApprovalAuthority } from "@opencrane/backend/server/iam/authorization";
import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { PrismaAgentRunWorkflowTaskRepository } from "./prisma-agent-run-workflow-task-repository";
import type { RequestRunCancellationCommand, RequestRunCancellationResult, RunCancellationPersistenceRepository, RunCancellationRepository } from "./run-cancellation.types";
import { SelfRunCancellationOutcomes, type SelfRunCancellationCommand, type SelfRunCancellationRepository, type SelfRunCancellationResult } from "./self-run-cancellation.types";

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
export class PrismaRunCancellationUnitOfWork implements RunCancellationRepository, SelfRunCancellationRepository
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
		return this._Run(function _Cancel(repository) { return repository.requestCancellation(command, now); });
	}

	/** Authorizes and fences one owner-visible run inside the same serializable transaction. */
	async requestOwned(command: SelfRunCancellationCommand): Promise<SelfRunCancellationResult>
	{
		if (!_CancellationCommandIsValid({ runId: command.runId, expectedAttempt: command.expectedAttempt }))
		{
			return { outcome: SelfRunCancellationOutcomes.InvalidRequest };
		}
		const now = this.now();
		return this._Run(function _CancelOwned(repository) { return repository.requestOwned(command, now); });
	}

	/** Binds one cancellation operation to a fresh serializable transaction and central authority. */
	private _Run<Result>(operation: (repository: PrismaRunCancellationRepository) => Promise<Result>): Promise<Result>
	{
		return this.prisma.$transaction(async function _Run(transaction)
		{
			const authorization = new PrismaAuthorizationAuthority(transaction);
			const repository = new PrismaRunCancellationRepository(transaction, authorization);
			return operation(repository);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}

/** Persists one cancellation request inside a caller-owned serializable transaction. */
export class PrismaRunCancellationRepository implements RunCancellationPersistenceRepository
{
	/** Provides the transaction that owns every run, credential, approval, and workflow fence. */
	private readonly transaction: Prisma.TransactionClient;
	/** Central product authority bound to the same transaction. */
	private readonly authorization: Pick<AuthorizationAuthority, "admitPrincipal">;

	/** Binds this repository to the unit of work's transaction. */
	constructor(transaction: Prisma.TransactionClient, authorization: Pick<AuthorizationAuthority, "admitPrincipal">)
	{
		this.transaction = transaction;
		this.authorization = authorization;
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

	/** Hides foreign runs, then admits and applies one cancellation in this transaction. */
	async requestOwned(command: SelfRunCancellationCommand, now: Date): Promise<SelfRunCancellationResult>
	{
		const owned = await this.transaction.agentRun.findFirst({ where: { id: command.runId, siloId: command.siloId, principalId: { equals: command.principalId } }, select: { id: true } });
		if (owned === null)
		{
			return { outcome: SelfRunCancellationOutcomes.NotFound };
		}
		const argumentsValue = { runId: owned.id, expectedAttempt: command.expectedAttempt };
		const admission = await this.authorization.admitPrincipal({ siloId: command.siloId, principalId: command.principalId, actorKind: "user", actorId: command.principalId, resource: { kind: ProductAuthorizationResourceKinds.AgentRun, id: owned.id }, action: ProductAuthorizationActions.Cancel, argumentsDigest: ___DigestCanonicalJson(argumentsValue as JsonValue), nowEpochMs: now.getTime() });
		if (admission.outcome !== AuthorizationDecisionOutcomes.Allow)
		{
			return { outcome: SelfRunCancellationOutcomes.NotFound };
		}
		const result = await this.requestCancellation({ runId: owned.id, expectedAttempt: command.expectedAttempt }, now);
		return _MapOwnedCancellationResult(result);
	}
}

/** Translates the shared cancellation result into the owner-facing vocabulary. */
function _MapOwnedCancellationResult(result: RequestRunCancellationResult): SelfRunCancellationResult
{
	if (result.status === "cancelling")
	{
		return { outcome: SelfRunCancellationOutcomes.Cancelling, runId: result.runId, attempt: result.attempt };
	}
	if (result.status === "idempotent")
	{
		const outcome = result.state === "cancelling" ? SelfRunCancellationOutcomes.Cancelling : SelfRunCancellationOutcomes.Cancelled;
		return { outcome, runId: result.runId, attempt: result.attempt };
	}
	if (result.status === "not_found")
	{
		return { outcome: SelfRunCancellationOutcomes.NotFound };
	}
	if (result.reason === "attempt_conflict")
	{
		return { outcome: SelfRunCancellationOutcomes.AttemptConflict };
	}
	if (result.reason === "terminal_run")
	{
		return { outcome: SelfRunCancellationOutcomes.TerminalRun };
	}
	if (result.reason === "invalid_request")
	{
		return { outcome: SelfRunCancellationOutcomes.InvalidRequest };
	}
	return { outcome: SelfRunCancellationOutcomes.AuthorityConflict };
}

/** Reject malformed cancellation coordinates before opening a transaction. */
function _CancellationCommandIsValid(command: RequestRunCancellationCommand): boolean
{
	return command.runId.length > 0 && command.runId.length <= 256 && Number.isSafeInteger(command.expectedAttempt) && command.expectedAttempt > 0;
}
