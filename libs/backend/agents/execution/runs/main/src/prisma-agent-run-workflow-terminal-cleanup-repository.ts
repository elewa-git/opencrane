import { AgentRunState, AgentRunTerminalReason, RunOutboxEventKind, WorkloadAssignmentState, type Prisma } from "@prisma/client";

import { type AgentRunWorkflowObservation, type AgentRunTaskInput } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import { __DeliverChildRunCompletionInTransaction } from "./prisma-child-run-completion-repository";
import type { AgentRunWorkflowControllerAuthorityOptions, AgentRunWorkflowTerminalCleanupPersistenceRepository } from "./agent-run-workflow-controller-authority.types";
import type { RunWorkloadCleanupProjection } from "./run-cancellation.types";
import { __AgentRunWorkflowBootstrapReferenceForTask, __AgentRunWorkflowRuntimeIdentity, PrismaAgentRunWorkflowTaskReadRepository } from "./prisma-agent-run-workflow-task-read-repository";

/** Names the task row returned by the shared receipt-fenced reader. */
type AgentRunWorkflowTaskRow = NonNullable<Awaited<ReturnType<PrismaAgentRunWorkflowTaskReadRepository["read"]>>>;

/** Owns terminal task cleanup and read-only task outcome classification. */
export class PrismaAgentRunWorkflowTerminalCleanupRepository implements AgentRunWorkflowTerminalCleanupPersistenceRepository
{
	/** Holds the transaction that owns one terminal lifecycle decision. */
	private readonly transaction: Prisma.TransactionClient;
	/** Holds server-selected cleanup timing and runtime identity settings. */
	private readonly options: AgentRunWorkflowControllerAuthorityOptions;
	/** Reads receipt-fenced task facts before terminalising the run. */
	private readonly taskReader: PrismaAgentRunWorkflowTaskReadRepository;

	/** Creates the repository inside the controller unit of work transaction. */
	constructor(transaction: Prisma.TransactionClient, options: AgentRunWorkflowControllerAuthorityOptions)
	{
		this.transaction = transaction;
		this.options = options;
		this.taskReader = new PrismaAgentRunWorkflowTaskReadRepository(this.transaction, options);
	}

	/** Records a direct workflow setup failure and queues receipt-derived cleanup for any created Job. */
	async terminalizeFailedTask(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt): Promise<void>
	{
		const task = await this.taskReader.read(input, receipt);
		if (task === null || task.run.service === null || !_CanTerminalizeTaskFailure(task.run.state))
		{
			return;
		}
		const now = new Date();
		const failed = await this.transaction.agentRun.updateMany({ where: { id: task.run.id, attempt: task.run.attempt, state: { in: [AgentRunState.Accepted, AgentRunState.Queued, AgentRunState.Assigned, AgentRunState.Running, AgentRunState.WaitingForInput, AgentRunState.RecoveryRequired] } }, data: { state: AgentRunState.Failed, terminalReason: AgentRunTerminalReason.RuntimeFailure, finishedAt: now } });
		if (failed.count !== 1)
		{
			return;
		}
		const assignment = await this.transaction.workloadAssignment.findUnique({ where: { runId_attempt: { runId: input.runId, attempt: input.attempt } } });
		await this.transaction.workloadAssignment.updateMany({ where: { runId: input.runId, attempt: input.attempt, state: { in: [WorkloadAssignmentState.PendingPod, WorkloadAssignmentState.Registered] } }, data: { state: WorkloadAssignmentState.Revoked, revokedAt: now } });
		await this.transaction.runProofKey.updateMany({ where: { runId: input.runId, attempt: input.attempt, revokedAt: null }, data: { revokedAt: now } });
		const runtime = __AgentRunWorkflowRuntimeIdentity(task.run.service.kind, this.options);
		const cleanup = _TaskFailureCleanupProjection(task, assignment, runtime.namespace);
		const maximum = await this.transaction.outboxEvent.aggregate({ where: { runId: task.run.id }, _max: { sequence: true } });
		const availableAt = assignment === null ? new Date(now.getTime() + this.options.releaseLeaseMilliseconds + this.options.orphanObservationMarginMilliseconds) : now;
		await this.transaction.outboxEvent.create({ data: { runId: task.run.id, attempt: task.run.attempt, sequence: (maximum._max.sequence ?? 0) + 1, kind: RunOutboxEventKind.RunWorkloadCleanupRequested, idempotencyKey: `${task.run.id}:cleanup:${task.run.attempt}`, payload: cleanup as unknown as Prisma.InputJsonObject, availableAt } });
		await __DeliverChildRunCompletionInTransaction(this.transaction, { childRunId: task.run.id });
		if (task.run.conversationId !== null)
		{
			const conversationMaximum = await this.transaction.conversationRunEvent.aggregate({ where: { runId: task.run.id }, _max: { sequence: true } });
			await this.transaction.conversationRunEvent.create({ data: { conversationId: task.run.conversationId, runId: task.run.id, sequence: (conversationMaximum._max.sequence ?? 0) + 1, type: "run.failed", payload: { terminalReason: "runtime_failure", failureCode: "RUN_WORKFLOW_TERMINAL_FAILURE" }, occurredAt: now } });
		}
	}

	/** Returns the current task result without creating a workload or changing AgentRun state. */
	async observe(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt): Promise<AgentRunWorkflowObservation>
	{
		const task = await this.taskReader.read(input, receipt);
		if (task === null || task.run.id !== input.runId || task.run.siloId !== input.siloId || task.run.attempt !== input.attempt)
		{
			return "stale";
		}
		if (task.run.state === AgentRunState.Completed)
		{
			return "completed";
		}
		if (task.run.state === AgentRunState.Failed)
		{
			return "failed";
		}
		if (task.run.state === AgentRunState.Cancelled || task.run.state === AgentRunState.Cancelling)
		{
			return "cancelled";
		}
		return "running";
	}
}

/** Returns whether this task may turn its current run into a terminal setup failure. */
function _CanTerminalizeTaskFailure(state: AgentRunState): boolean
{
	return state === AgentRunState.Accepted || state === AgentRunState.Queued || state === AgentRunState.Assigned || state === AgentRunState.Running || state === AgentRunState.WaitingForInput || state === AgentRunState.RecoveryRequired;
}

/** Builds cleanup from the saved receipt that may have created a Job before recording failure. */
function _TaskFailureCleanupProjection(task: AgentRunWorkflowTaskRow, assignment: { readonly namespace: string; readonly workloadProfile: string; readonly workloadUid: string } | null, namespace: string): RunWorkloadCleanupProjection
{
	return { runId: task.runId, attempt: task.attempt, siloId: task.siloId, agentServiceId: task.run.agentServiceId, agentRevisionId: task.run.agentRevisionId, namespace: assignment?.namespace ?? namespace, workloadProfile: assignment?.workloadProfile ?? task.run.service!.workloadProfile, bootstrapReference: __AgentRunWorkflowBootstrapReferenceForTask(task), workloadUid: assignment?.workloadUid ?? null, mode: assignment === null ? "unassigned_orphan" : "assigned", reason: "workflow_terminal_failure", orphanAbsenceObservedAt: null };
}
