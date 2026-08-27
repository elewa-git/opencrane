import { createHash } from "node:crypto";

import { AgentRunState, AgentServiceKind, AgentServiceState, WorkloadKind, type Prisma, type WorkloadAssignment } from "@prisma/client";

import { AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, RunInputSnapshotIdentityKinds, ___IsAgentRuntimeServiceAccountName, ___IsManagedAgentRuntimeServiceAccountName } from "@opencrane/contracts";
import { AgentRunTaskNames, type AgentRunTaskInput } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import { _BuildRunAttemptCredentialMintInputs } from "./run-attempt-credential-minting";
import { __AgentRunWorkflowBootstrapReference } from "./agent-run-workflow-bootstrap-reference";
import type { AttemptModelKeyMintRequest } from "./attempt-model-key.types";
import type { AgentRunWorkflowControllerAuthorityOptions, AgentRunWorkflowTaskReadPersistenceRepository } from "./agent-run-workflow-controller-authority.types";

/** Selects the saved task, current run, active service, and frozen snapshot for controller reads. */
export const __AGENT_RUN_WORKFLOW_TASK_SELECT = {
	runId: true,
	attempt: true,
	siloId: true,
	taskId: true,
	taskKey: true,
	taskName: true,
	assignmentExpiresAt: true,
	releaseClaimedAt: true,
	releaseExpiresAt: true,
	releaseDeliveryCount: true,
	attemptKeyDigest: true,
	run: {
		select: {
			id: true,
			siloId: true,
			attempt: true,
			state: true,
			agentServiceId: true,
			agentRevisionId: true,
			inputSnapshotDigest: true,
			effectiveContractDigest: true,
			conversationId: true,
			service: { select: { id: true, siloId: true, kind: true, state: true, activeRevisionId: true, workloadProfile: true } },
			inputSnapshot: { select: { runId: true, siloId: true, agentServiceId: true, agentRevisionId: true, effectiveContractDigest: true, conversationId: true, digest: true, identitySnapshot: true, modelRoute: true, budgetPolicy: true } },
		},
	},
} as const satisfies Prisma.AgentRunWorkflowTaskSelect;

/** Holds the durable task facts protected by the task receipt fence. */
export type AgentRunWorkflowTaskRow = Prisma.AgentRunWorkflowTaskGetPayload<{ readonly select: typeof __AGENT_RUN_WORKFLOW_TASK_SELECT }>;

/** Holds frozen identity evidence that chooses the task's runtime workload class. */
export interface AgentRunWorkflowSnapshotIdentity
{
	/** Identifies the person or managed service that owns this run. */
	readonly subjectId: string;
	/** Identifies the managed service, or is null for a personal run. */
	readonly managedServiceId: string | null;
	/** Limits how long the snapshot remains valid for workload assignment. */
	readonly trustedUntil: Date;
}

/** Reads receipt-fenced task facts and derives non-secret credentials after its transaction commits. */
export class PrismaAgentRunWorkflowTaskReadRepository implements AgentRunWorkflowTaskReadPersistenceRepository
{
	/** Holds the transaction that reads one controller task. */
	private readonly transaction: Prisma.TransactionClient;
	/** Holds server-selected task lifetimes. */
	private readonly options: AgentRunWorkflowControllerAuthorityOptions;

	/** Creates the task reader inside the caller-owned transaction. */
	constructor(transaction: Prisma.TransactionClient, options: AgentRunWorkflowControllerAuthorityOptions)
	{
		this.transaction = transaction;
		this.options = options;
	}

	/** Reloads the exact saved task row, or returns null when a retry or another controller replaced it. */
	async read(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt): Promise<AgentRunWorkflowTaskRow | null>
	{
		const task = await this.transaction.agentRunWorkflowTask.findUnique({ where: { runId_attempt: { runId: input.runId, attempt: input.attempt } }, select: __AGENT_RUN_WORKFLOW_TASK_SELECT });
		if (task === null || !__AgentRunWorkflowTaskMatches(task, input, receipt))
		{
			return null;
		}
		return task;
	}

	/** Builds the task's stable non-secret mint request without calling the issuer in this transaction. */
	async loadAttemptKeyMintRequest(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt): Promise<AttemptModelKeyMintRequest | null>
	{
		const task = await this.read(input, receipt);
		if (task === null || __CurrentAgentRunWorkflowTask(task, input) === null || !__CanCreateOrObserveAgentRunWorkflowTask(task.run.state) || task.run.inputSnapshot === null)
		{
			return null;
		}
		const credentials = _BuildRunAttemptCredentialMintInputs({ modelRoute: task.run.inputSnapshot.modelRoute, budgetPolicy: task.run.inputSnapshot.budgetPolicy, runId: input.runId, attempt: input.attempt, siloId: input.siloId, deliveryCount: 0, assignmentTtlMilliseconds: this.options.assignmentTtlMilliseconds });
		if (credentials === null)
		{
			return null;
		}
		return { keyAlias: credentials.keyAlias, modelAlias: credentials.modelAlias, siloId: input.siloId, maxBudgetUsd: credentials.maxBudgetUsd, expirySeconds: credentials.expirySeconds };
	}

	/** Saves only the non-secret digest of a raw key while this task still owns the attempt. */
	async recordAttemptKeyDigest(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt, keyDigest: string): Promise<boolean>
	{
		const task = await this.read(input, receipt);
		if (task === null || __CurrentAgentRunWorkflowTask(task, input) === null || !__CanCreateOrObserveAgentRunWorkflowTask(task.run.state))
		{
			return false;
		}
		const updated = await this.transaction.agentRunWorkflowTask.updateMany({ where: { runId: input.runId, attempt: input.attempt, taskId: receipt.taskId, taskKey: receipt.idempotencyKey, taskName: AgentRunTaskNames.Execute }, data: { attemptKeyDigest: keyDigest } });
		return updated.count === 1;
	}

	/** Proves one raw key belongs to this task before the caller sends it to the model gateway for revocation. */
	async verifyAttemptKeyDigest(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt, keyAlias: string, keyDigest: string): Promise<boolean>
	{
		const task = await this.read(input, receipt);
		if (task === null || __CurrentAgentRunWorkflowTask(task, input) === null || !__CanCreateOrObserveAgentRunWorkflowTask(task.run.state) || task.attemptKeyDigest !== keyDigest)
		{
			return false;
		}
		const request = await this.loadAttemptKeyMintRequest(input, receipt);
		return request !== null && request.keyAlias === keyAlias;
	}
}

/** Builds the opaque bootstrap reference from immutable task and run identity. */
export function __AgentRunWorkflowBootstrapReferenceForTask(task: AgentRunWorkflowTaskRow): string
{
	if (task.taskId === null)
	{
		throw new Error("AgentRun workflow bootstrap requires a bound task receipt.");
	}
	return __AgentRunWorkflowBootstrapReference({ taskId: task.taskId, runId: task.runId, attempt: task.attempt, siloId: task.siloId, agentServiceId: task.run.agentServiceId, agentRevisionId: task.run.agentRevisionId, inputSnapshotDigest: task.run.inputSnapshotDigest });
}

/** Digests immutable assignment fields so a bootstrap reference cannot move to another Job. */
export function __AgentRunWorkflowBootstrapClaimDigest(reference: string, assignment: WorkloadAssignment): string
{
	const canonical = JSON.stringify(["opencrane-workload-bootstrap-integrity-v1", reference, assignment.runId, assignment.attempt, assignment.agentServiceId, assignment.agentRevisionId, assignment.siloId, assignment.subjectId, assignment.audience, assignment.serviceAccountName, assignment.namespace, assignment.workloadKind, assignment.workloadUid, assignment.workloadProfile, assignment.expiresAt.toISOString(), assignment.createdAt.toISOString()]);
	return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

/** Confirms that this task, receipt, run, and attempt still name one durable controller operation. */
export function __AgentRunWorkflowTaskMatches(task: AgentRunWorkflowTaskRow, input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt): boolean
{
	return task.runId === input.runId && task.attempt === input.attempt && task.siloId === input.siloId && task.taskId === receipt.taskId && task.taskName === AgentRunTaskNames.Execute && receipt.taskName === AgentRunTaskNames.Execute && task.taskKey === receipt.idempotencyKey;
}

/** Rechecks the active service and frozen identity before a task may create or observe its workload. */
export function __CurrentAgentRunWorkflowTask(task: AgentRunWorkflowTaskRow, input: AgentRunTaskInput): AgentRunWorkflowSnapshotIdentity | null
{
	const run = task.run;
	const service = run.service;
	const snapshot = run.inputSnapshot;
	if (!__AgentRunWorkflowInputMatchesRun(input, run) || service === null || snapshot === null)
	{
		return null;
	}
	if (service.id !== run.agentServiceId || service.siloId !== run.siloId || service.state !== AgentServiceState.Active || service.activeRevisionId !== run.agentRevisionId || snapshot.runId !== run.id || snapshot.siloId !== run.siloId || snapshot.agentServiceId !== run.agentServiceId || snapshot.agentRevisionId !== run.agentRevisionId || snapshot.effectiveContractDigest !== run.effectiveContractDigest || snapshot.conversationId !== run.conversationId || snapshot.digest !== run.inputSnapshotDigest)
	{
		return null;
	}
	const identity = _SnapshotIdentity(snapshot.identitySnapshot);
	if (identity === null || identity.trustedUntil.getTime() <= Date.now())
	{
		return null;
	}
	if (service.kind === AgentServiceKind.Personal && identity.managedServiceId === null)
	{
		return identity;
	}
	if (service.kind === AgentServiceKind.Managed && identity.managedServiceId === service.id && identity.subjectId === `agent-service:${service.id}`)
	{
		return identity;
	}
	return null;
}

/** Checks whether an AgentRun state still permits setup or observation by its current task. */
export function __CanCreateOrObserveAgentRunWorkflowTask(state: AgentRunState): boolean
{
	return state === AgentRunState.Accepted || state === AgentRunState.Queued || state === AgentRunState.Assigned || state === AgentRunState.Running || state === AgentRunState.WaitingForInput || state === AgentRunState.RecoveryRequired;
}

/** Selects the fixed namespace and token audience for the server-approved workload class. */
export function __AgentRunWorkflowRuntimeIdentity(kind: AgentServiceKind, options: AgentRunWorkflowControllerAuthorityOptions): { readonly namespace: string; readonly audience: string; readonly isServiceAccount: (value: string) => boolean }
{
	if (kind === AgentServiceKind.Managed)
	{
		return { namespace: options.managedRuntimeNamespace, audience: MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, isServiceAccount: ___IsManagedAgentRuntimeServiceAccountName };
	}
	return { namespace: options.personalRuntimeNamespace, audience: AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, isServiceAccount: ___IsAgentRuntimeServiceAccountName };
}

/** Checks that controller input still names the exact current run attempt. */
function __AgentRunWorkflowInputMatchesRun(input: AgentRunTaskInput, run: AgentRunWorkflowTaskRow["run"]): boolean
{
	return run.id === input.runId && run.siloId === input.siloId && run.attempt === input.attempt;
}

/** Parses the minimal frozen identity evidence that controls runtime assignment. */
function _SnapshotIdentity(value: unknown): AgentRunWorkflowSnapshotIdentity | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value))
	{
		return null;
	}
	const identity = value as Record<string, unknown>;
	const kind = identity["kind"];
	const subjectId = identity["executionSubjectId"];
	const trustedUntil = identity["fleetMembershipTrustedUntil"];
	if ((kind !== RunInputSnapshotIdentityKinds.User && kind !== RunInputSnapshotIdentityKinds.Service) || typeof subjectId !== "string" || subjectId.trim().length === 0 || typeof trustedUntil !== "string")
	{
		return null;
	}
	const parsedTrustedUntil = new Date(trustedUntil);
	if (Number.isNaN(parsedTrustedUntil.getTime()) || parsedTrustedUntil.toISOString() !== trustedUntil)
	{
		return null;
	}
	if (kind === RunInputSnapshotIdentityKinds.User)
	{
		return { subjectId, managedServiceId: null, trustedUntil: parsedTrustedUntil };
	}
	const managedServiceId = identity["agentServiceId"];
	if (typeof managedServiceId !== "string" || managedServiceId.trim().length === 0)
	{
		return null;
	}
	return { subjectId, managedServiceId, trustedUntil: parsedTrustedUntil };
}
