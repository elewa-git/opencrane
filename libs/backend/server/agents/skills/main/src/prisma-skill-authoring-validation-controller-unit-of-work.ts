import { Prisma, type PrismaClient } from "@prisma/client";

import type { SkillAuthoringValidationCompletion, SkillAuthoringValidationControllerAuthority, SkillAuthoringValidationControllerRecord, SkillAuthoringValidationPodBindCommand, SkillAuthoringValidationWorkloadBindCommand } from "@opencrane/backend/agents/skills/workflows/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import { PrismaSkillAuthoringValidationControllerRepository } from "./skill-authoring-validation-controller-authority";

/** Bounds recovery from a rolled-back serializable controller transaction. */
const _SERIALIZABLE_ATTEMPTS = 3;

/** Opens a short serializable transaction for each server-side skill-validation controller command. */
export class PrismaSkillAuthoringValidationControllerUnitOfWork implements SkillAuthoringValidationControllerAuthority
{
	/** Holds the application client that opens transaction attempts but never reaches a model delegate. */
	private readonly prisma: PrismaClient;

	/** Creates the unit of work from the application-owned Prisma client. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Issues or reloads the task-fenced controller delivery. */
	async claimForTask(validationId: string, task: IWorkflowTaskReceipt): Promise<SkillAuthoringValidationControllerRecord | null>
	{
		return await this._Run(async function _Claim(repository) { return await repository.claimForTask(validationId, task); });
	}

	/** Saves the Job UID and one-use bootstrap under the current controller delivery. */
	async bindWorkload(validationId: string, task: IWorkflowTaskReceipt, command: SkillAuthoringValidationWorkloadBindCommand): Promise<"bound" | "idempotent" | "conflict">
	{
		return await this._Run(async function _Bind(repository) { return await repository.bindWorkload(validationId, task, command); });
	}

	/** Saves the unique first Pod under the current controller delivery. */
	async bindFirstPod(validationId: string, task: IWorkflowTaskReceipt, command: SkillAuthoringValidationPodBindCommand): Promise<"bound" | "idempotent" | "conflict">
	{
		return await this._Run(async function _Bind(repository) { return await repository.bindFirstPod(validationId, task, command); });
	}

	/** Reads completion evidence through the same task-receipt boundary. */
	async loadCompletion(validationId: string, completionDigest: string, task: IWorkflowTaskReceipt): Promise<SkillAuthoringValidationCompletion | null>
	{
		return await this._Run(async function _Load(repository) { return await repository.loadCompletion(validationId, completionDigest, task); });
	}

	/** Applies the terminal state that the persisted worker completion proves. */
	async complete(validationId: string, completion: SkillAuthoringValidationCompletion, task: IWorkflowTaskReceipt): Promise<"completed" | "idempotent" | "conflict">
	{
		return await this._Run(async function _Complete(repository) { return await repository.complete(validationId, completion, task); });
	}

	/** Runs one controller authority operation with the only transaction policy this lifecycle uses. */
	private async _Run<TResult>(operation: (repository: PrismaSkillAuthoringValidationControllerRepository) => Promise<TResult>): Promise<TResult>
	{
		let lastConflict: Prisma.PrismaClientKnownRequestError | null = null;
		for (let attempt = 1; attempt <= _SERIALIZABLE_ATTEMPTS; attempt += 1)
		{
			try
			{
				return await this.prisma.$transaction(async function _Transaction(transaction): Promise<TResult>
				{
					return await operation(new PrismaSkillAuthoringValidationControllerRepository(transaction));
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
		throw new Error("skill authoring validation controller transaction conflicted after bounded retries", { cause: lastConflict ?? undefined });
	}
}
