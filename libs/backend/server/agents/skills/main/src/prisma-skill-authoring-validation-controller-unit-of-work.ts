import type { PrismaClient } from "@prisma/client";

import type { SkillAuthoringValidationBindOutcome, SkillAuthoringValidationCompletion, SkillAuthoringValidationControllerAuthority, SkillAuthoringValidationControllerRecord, SkillAuthoringValidationCurrentStatus, SkillAuthoringValidationPodBindCommand, SkillAuthoringValidationRecoveryOutcome, SkillAuthoringValidationRecoveryReasons, SkillAuthoringValidationReleaseOutcome, SkillAuthoringValidationWorkloadBindCommand } from "@opencrane/backend/agents/skills/workflows/contract";
import type { RuntimeWorkloadBinding, RuntimeWorkloadClaim } from "@opencrane/backend/agents/runtime/workloads/contract";
import { ___IsRolledBackConflict, ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import { PrismaSkillAuthoringValidationControllerRepository } from "./skill-authoring-validation-controller-authority";

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

	/** Reads lifecycle state without changing a workload claim. */
	async loadCurrentStatus(validationId: string, task: IWorkflowTaskReceipt): Promise<SkillAuthoringValidationCurrentStatus>
	{
		return await this._Run(async function _LoadStatus(repository) { return await repository.loadCurrentStatus(validationId, task); });
	}

	/** Saves terminal failure after the final unbound database claim expires. */
	async failExpiredBeforeWorkload(validationId: string, task: IWorkflowTaskReceipt, claim: RuntimeWorkloadClaim): Promise<SkillAuthoringValidationRecoveryOutcome>
	{
		return await this._Run(async function _FailExpired(repository) { return await repository.failExpiredBeforeWorkload(validationId, task, claim); });
	}

	/** Saves the Job UID and one-use bootstrap under the current controller delivery. */
	async bindWorkload(validationId: string, task: IWorkflowTaskReceipt, command: SkillAuthoringValidationWorkloadBindCommand): Promise<SkillAuthoringValidationBindOutcome>
	{
		return await this._Run(async function _Bind(repository) { return await repository.bindWorkload(validationId, task, command); });
	}

	/** Rechecks the exact bound Job against database time immediately before release. */
	async authorizeRelease(validationId: string, task: IWorkflowTaskReceipt, binding: RuntimeWorkloadBinding): Promise<SkillAuthoringValidationReleaseOutcome>
	{
		return await this._Run(async function _Authorize(repository) { return await repository.authorizeRelease(validationId, task, binding); });
	}

	/** Saves the unique first Pod under the current controller delivery. */
	async bindFirstPod(validationId: string, task: IWorkflowTaskReceipt, command: SkillAuthoringValidationPodBindCommand): Promise<SkillAuthoringValidationBindOutcome>
	{
		return await this._Run(async function _Bind(repository) { return await repository.bindFirstPod(validationId, task, command); });
	}

	/** Reads the current worker completion for task-owned recovery polling. */
	async loadCurrentCompletion(validationId: string, task: IWorkflowTaskReceipt): Promise<SkillAuthoringValidationCompletion | null>
	{
		return await this._Run(async function _Load(repository) { return await repository.loadCurrentCompletion(validationId, task); });
	}

	/** Saves a stable terminal failure for an exact Job that cannot report. */
	async failUnreported(validationId: string, task: IWorkflowTaskReceipt, binding: RuntimeWorkloadBinding, reason: SkillAuthoringValidationRecoveryReasons): Promise<SkillAuthoringValidationRecoveryOutcome>
	{
		return await this._Run(async function _Fail(repository) { return await repository.failUnreported(validationId, task, binding, reason); });
	}

	/** Applies the terminal state that the persisted worker completion proves. */
	async complete(validationId: string, completion: SkillAuthoringValidationCompletion, task: IWorkflowTaskReceipt): Promise<"completed" | "idempotent" | "conflict">
	{
		return await this._Run(async function _Complete(repository) { return await repository.complete(validationId, completion, task); });
	}

	/**
	 * Runs one controller authority operation with the only transaction policy this lifecycle uses.
	 *
	 * The shared unit-of-work envelope allows three Serializable attempts, retrying only proven
	 * rollbacks (P2002 and P2034). When the last attempt still conflicts, the raw conflict is
	 * wrapped in a stable message so recovery callers never depend on Prisma error text.
	 */
	private async _Run<TResult>(operation: (repository: PrismaSkillAuthoringValidationControllerRepository) => Promise<TResult>): Promise<TResult>
	{
		try
		{
			return await ___RunInPrismaUnitOfWork(this.prisma, async function _Transaction(transaction): Promise<TResult>
			{
				return await operation(new PrismaSkillAuthoringValidationControllerRepository(transaction));
			}, { isolationLevel: "Serializable", operation: "skill authoring validation controller", attemptLimit: 3 });
		}
		catch (error)
		{
			if (!___IsRolledBackConflict(error)) throw error;
			throw new Error("skill authoring validation controller transaction conflicted after bounded retries", { cause: error });
		}
	}
}
