import type { Prisma } from "@prisma/client";

import type { AgentRunWorkflowAssignmentCommand, AgentRunWorkflowControllerRecord, AgentRunWorkflowObservation, AgentRunWorkflowPodCommand, AgentRunWorkflowReleaseClaim, AgentRunTaskInput } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import { PrismaAgentRunWorkflowAssignmentReleaseRepository } from "./prisma-agent-run-workflow-assignment-release-repository";
import { PrismaAgentRunWorkflowTaskReadRepository } from "./prisma-agent-run-workflow-task-read-repository";
import { PrismaAgentRunWorkflowTerminalCleanupRepository } from "./prisma-agent-run-workflow-terminal-cleanup-repository";
import type { AttemptModelKeyMintRequest } from "./attempt-model-key.types";
import type { AgentRunWorkflowControllerAuthorityOptions, AgentRunWorkflowControllerPersistenceRepository } from "./agent-run-workflow-controller-authority.types";

/**
 * Combines the three receipt-fenced persistence owners used by one controller transaction.
 *
 * Called by: {@link PrismaAgentRunWorkflowControllerUnitOfWork}. Task reads derive only approved
 * non-secret facts, assignment/release owns Kubernetes identity fences, and terminal cleanup owns
 * lifecycle failure and cleanup outbox writes.
 */
export class PrismaAgentRunWorkflowControllerRepository implements AgentRunWorkflowControllerPersistenceRepository
{
	/** Holds the exact transaction shared by the three narrow persistence owners. */
	private readonly transaction: Prisma.TransactionClient;
	/** Reads task facts and records non-secret key evidence. */
	private readonly taskRead: PrismaAgentRunWorkflowTaskReadRepository;
	/** Owns Job assignment, first-Pod binding, and release fences. */
	private readonly assignmentRelease: PrismaAgentRunWorkflowAssignmentReleaseRepository;
	/** Owns terminal cleanup and read-only task outcome classification. */
	private readonly terminalCleanup: PrismaAgentRunWorkflowTerminalCleanupRepository;

	/** Creates the narrow repositories within one caller-owned controller transaction. */
	constructor(transaction: Prisma.TransactionClient, options: AgentRunWorkflowControllerAuthorityOptions)
	{
		this.transaction = transaction;
		this.taskRead = new PrismaAgentRunWorkflowTaskReadRepository(this.transaction, options);
		this.assignmentRelease = new PrismaAgentRunWorkflowAssignmentReleaseRepository(this.transaction, options);
		this.terminalCleanup = new PrismaAgentRunWorkflowTerminalCleanupRepository(this.transaction, options);
	}

	/** Loads the record a handler needs to create or adopt its one suspended Job. */
	async loadForTask(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<AgentRunWorkflowControllerRecord | null>
	{
		return await this.assignmentRelease.loadForTask(input, task);
	}

	/** Reads the stable non-secret request that the unit of work passes to the model-key issuer. */
	async loadAttemptKeyMintRequest(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<AttemptModelKeyMintRequest | null>
	{
		return await this.taskRead.loadAttemptKeyMintRequest(input, task);
	}

	/** Persists one raw-key digest while the saved task and current attempt still match. */
	async recordAttemptKeyDigest(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, keyDigest: string): Promise<boolean>
	{
		return await this.taskRead.recordAttemptKeyDigest(input, task, keyDigest);
	}

	/** Verifies raw-key evidence before the unit of work sends that key for revocation. */
	async verifyAttemptKeyDigest(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, keyAlias: string, keyDigest: string): Promise<boolean>
	{
		return await this.taskRead.verifyAttemptKeyDigest(input, task, keyAlias, keyDigest);
	}

	/** Binds a Job identity or classifies an exact replay without replacing the saved assignment. */
	async bindAssignment(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, command: AgentRunWorkflowAssignmentCommand): Promise<"bound" | "idempotent" | "conflict">
	{
		return await this.assignmentRelease.bindAssignment(input, task, command);
	}

	/** Binds one first Pod or rejects a different physical Pod for the already-saved Job. */
	async bindFirstPod(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, command: AgentRunWorkflowPodCommand): Promise<"bound" | "idempotent" | "conflict">
	{
		return await this.assignmentRelease.bindFirstPod(input, task, command);
	}

	/** Claims the current release lease before the handler unsuspends the saved Job. */
	async claimRelease(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, workloadUid: string): Promise<AgentRunWorkflowReleaseClaim | null>
	{
		return await this.assignmentRelease.claimRelease(input, task, workloadUid);
	}

	/** Records terminal setup failure and queues cleanup for any Job this task may have created. */
	async terminalizeFailedTask(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<void>
	{
		await this.terminalCleanup.terminalizeFailedTask(input, task);
	}

	/** Reads the task's lifecycle outcome without creating a new controller decision. */
	async observe(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<AgentRunWorkflowObservation>
	{
		return await this.terminalCleanup.observe(input, task);
	}
}
