import { createHash } from "node:crypto";

import type { McpOperatorCaller } from "../core/mcp-operator.logic.types";
import type { McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";
import type { OciImageValidationRecord } from "./oci-image-validation-repository.types";
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

/** Submit one immutable OCI Image Layout ZIP and save its background job in the same database transaction. */
export async function submitOciImageValidation(unitOfWork: McpOperatorUnitOfWork, workflow: OciImageValidationWorkflow, artifacts: OciImageLayoutArtifactResolver, caller: McpOperatorCaller, command: OciImageValidationSubmissionCommand): Promise<OciImageValidationSubmissionResult>
{
	const parsed = ___OciImageValidationSubmissionSchema.safeParse(command);
	if (!parsed.success)
		throw new Error("OCI image validation fields are invalid.");
	const target = await artifacts.resolve(caller.siloId, parsed.data.artifactId, parsed.data.artifactRevisionId);
	if (target === null)
		return { outcome: OciImageValidationSubmissionOutcomes.ArtifactNotFound };
	const submissionKeyDigest = _Digest([caller.siloId, parsed.data.idempotencyKey]);
	const submissionDigest = _Digest([target.artifactId, target.artifactRevisionId, target.contentAddress, target.byteLength, target.mediaType, OCI_IMAGE_LAYOUT_VERSION]);

	return await unitOfWork.execute(async function _Submit(transaction): Promise<OciImageValidationSubmissionResult>
	{
		const stored = await transaction.ociImageValidations.createOrFind({ ...target, submissionKeyDigest, submissionDigest, createdByPrincipalId: caller.principalId });
		if (stored === null || stored.validation.submissionDigest !== submissionDigest)
			return { outcome: OciImageValidationSubmissionOutcomes.Conflict };
		const validation = stored.validation;
		if (stored.created)
			await transaction.mcp.appendAudit("Created", `OciImageValidation/${validation.id}`, `OCI image validation ${validation.id} submitted`, { siloId: caller.siloId, actorPrincipalId: caller.principalId });
		await workflow.admit(transaction.workflowTransaction, { siloId: validation.siloId, validationId: validation.id, artifactId: validation.artifactId, artifactRevisionId: validation.artifactRevisionId, contentAddress: validation.contentAddress, byteLength: validation.byteLength, mediaType: validation.mediaType, submissionDigest: validation.submissionDigest });
		return { outcome: OciImageValidationSubmissionOutcomes.Submitted, validation };
	});
}

/** Read one validation only inside the authenticated administrator's silo. */
export function getOciImageValidation(unitOfWork: McpOperatorUnitOfWork, caller: McpOperatorCaller, validationId: string): Promise<OciImageValidationRecord | null>
{
	return unitOfWork.execute(async function _Read(transaction): Promise<OciImageValidationRecord | null>
	{
		return await transaction.ociImageValidations.find(caller.siloId, validationId);
	});
}
