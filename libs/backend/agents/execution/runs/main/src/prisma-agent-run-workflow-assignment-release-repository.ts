import { AgentRunState, WorkloadAssignmentState, WorkloadKind, type Prisma, type WorkloadAssignment } from "@prisma/client";

import { ___IsAgentRuntimeServiceAccountName, ___IsManagedAgentRuntimeServiceAccountName } from "@opencrane/contracts";
import type { AgentRunWorkflowAssignmentCommand, AgentRunWorkflowControllerRecord, AgentRunWorkflowPodCommand, AgentRunWorkflowReleaseClaim, AgentRunTaskInput } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import type { AgentRunWorkflowAssignmentReleasePersistenceRepository, AgentRunWorkflowControllerAuthorityOptions } from "./agent-run-workflow-controller-authority.types";
import { __AgentRunWorkflowBootstrapClaimDigest, __AgentRunWorkflowBootstrapReferenceForTask, __AgentRunWorkflowRuntimeIdentity, __CanCreateOrObserveAgentRunWorkflowTask, __CurrentAgentRunWorkflowTask, PrismaAgentRunWorkflowTaskReadRepository } from "./prisma-agent-run-workflow-task-read-repository";
import type { AgentRunWorkflowSnapshotIdentity } from "./prisma-agent-run-workflow-task-read-repository.types";

/** Names the task row returned by the shared receipt-fenced reader. */
type AgentRunWorkflowTaskRow = NonNullable<Awaited<ReturnType<PrismaAgentRunWorkflowTaskReadRepository["read"]>>>;

/** Owns exact Job assignment, first-Pod binding, and release fences for a receipt-bound task. */
export class PrismaAgentRunWorkflowAssignmentReleaseRepository implements AgentRunWorkflowAssignmentReleasePersistenceRepository
{
	/** Holds the transaction that owns one assignment or release decision. */
	private readonly transaction: Prisma.TransactionClient;
	/** Holds server-owned namespaces and time limits. */
	private readonly options: AgentRunWorkflowControllerAuthorityOptions;
	/** Reads receipt-fenced task facts for every command. */
	private readonly taskReader: PrismaAgentRunWorkflowTaskReadRepository;

	/** Creates the repository inside the transaction supplied by the controller unit of work. */
	constructor(transaction: Prisma.TransactionClient, options: AgentRunWorkflowControllerAuthorityOptions)
	{
		this.transaction = transaction;
		this.options = options;
		this.taskReader = new PrismaAgentRunWorkflowTaskReadRepository(this.transaction, options);
	}

	/** Returns the current Job record before the handler creates or adopts its suspended Job. */
	async loadForTask(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt): Promise<AgentRunWorkflowControllerRecord | null>
	{
		const task = await this.taskReader.read(input, receipt);
		const identity = task === null ? null : __CurrentAgentRunWorkflowTask(task, input);
		if (task === null || identity === null || !__CanCreateOrObserveAgentRunWorkflowTask(task.run.state))
		{
			return null;
		}
		const runtime = __AgentRunWorkflowRuntimeIdentity(task.run.service!.kind, this.options);
		const assignment = await this.transaction.workloadAssignment.findUnique({ where: { runId_attempt: { runId: input.runId, attempt: input.attempt } } });
		const assignmentExpiresAt = assignment === null ? new Date(Math.min(Date.now() + this.options.assignmentTtlMilliseconds, identity.trustedUntil.getTime())) : _PersistedAssignmentExpiry(task, assignment, runtime);
		if (assignmentExpiresAt === null)
		{
			return null;
		}
		return { runId: input.runId, attempt: input.attempt, siloId: input.siloId, agentServiceId: task.run.agentServiceId, agentRevisionId: task.run.agentRevisionId, workloadProfile: task.run.service!.workloadProfile, namespace: runtime.namespace, bootstrapReference: __AgentRunWorkflowBootstrapReferenceForTask(task), assignmentExpiresAt: assignmentExpiresAt.toISOString() };
	}

	/** Saves a suspended Job assignment, or proves that a retry repeated its immutable identity. */
	async bindAssignment(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt, command: AgentRunWorkflowAssignmentCommand): Promise<"bound" | "idempotent" | "conflict">
	{
		if (!_AssignmentCommandIsValid(command))
		{
			return "conflict";
		}
		const task = await this.taskReader.read(input, receipt);
		const identity = task === null ? null : __CurrentAgentRunWorkflowTask(task, input);
		if (task === null || identity === null || task.run.service === null)
		{
			return "conflict";
		}
		const runtime = __AgentRunWorkflowRuntimeIdentity(task.run.service.kind, this.options);
		if (command.workloadProfile !== task.run.service.workloadProfile || !runtime.isServiceAccount(command.serviceAccountName))
		{
			return "conflict";
		}
		const existing = await this.transaction.workloadAssignment.findUnique({ where: { runId_attempt: { runId: input.runId, attempt: input.attempt } } });
		const reference = __AgentRunWorkflowBootstrapReferenceForTask(task);
		if (existing !== null)
		{
			const bootstrap = await this.transaction.workloadBootstrap.findUnique({ where: { id: reference } });
			return _AssignmentMatches(existing, bootstrap, task, identity, runtime, command, reference) ? "idempotent" : "conflict";
		}
		if (task.assignmentExpiresAt !== null || (task.run.state !== AgentRunState.Accepted && task.run.state !== AgentRunState.Queued))
		{
			return "conflict";
		}
		const now = new Date();
		if (task.run.state === AgentRunState.Accepted)
		{
			const queued = await this.transaction.agentRun.updateMany({ where: { id: input.runId, attempt: input.attempt, state: AgentRunState.Accepted }, data: { state: AgentRunState.Queued } });
			if (queued.count !== 1)
			{
				throw new Error("AgentRun workflow assignment lost its accepted-to-queued transition.");
			}
		}
		const assigned = await this.transaction.agentRun.updateMany({ where: { id: input.runId, attempt: input.attempt, state: AgentRunState.Queued }, data: { state: AgentRunState.Assigned } });
		if (assigned.count !== 1)
		{
			throw new Error("AgentRun workflow assignment lost its queued-to-assigned transition.");
		}
		const expiresAt = new Date(Math.min(now.getTime() + this.options.assignmentTtlMilliseconds, identity.trustedUntil.getTime()));
		const assignment = await this.transaction.workloadAssignment.create({ data: { runId: input.runId, attempt: input.attempt, agentServiceId: task.run.agentServiceId, agentRevisionId: task.run.agentRevisionId, siloId: input.siloId, subjectId: identity.subjectId, audience: runtime.audience, serviceAccountName: command.serviceAccountName, namespace: runtime.namespace, workloadKind: WorkloadKind.Job, workloadUid: command.workloadUid, workloadProfile: command.workloadProfile, state: WorkloadAssignmentState.PendingPod, expiresAt, createdAt: now } });
		await this.transaction.workloadBootstrap.create({ data: { id: reference, runId: input.runId, attempt: input.attempt, agentServiceId: task.run.agentServiceId, agentRevisionId: task.run.agentRevisionId, siloId: input.siloId, subjectId: identity.subjectId, audience: runtime.audience, serviceAccountName: command.serviceAccountName, namespace: runtime.namespace, workloadKind: WorkloadKind.Job, workloadUid: command.workloadUid, claimDigest: __AgentRunWorkflowBootstrapClaimDigest(reference, assignment), expiresAt, createdAt: now } });
		const saved = await this.transaction.agentRunWorkflowTask.updateMany({ where: { runId: input.runId, attempt: input.attempt, siloId: input.siloId, taskId: receipt.taskId, taskName: receipt.taskName, taskKey: receipt.idempotencyKey, assignmentExpiresAt: null }, data: { assignmentExpiresAt: expiresAt } });
		if (saved.count !== 1)
		{
			throw new Error("AgentRun workflow assignment lost its task expiry fence.");
		}
		return "bound";
	}

	/** Saves the first exact Pod identity after release, or rejects a different Pod. */
	async bindFirstPod(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt, command: AgentRunWorkflowPodCommand): Promise<"bound" | "idempotent" | "conflict">
	{
		if (!_PodCommandIsValid(command))
		{
			return "conflict";
		}
		const task = await this.taskReader.read(input, receipt);
		if (task === null || __CurrentAgentRunWorkflowTask(task, input) === null || task.run.state !== AgentRunState.Assigned)
		{
			return "conflict";
		}
		const assignment = await this.transaction.workloadAssignment.findUnique({ where: { runId_attempt: { runId: input.runId, attempt: input.attempt } } });
		if (assignment === null || assignment.workloadUid !== command.workloadUid || assignment.expiresAt.getTime() <= Date.now())
		{
			return "conflict";
		}
		if (assignment.podUid !== null)
		{
			return assignment.podUid === command.podUid ? "idempotent" : "conflict";
		}
		if (assignment.state !== WorkloadAssignmentState.PendingPod)
		{
			return "conflict";
		}
		const updated = await this.transaction.workloadAssignment.updateMany({ where: { runId: input.runId, attempt: input.attempt, workloadUid: command.workloadUid, state: WorkloadAssignmentState.PendingPod, podUid: null }, data: { state: WorkloadAssignmentState.Registered, podUid: command.podUid, registeredAt: new Date() } });
		return updated.count === 1 ? "bound" : "conflict";
	}

	/** Claims the task-owned release fence before Kubernetes unsuspends the saved Job. */
	async claimRelease(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt, workloadUid: string): Promise<AgentRunWorkflowReleaseClaim | null>
	{
		const task = await this.taskReader.read(input, receipt);
		if (task === null || __CurrentAgentRunWorkflowTask(task, input) === null || task.run.state !== AgentRunState.Assigned)
		{
			return null;
		}
		const assignment = await this.transaction.workloadAssignment.findUnique({ where: { runId_attempt: { runId: input.runId, attempt: input.attempt } } });
		const bootstrap = await this.transaction.workloadBootstrap.findUnique({ where: { id: __AgentRunWorkflowBootstrapReferenceForTask(task) } });
		if (assignment === null || bootstrap === null || assignment.workloadUid !== workloadUid || assignment.state !== WorkloadAssignmentState.PendingPod || assignment.podUid !== null || assignment.expiresAt.getTime() <= Date.now() || bootstrap.expiresAt.getTime() <= Date.now() || task.assignmentExpiresAt === null || task.assignmentExpiresAt.getTime() !== assignment.expiresAt.getTime())
		{
			return null;
		}
		const now = new Date();
		if (task.releaseExpiresAt !== null && task.releaseExpiresAt.getTime() > now.getTime())
		{
			return { expiresAt: task.releaseExpiresAt.toISOString() };
		}
		const claimedAt = new Date(Math.max(now.getTime(), (task.releaseClaimedAt?.getTime() ?? -1) + 1));
		const expiresAt = new Date(Math.min(claimedAt.getTime() + this.options.releaseLeaseMilliseconds, assignment.expiresAt.getTime(), bootstrap.expiresAt.getTime()));
		const claimed = await this.transaction.agentRunWorkflowTask.updateMany({ where: { runId: input.runId, attempt: input.attempt, siloId: input.siloId, taskId: receipt.taskId, taskName: receipt.taskName, taskKey: receipt.idempotencyKey, assignmentExpiresAt: task.assignmentExpiresAt, releaseClaimedAt: task.releaseClaimedAt, releaseExpiresAt: task.releaseExpiresAt, releaseDeliveryCount: task.releaseDeliveryCount }, data: { releaseClaimedAt: claimedAt, releaseExpiresAt: expiresAt, releaseDeliveryCount: task.releaseDeliveryCount + 1 } });
		return claimed.count === 1 ? { expiresAt: expiresAt.toISOString() } : null;
	}
}

/** Rejects values that cannot be stable Kubernetes identities. */
function _AssignmentCommandIsValid(command: AgentRunWorkflowAssignmentCommand): boolean
{
	return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(command.workloadUid) && command.workloadProfile.trim().length > 0 && command.workloadProfile.length <= 128 && (___IsAgentRuntimeServiceAccountName(command.serviceAccountName) || ___IsManagedAgentRuntimeServiceAccountName(command.serviceAccountName));
}

/** Rejects values that cannot be immutable Kubernetes Pod identities. */
function _PodCommandIsValid(command: AgentRunWorkflowPodCommand): boolean
{
	return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(command.workloadUid) && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(command.podUid);
}

/** Compares an existing assignment and bootstrap against every immutable replay field. */
function _AssignmentMatches(assignment: WorkloadAssignment, bootstrap: { readonly id: string; readonly claimDigest: string; readonly expiresAt: Date; readonly createdAt: Date; readonly workloadUid: string } | null, task: AgentRunWorkflowTaskRow, identity: AgentRunWorkflowSnapshotIdentity, runtime: ReturnType<typeof __AgentRunWorkflowRuntimeIdentity>, command: AgentRunWorkflowAssignmentCommand, reference: string): boolean
{
	return assignment.runId === task.runId && assignment.attempt === task.attempt && assignment.agentServiceId === task.run.agentServiceId && assignment.agentRevisionId === task.run.agentRevisionId && assignment.siloId === task.siloId && assignment.subjectId === identity.subjectId && assignment.audience === runtime.audience && assignment.serviceAccountName === command.serviceAccountName && assignment.namespace === runtime.namespace && assignment.workloadKind === WorkloadKind.Job && assignment.workloadUid === command.workloadUid && assignment.workloadProfile === command.workloadProfile && bootstrap !== null && bootstrap.id === reference && bootstrap.workloadUid === assignment.workloadUid && bootstrap.expiresAt.getTime() === assignment.expiresAt.getTime() && bootstrap.createdAt.getTime() === assignment.createdAt.getTime() && bootstrap.claimDigest === __AgentRunWorkflowBootstrapClaimDigest(reference, assignment) && task.assignmentExpiresAt !== null && task.assignmentExpiresAt.getTime() === assignment.expiresAt.getTime();
}

/** Returns the saved expiry only when the existing assignment still fits the selected runtime profile. */
function _PersistedAssignmentExpiry(task: AgentRunWorkflowTaskRow, assignment: WorkloadAssignment, runtime: ReturnType<typeof __AgentRunWorkflowRuntimeIdentity>): Date | null
{
	if (task.assignmentExpiresAt === null || task.assignmentExpiresAt.getTime() !== assignment.expiresAt.getTime())
	{
		return null;
	}
	if (assignment.runId !== task.runId || assignment.attempt !== task.attempt || assignment.agentServiceId !== task.run.agentServiceId || assignment.agentRevisionId !== task.run.agentRevisionId || assignment.siloId !== task.siloId || assignment.namespace !== runtime.namespace || assignment.workloadProfile !== task.run.service?.workloadProfile || assignment.workloadKind !== WorkloadKind.Job)
	{
		return null;
	}
	return task.assignmentExpiresAt;
}
