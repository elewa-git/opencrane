import type { Prisma } from "@prisma/client";

import { __DecideDeferredToolRequest, __ExpireDeferredToolApprovalBatch, DeferredToolDecisionKinds, DeferredToolDecisionOutcomes } from "@opencrane/backend/server/iam/authorization";
import { ElicitationBodyKinds, type ElicitationResponseValue } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

import type { ElicitationPurposeRequest, ElicitationPurposeStrategy } from "../elicitation-purpose.types";

/**
 * Applies the participant's answer through the existing tool-approval authority.
 * IAM owns invocation transitions; this class never dispatches a tool or resumes a run.
 */
export class PrismaToolApprovalPurposeAuthority implements ElicitationPurposeStrategy
{
	/** Use the transaction that owns the request and its response. */
	public constructor(private readonly _transaction: Prisma.TransactionClient) {}

	/** Send the person's decision and the saved reviewed arguments to IAM. */
	public async apply(request: ElicitationPurposeRequest, response: ElicitationResponseValue, subjectId: string, now: Date): Promise<boolean>
	{
		if (response.kind !== ElicitationBodyKinds.Approval)
			return false;
		const approval = await this._transaction.approvalRequest.findUnique({ where: { elicitationRequestId: request.id } });
		if (approval === null || approval.reviewedToolArguments === null)
			return false;
		const decision = response.approved ? DeferredToolDecisionKinds.Approved : DeferredToolDecisionKinds.Denied;
		const approvedArguments = response.approved ? approval.reviewedToolArguments as JsonValue : undefined;
		const command = {
			approvalRequestId: approval.id,
			siloId: approval.siloId,
			reviewerSubjectId: subjectId,
			decision,
			arguments: approvedArguments,
			decidedBy: subjectId,
			now,
		};
		const result = await __DecideDeferredToolRequest(this._transaction, command);
		return result.outcome === DeferredToolDecisionOutcomes.Approved || result.outcome === DeferredToolDecisionOutcomes.Denied || result.outcome === DeferredToolDecisionOutcomes.AlreadyDecided;
	}

	/** Expire a deferred approval through its existing lifecycle authority. */
	public async expire(request: ElicitationPurposeRequest, now: Date): Promise<void>
	{
		await __ExpireDeferredToolApprovalBatch(this._transaction, { runId: request.runId, attempt: request.attempt, now });
	}

}
