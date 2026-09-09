import type { Prisma } from "@prisma/client";

import { __AdmitSkillAuthoringValidation } from "@opencrane/backend/agents/skills/workflows";
import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { PrismaSkillAuthoringValidationRepository } from "./prisma-skill-authoring-validation-repository";
import { SkillAuthoringValidationSubmissionForbiddenError, type SkillAuthoringValidationSubmission, type SkillAuthoringValidationSubmissionAuthority, type SkillAuthoringValidationSubmissionCaller } from "./skill-authoring-validation-submission.types";

/** Saves one skill validation and its workflow task through a caller-owned database transaction. */
export class PrismaSkillAuthoringValidationSubmissionRepository implements SkillAuthoringValidationSubmissionAuthority
{
	/** Database transaction shared by the product read, validation record, and task admission. */
	private readonly transaction: Prisma.TransactionClient;
	/** Workflow engine that saves a task through the same database transaction. */
	private readonly workflow: IWorkflowEngine;
	/** Central product authorization authority bound to the same database transaction. */
	private readonly authorization: AuthorizationAuthority;

	/** Binds the transaction and declared workflow engine for one submission attempt. */
	constructor(transaction: Prisma.TransactionClient, workflow: IWorkflowEngine, authorization: AuthorizationAuthority)
	{
		this.transaction = transaction;
		this.workflow = workflow;
		this.authorization = authorization;
	}

	/** Derives immutable artifact facts from the server-owned revision and admits its remote task. */
	async submit(caller: SkillAuthoringValidationSubmissionCaller, skillRevisionId: string): Promise<SkillAuthoringValidationSubmission>
	{
		// 1. Load the exact revision in the authenticated silo so ownership and artifact coordinates remain server-owned facts.
		const revision = await this.transaction.skillRevision.findFirst({ where: { id: skillRevisionId, skill: { siloId: caller.siloId } }, select: { id: true, artifactRevisionId: true, artifactContentAddress: true, skill: { select: { ownerPrincipalId: true } } } });
		if (revision === null)
			throw new SkillAuthoringValidationSubmissionForbiddenError();

		// 2. Admit the typed review action from current Principal and Group grants in this transaction.
		const admission = await this.authorization.admitPrincipal({
			siloId: caller.siloId,
			principalId: caller.principalId,
			action: ProductAuthorizationActions.Review,
			resource: { kind: ProductAuthorizationResourceKinds.SkillRevision, id: revision.id },
			nowEpochMs: Date.now(),
			actorKind: "user",
			actorId: caller.principalId,
			argumentsDigest: ___DigestCanonicalJson({ ownerPrincipalId: revision.skill.ownerPrincipalId, skillRevisionId: revision.id } as JsonValue),
		});
		if (admission.outcome !== AuthorizationDecisionOutcomes.Allow)
			throw new SkillAuthoringValidationSubmissionForbiddenError();

		// 3. Save or reuse the validation and its task receipt through this same transaction.
		const validations = new PrismaSkillAuthoringValidationRepository(this.transaction);
		const admitted = await __AdmitSkillAuthoringValidation({ workflowTransaction: { client: this.transaction }, validations }, this.workflow, { siloId: caller.siloId, skillRevisionId: revision.id, artifactRevisionId: revision.artifactRevisionId, artifactContentAddress: revision.artifactContentAddress });
		return { validationId: admitted.validation.validationId, taskId: admitted.receipt.taskId };
	}
}
