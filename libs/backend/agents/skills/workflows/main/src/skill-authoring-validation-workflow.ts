import type { IWorkflowEngine, IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import { SkillAuthoringValidationTaskDeclaration } from "@opencrane/backend/agents/skills/workflows/contract";

import { SkillAuthoringValidationAdmissionError } from "./skill-authoring-validation-workflow.types";
import type { SkillAuthoringValidationAdmission, SkillAuthoringValidationAdmissionCommand, SkillAuthoringValidationAdmissionTransaction, SkillAuthoringValidationRecord } from "./skill-authoring-validation-workflow.types";

/** Reject an empty repository decision before a task can be admitted without immutable validation facts. */
function _Record(command: SkillAuthoringValidationAdmissionCommand, record: SkillAuthoringValidationRecord | undefined, rejectionReason: string | undefined): SkillAuthoringValidationRecord
{
	if (record === undefined)
	{
		throw new SkillAuthoringValidationAdmissionError(`Skill authoring validation was denied: ${rejectionReason ?? "invalid_repository_decision"}.`);
	}
	if (record.siloId !== command.siloId || record.skillRevisionId !== command.skillRevisionId || record.artifactRevisionId !== command.artifactRevisionId || record.artifactContentAddress !== command.artifactContentAddress || record.taskKey.length === 0)
	{
		throw new SkillAuthoringValidationAdmissionError("Skill authoring validation repository returned conflicting immutable facts.");
	}
	return record;
}

/** Reject a task receipt that differs from the declaration or the validation's durable task key. */
function _Receipt(record: SkillAuthoringValidationRecord, receipt: IWorkflowTaskReceipt): IWorkflowTaskReceipt
{
	if (receipt.taskName !== SkillAuthoringValidationTaskDeclaration.taskName || receipt.idempotencyKey !== record.taskKey || receipt.taskId.trim().length === 0)
	{
		throw new SkillAuthoringValidationAdmissionError("Skill authoring workflow returned a conflicting task receipt.");
	}
	return receipt;
}

/**
 * Admits one Python skill validation inside the caller's existing database transaction.
 *
 * The repository first proves that the same silo still owns a Draft Python revision and its pinned
 * active artifact. The workflow task is then saved through that same transaction before the receipt
 * is bound to the validation; any rejection throws so the caller can roll back both product changes.
 *
 * This is a ports-only admission rule in the current slice. The product schema, repository adapter,
 * route, and deployable controller registration will call it in later slices.
 *
 * @param transaction - Caller-owned transaction with a repository already scoped to that transaction.
 * @param workflow - Server-declared engine that saves the remote task without hosting its handler.
 * @param command - Immutable skill and artifact coordinates to validate.
 * @returns The validation record and the receipt bound to it.
 * @throws {SkillAuthoringValidationAdmissionError} When immutable facts, the workflow receipt, or the saved binding conflict.
 */
export async function __AdmitSkillAuthoringValidation(transaction: SkillAuthoringValidationAdmissionTransaction, workflow: IWorkflowEngine, command: SkillAuthoringValidationAdmissionCommand): Promise<SkillAuthoringValidationAdmission>
{
	const resolution = await transaction.validations.createOrFind(command);
	const validation = _Record(command, resolution.record, resolution.rejectionReason);
	const receipt = _Receipt(validation, await workflow.spawn(transaction.workflowTransaction, {
		taskName: SkillAuthoringValidationTaskDeclaration.taskName,
		idempotencyKey: validation.taskKey,
		input: { siloId: validation.siloId, validationId: validation.validationId },
	}));
	const binding = await transaction.validations.bindTask(validation, receipt);
	if (binding === "conflict")
	{
		throw new SkillAuthoringValidationAdmissionError("Skill authoring validation task binding conflicts with saved facts.");
	}
	return { validation, receipt };
}
