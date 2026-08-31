import { Prisma, type PrismaClient } from "@prisma/client";

import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import { PrismaSkillAuthoringValidationSubmissionRepository } from "./prisma-skill-authoring-validation-submission-repository";
import type { SkillAuthoringValidationSubmission, SkillAuthoringValidationSubmissionAuthority, SkillAuthoringValidationSubmissionCaller } from "./skill-authoring-validation-submission.types";

/** Runs validation admission through the same database transaction as its Absurd task receipt. */
export class PrismaSkillAuthoringValidationSubmissionUnitOfWork implements SkillAuthoringValidationSubmissionAuthority
{
	/** Root client that opens the admission transaction. */
	private readonly prisma: PrismaClient;
	/** Declared workflow engine that saves the remote task through the caller's transaction. */
	private readonly workflow: IWorkflowEngine;

	/** Binds the product database to its guarded workflow engine. */
	constructor(prisma: PrismaClient, workflow: IWorkflowEngine)
	{
		this.prisma = prisma;
		this.workflow = workflow;
	}

	/** Opens the transaction that commits the product lookup, validation, and task together. */
	async submit(caller: SkillAuthoringValidationSubmissionCaller, skillRevisionId: string): Promise<SkillAuthoringValidationSubmission>
	{
		const workflow = this.workflow;
		return this.prisma.$transaction(async function _Submit(transaction): Promise<SkillAuthoringValidationSubmission>
		{
			return await new PrismaSkillAuthoringValidationSubmissionRepository(transaction, workflow).submit(caller, skillRevisionId);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}
