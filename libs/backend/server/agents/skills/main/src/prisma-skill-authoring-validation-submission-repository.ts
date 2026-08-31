import type { Prisma } from "@prisma/client";

import { __AdmitSkillAuthoringValidation } from "@opencrane/backend/agents/skills/workflows";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import { PrismaSkillAuthoringValidationRepository } from "./prisma-skill-authoring-validation-repository";
import { SkillAuthoringValidationSubmissionForbiddenError, type SkillAuthoringValidationSubmission, type SkillAuthoringValidationSubmissionAuthority, type SkillAuthoringValidationSubmissionCaller } from "./skill-authoring-validation-submission.types";

/** Saves one skill validation and its workflow task through a caller-owned database transaction. */
export class PrismaSkillAuthoringValidationSubmissionRepository implements SkillAuthoringValidationSubmissionAuthority
{
	/** Database transaction shared by the product read, validation record, and task admission. */
	private readonly transaction: Prisma.TransactionClient;
	/** Workflow engine that saves a task through the same database transaction. */
	private readonly workflow: IWorkflowEngine;

	/** Binds the transaction and declared workflow engine for one submission attempt. */
	constructor(transaction: Prisma.TransactionClient, workflow: IWorkflowEngine)
	{
		this.transaction = transaction;
		this.workflow = workflow;
	}

	/** Derives immutable artifact facts from the server-owned revision and admits its remote task. */
	async submit(caller: SkillAuthoringValidationSubmissionCaller, skillRevisionId: string): Promise<SkillAuthoringValidationSubmission>
	{
		// 1. Load the exact revision in the authenticated silo so the request never supplies artifact facts.
		const revision = await this.transaction.skillRevision.findFirst({ where: { id: skillRevisionId, skill: { siloId: caller.siloId, ownerPrincipalId: caller.principalId } }, select: { id: true, artifactRevisionId: true, artifactContentAddress: true } });
		if (revision === null)
			throw new SkillAuthoringValidationSubmissionForbiddenError();

		// 2. Save or reuse the validation and its task receipt through this same transaction.
		const validations = new PrismaSkillAuthoringValidationRepository(this.transaction);
		const admitted = await __AdmitSkillAuthoringValidation({ workflowTransaction: { client: this.transaction }, validations }, this.workflow, { siloId: caller.siloId, skillRevisionId: revision.id, artifactRevisionId: revision.artifactRevisionId, artifactContentAddress: revision.artifactContentAddress });
		return { validationId: admitted.validation.validationId, taskId: admitted.receipt.taskId };
	}
}
