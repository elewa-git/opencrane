import { createHash } from "node:crypto";

import type { McpOperatorCaller } from "../core/mcp-operator.logic.types";
import type { McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";
import type { McpbValidationRecord } from "./mcpb-validation-repository.types";
import { McpbValidationSubmissionOutcomes } from "./mcpb-validation-submission.types";
import type { McpbBundleArtifactResolver, McpbValidationSubmissionCommand, McpbValidationSubmissionResult } from "./mcpb-validation-submission.types";
import { MCPB_MANIFEST_VERSION } from "./mcpb-validation.types";
import type { McpbValidationWorkflow } from "./mcpb-validation.types";
import { ___McpbValidationSubmissionSchema } from "./mcpb-validation-submission.validator";

/** Return a SHA-256 field suitable for database equality without retaining its source value. */
function _Digest(value: unknown): string
{
	return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

/** Submit one immutable bundle and save its background job in the same database transaction. */
export async function submitMcpbValidation(unitOfWork: McpOperatorUnitOfWork, workflow: McpbValidationWorkflow, artifacts: McpbBundleArtifactResolver, caller: McpOperatorCaller, command: McpbValidationSubmissionCommand): Promise<McpbValidationSubmissionResult>
{
	const parsed = ___McpbValidationSubmissionSchema.safeParse(command);
	if (!parsed.success)
		throw new Error("MCP bundle validation fields are invalid.");
	const target = await artifacts.resolve(caller.siloId, parsed.data.artifactId, parsed.data.artifactRevisionId);
	if (target === null)
		return { outcome: McpbValidationSubmissionOutcomes.ArtifactNotFound };
	const submissionKeyDigest = _Digest([caller.siloId, parsed.data.idempotencyKey]);
	const submissionDigest = _Digest([target.artifactId, target.artifactRevisionId, target.contentAddress, target.byteLength, target.mediaType, MCPB_MANIFEST_VERSION]);

	return await unitOfWork.execute(async function _Submit(transaction): Promise<McpbValidationSubmissionResult>
	{
		const stored = await transaction.mcpbValidations.createOrFind({ ...target, submissionKeyDigest, submissionDigest, createdByPrincipalId: caller.principalId });
		if (stored === null || stored.validation.submissionDigest !== submissionDigest)
			return { outcome: McpbValidationSubmissionOutcomes.Conflict };
		const validation = stored.validation;
		if (stored.created)
			await transaction.mcp.appendAudit("Created", `McpbValidation/${validation.id}`, `MCP bundle validation ${validation.id} submitted`, { siloId: caller.siloId, actorPrincipalId: caller.principalId });
		const admission = await workflow.admit(transaction.workflowTransaction, { siloId: validation.siloId, validationId: validation.id, artifactId: validation.artifactId, artifactRevisionId: validation.artifactRevisionId, contentAddress: validation.contentAddress, byteLength: validation.byteLength, mediaType: validation.mediaType, submissionDigest: validation.submissionDigest });
		const workloadId = await transaction.mcpbValidations.ensureWorkload(validation.siloId, validation.id, { taskId: admission.receipt.taskId, taskName: admission.receipt.taskName, taskKey: admission.taskKey });
		if (workloadId === null)
			throw new Error("MCP bundle validation worker handoff conflicts with the admitted task.");
		return { outcome: McpbValidationSubmissionOutcomes.Submitted, validation };
	});
}

/** Read one validation only inside the authenticated administrator's silo. */
export function getMcpbValidation(unitOfWork: McpOperatorUnitOfWork, caller: McpOperatorCaller, validationId: string): Promise<McpbValidationRecord | null>
{
	return unitOfWork.execute(async function _Read(transaction): Promise<McpbValidationRecord | null>
	{
		return await transaction.mcpbValidations.find(caller.siloId, validationId);
	});
}
