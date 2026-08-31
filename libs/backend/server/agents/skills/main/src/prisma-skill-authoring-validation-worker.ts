import { Prisma, type PrismaClient } from "@prisma/client";

import type { RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";

import { PrismaSkillAuthoringValidationWorkerRepository } from "./prisma-skill-authoring-validation-worker-repository";
import type { SkillAuthoringValidationBootstrapRecord, SkillAuthoringValidationInput, SkillAuthoringValidationWorkerAuthority, SkillAuthoringValidationWorkerCompletion } from "./skill-authoring-validation-worker.types";

/** Opens one serializable database transaction for each worker-only validation operation. */
export class PrismaSkillAuthoringValidationWorkerUnitOfWork implements SkillAuthoringValidationWorkerAuthority
{
	/** Root client that opens one transaction per authority operation. */
	private readonly prisma: PrismaClient;

	/** Binds the product database. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Loads one unused bootstrap after the workflow bound both Job and first Pod UIDs. */
	async loadBootstrap(referenceHash: string): Promise<SkillAuthoringValidationBootstrapRecord | null>
	{
		return await this._Run(async function _Load(repository) { return await repository.loadBootstrap(referenceHash); });
	}

	/** Consumes the one-use bootstrap under the deployment-fixed, Pod-bound worker identity. */
	async consumeBootstrap(referenceHash: string, identity: RuntimeWorkloadIdentity): Promise<"consumed" | "conflict">
	{
		return await this._Run(async function _Consume(repository) { return await repository.consumeBootstrap(referenceHash, identity); });
	}

	/** Loads the exact published artifact for the Pod that spent this validation bootstrap. */
	async loadInput(validationId: string, identity: RuntimeWorkloadIdentity): Promise<SkillAuthoringValidationInput | null>
	{
		return await this._Run(async function _Load(repository) { return await repository.loadInput(validationId, identity); });
	}

	/** Saves the completion inbox through one database transaction. */
	async complete(command: SkillAuthoringValidationWorkerCompletion, identity: RuntimeWorkloadIdentity): Promise<"completed" | "idempotent" | "conflict">
	{
		return await this._Run(async function _Complete(repository) { return await repository.complete(command, identity); });
	}

	/** Supplies one transaction-scoped repository to a worker protocol operation. */
	private async _Run<TResult>(operation: (repository: PrismaSkillAuthoringValidationWorkerRepository) => Promise<TResult>): Promise<TResult>
	{
		return await this.prisma.$transaction(async function _Transaction(transaction): Promise<TResult>
		{
			return await operation(new PrismaSkillAuthoringValidationWorkerRepository(transaction));
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}
