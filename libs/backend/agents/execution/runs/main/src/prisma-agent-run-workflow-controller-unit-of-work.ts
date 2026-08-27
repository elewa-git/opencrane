import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import type { AgentRunWorkflowAssignmentCommand, AgentRunWorkflowAttemptKey, AgentRunWorkflowControllerAuthority, AgentRunWorkflowControllerRecord, AgentRunWorkflowObservation, AgentRunWorkflowPodCommand, AgentRunWorkflowReleaseClaim, AgentRunTaskInput } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import { PrismaAgentRunWorkflowControllerRepository } from "./prisma-agent-run-workflow-controller-authority";
import type { AgentRunWorkflowControllerAuthorityOptions } from "./agent-run-workflow-controller-authority.types";

/** Bounds retries when concurrent lifecycle changes roll back a serializable controller command. */
const _SERIALIZABLE_ATTEMPTS = 3;

/**
 * Opens short serializable transactions for AgentRun workflow controller commands.
 *
 * Called by: future application composition for `__CreateAgentRunWorkflowHandler`. Each method
 * delegates to a task-receipt-fenced repository, then commits before it asks the model gateway for
 * the same key request on every replay.
 */
export class PrismaAgentRunWorkflowControllerUnitOfWork implements AgentRunWorkflowControllerAuthority
{
	/** Holds the application client that opens controller transactions. */
	private readonly prisma: PrismaClient;
	/** Holds the server-selected runtime settings used in every transaction attempt. */
	private readonly options: AgentRunWorkflowControllerAuthorityOptions;

	/** Creates the authority from the server-owned Prisma client and runtime settings. */
	constructor(prisma: PrismaClient, options: AgentRunWorkflowControllerAuthorityOptions)
	{
		this.prisma = prisma;
		this.options = options;
	}

	/** Loads task-bound controller facts without storing them in a workflow checkpoint. */
	async loadForTask(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<AgentRunWorkflowControllerRecord | null>
	{
		return await this._Run(async function _Load(repository) { return await repository.loadForTask(input, task); });
	}

	/** Mints a replay-stable transient model key after its transaction has committed. */
	async mintAttemptKey(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<AgentRunWorkflowAttemptKey | null>
	{
		const request = await this._Run(async function _Mint(repository) { return await repository.loadAttemptKeyMintRequest(input, task); });
		if (request === null)
		{
			return null;
		}
		const minted = await this.options.issueAttemptModelKey(request);
		if (typeof minted.key !== "string" || minted.key.length === 0)
		{
			return null;
		}
		let persisted: boolean;
		try
		{
			persisted = await this._Run(async function _RecordDigest(repository) { return await repository.recordAttemptKeyDigest(input, task, _AttemptKeyDigest(minted.key)); });
		}
		catch (err)
		{
			await this.options.issueAttemptModelKey.revokeAttemptKey({ keyAlias: request.keyAlias, key: minted.key });
			throw err;
		}
		if (!persisted)
		{
			await this.options.issueAttemptModelKey.revokeAttemptKey({ keyAlias: request.keyAlias, key: minted.key });
			return null;
		}
		return { key: minted.key, keyAlias: request.keyAlias };
	}

	/** Revokes the just-minted unused key without writing its raw value to the database. */
	async revokeAttemptKey(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, attemptKey: AgentRunWorkflowAttemptKey): Promise<void>
	{
		const valid = await this._Run(async function _VerifyDigest(repository) { return await repository.verifyAttemptKeyDigest(input, task, attemptKey.keyAlias, _AttemptKeyDigest(attemptKey.key)); });
		if (!valid)
		{
			throw new Error("AgentRun workflow key revocation does not match the saved task.");
		}
		await this.options.issueAttemptModelKey.revokeAttemptKey({ keyAlias: attemptKey.keyAlias, key: attemptKey.key });
	}

	/** Binds a suspended Job before a controller may ask for its release lease. */
	async bindAssignment(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, command: AgentRunWorkflowAssignmentCommand): Promise<"bound" | "idempotent" | "conflict">
	{
		return await this._Run(async function _Bind(repository) { return await repository.bindAssignment(input, task, command); });
	}

	/** Binds the first Pod after the controller releases the already-saved Job. */
	async bindFirstPod(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, command: AgentRunWorkflowPodCommand): Promise<"bound" | "idempotent" | "conflict">
	{
		return await this._Run(async function _Bind(repository) { return await repository.bindFirstPod(input, task, command); });
	}

	/** Takes the short release lease that fences a controller before it unsuspends the Job. */
	async claimRelease(input: AgentRunTaskInput, task: IWorkflowTaskReceipt, workloadUid: string): Promise<AgentRunWorkflowReleaseClaim | null>
	{
		return await this._Run(async function _Claim(repository) { return await repository.claimRelease(input, task, workloadUid); });
	}

	/** Records a receipt-fenced setup failure before the workflow engine terminalises this task. */
	async terminalizeFailedTask(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<void>
	{
		await this._Run(async function _Terminalize(repository): Promise<void> { await repository.terminalizeFailedTask(input, task); });
	}

	/** Reads terminal, cancelled, running, or stale state without making a new lifecycle decision. */
	async observe(input: AgentRunTaskInput, task: IWorkflowTaskReceipt): Promise<AgentRunWorkflowObservation>
	{
		return await this._Run(async function _Observe(repository) { return await repository.observe(input, task); });
	}

	/** Retries a serializable transaction only for the two expected Prisma conflict codes. */
	private async _Run<TResult>(operation: (repository: PrismaAgentRunWorkflowControllerRepository) => Promise<TResult>): Promise<TResult>
	{
		let lastConflict: Prisma.PrismaClientKnownRequestError | null = null;
		for (let attempt = 1; attempt <= _SERIALIZABLE_ATTEMPTS; attempt += 1)
		{
			try
			{
				const options = this.options;
				return await this.prisma.$transaction(async function _Transaction(transaction): Promise<TResult>
				{
					const repository = new PrismaAgentRunWorkflowControllerRepository(transaction, options);
					return await operation(repository);
				}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
			}
			catch (error)
			{
				if (!(error instanceof Prisma.PrismaClientKnownRequestError) || (error.code !== "P2002" && error.code !== "P2034"))
				{
					throw error;
				}
				lastConflict = error;
			}
		}
		throw new Error("AgentRun workflow controller transaction conflicted after three attempts.", { cause: lastConflict ?? undefined });
	}
}

/** Return the non-secret SHA-256 evidence saved for one transient raw key. */
function _AttemptKeyDigest(key: string): string
{
	return `sha256:${createHash("sha256").update(key, "utf8").digest("hex")}`;
}
