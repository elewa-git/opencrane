import { createHash } from "node:crypto";

import type { McpOperatorCaller } from "../core/mcp-operator.logic.types";
import type { McpOperatorTransaction, McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";
import { __RequireMcpOrganizationAdministration, __RequireMcpOrganizationAdministrationRead } from "../core/mcp-operator-authorization";
import type { OciImageValidationCreateResult, OciImageValidationRecord, OciImageValidationSubmissionRecord } from "./oci-image-validation-repository.types";
import { OciImageValidationSubmissionOutcomes } from "./oci-image-validation-submission.types";
import type { OciImageLayoutArtifactResolver, OciImageValidationSubmissionCommand, OciImageValidationSubmissionResult } from "./oci-image-validation-submission.types";
import { OCI_IMAGE_LAYOUT_VERSION } from "./oci-image-validation.types";
import type { OciImageValidationWorkflow } from "./oci-image-validation.types";
import { ___OciImageValidationSubmissionSchema } from "./oci-image-validation-submission.validator";

/** Return a SHA-256 field suitable for database equality without retaining its source value. */
function _Digest(value: unknown): string
{
	return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

/** Copy the exact validation facts into the durable workflow input admitted by the same transaction. */
function _TaskInput(validation: OciImageValidationRecord)
{
	return {
		siloId: validation.siloId,
		validationId: validation.id,
		artifactId: validation.artifactId,
		artifactRevisionId: validation.artifactRevisionId,
		contentAddress: validation.contentAddress,
		byteLength: validation.byteLength,
		mediaType: validation.mediaType,
		submissionDigest: validation.submissionDigest,
	};
}

/** Create the validation row or return the row already associated with this client submission key. */
async function _CreateOrFindValidation(transaction: McpOperatorTransaction, submission: OciImageValidationSubmissionRecord): Promise<OciImageValidationCreateResult | null>
{
	return await transaction.ociImageValidations.createOrFind(submission);
}

/** Record the authenticated administrator only when this transaction created the validation row. */
async function _AppendCreationAudit(transaction: McpOperatorTransaction, caller: McpOperatorCaller, validation: OciImageValidationRecord): Promise<void>
{
	await transaction.mcp.appendAudit(caller.siloId, "Created", `OciImageValidation/${validation.id}`, `OCI image validation ${validation.id} submitted`, caller.principalId);
}

/** Admit the saved validation through the workflow transaction that created or replayed its row. */
async function _AdmitValidationWorkflow(transaction: McpOperatorTransaction, workflow: OciImageValidationWorkflow, validation: OciImageValidationRecord): Promise<void>
{
	const taskInput = _TaskInput(validation);
	await workflow.admit(transaction.workflowTransaction, taskInput);
}

/**
 * Creates or replays an OCI Image Layout validation and admits its workflow in the same database transaction.
 *
 * The caller's silo resolves the artifact before either row is written, so a published revision from
 * another silo cannot be admitted. A repeated idempotency key returns the saved validation; a key
 * reused for different immutable artifact facts returns `Conflict`.
 *
 * Called by: `POST /mcp/oci-image-validations` in `mcp-operator.ts`.
 * @returns `ArtifactNotFound` when the caller cannot resolve the revision, `Conflict` when the key
 * identifies different saved facts, or `Submitted` with the created or replayed validation.
 * @throws Error When the public submission fields are malformed.
 */
export async function submitOciImageValidation(unitOfWork: McpOperatorUnitOfWork, workflow: OciImageValidationWorkflow, artifacts: OciImageLayoutArtifactResolver, caller: McpOperatorCaller, command: OciImageValidationSubmissionCommand): Promise<OciImageValidationSubmissionResult>
{
	// 1. Reject malformed public input before it can select an artifact or create a database row.
	const parsed = ___OciImageValidationSubmissionSchema.safeParse(command);
	if (!parsed.success)
		throw new Error("OCI image validation fields are invalid.");

	// 2. Admit the read before resolving through the caller's silo, so another tenant's revision cannot be observed or admitted.
	await unitOfWork.execute(async function _AuthorizeRead(transaction): Promise<void>
	{
		await __RequireMcpOrganizationAdministrationRead(transaction.authorization, caller);
	});
	const target = await artifacts.resolve(caller.siloId, parsed.data.artifactId, parsed.data.artifactRevisionId);
	if (target === null)
		return { outcome: OciImageValidationSubmissionOutcomes.ArtifactNotFound };

	// 3. Bind idempotency and immutable artifact evidence before the row and workflow task are written together.
	const submissionKeyDigest = _Digest([caller.siloId, parsed.data.idempotencyKey]);
	const submissionDigest = _Digest([target.artifactId, target.artifactRevisionId, target.contentAddress, target.byteLength, target.mediaType, OCI_IMAGE_LAYOUT_VERSION]);
	const submission = { ...target, submissionKeyDigest, submissionDigest, createdByPrincipalId: caller.principalId };

	return await unitOfWork.execute(async function _Submit(transaction): Promise<OciImageValidationSubmissionResult>
	{
		await __RequireMcpOrganizationAdministration(transaction.authorization, caller, { operation: "mcp-oci-image-validation-submit", artifactId: target.artifactId, artifactRevisionId: target.artifactRevisionId, contentAddress: target.contentAddress, submissionDigest });
		const stored = await _CreateOrFindValidation(transaction, submission);
		if (stored === null || stored.validation.submissionDigest !== submissionDigest)
			return { outcome: OciImageValidationSubmissionOutcomes.Conflict };
		const validation = stored.validation;
		if (stored.created)
			await _AppendCreationAudit(transaction, caller, validation);
		await _AdmitValidationWorkflow(transaction, workflow, validation);
		return { outcome: OciImageValidationSubmissionOutcomes.Submitted, validation };
	});
}

/**
 * Reads a validation from the authenticated administrator's silo.
 *
 * Called by: `GET /mcp/oci-image-validations/{id}` in `mcp-operator.ts`.
 * @returns The validation when it belongs to the caller's silo; otherwise `null`.
 */
export function getOciImageValidation(unitOfWork: McpOperatorUnitOfWork, caller: McpOperatorCaller, validationId: string): Promise<OciImageValidationRecord | null>
{
	return unitOfWork.execute(async function _Read(transaction): Promise<OciImageValidationRecord | null>
	{
		await __RequireMcpOrganizationAdministrationRead(transaction.authorization, caller);
		return await transaction.ociImageValidations.find(caller.siloId, validationId);
	});
}
