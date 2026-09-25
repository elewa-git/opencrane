import type { Prisma } from "@prisma/client";

import { __DecideDeferredToolRequest, __ExpireDeferredToolApprovalBatch, DeferredToolDecisionKinds, DeferredToolDecisionOutcomes } from "@opencrane/backend/server/iam/authorization";
import { ElicitationApprovalScopes, ElicitationBodyKinds, ElicitationPurposes, type ElicitationResponseValue } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

import { _ApprovalScopeOf } from "../../elicitation-approval-grant";
import type { ApprovalGrantRepository } from "../../elicitation-approval-grant.types";
import { PrismaApprovalGrantRepository } from "../../prisma-elicitation-approval-grants";
import type { ElicitationPurposeRequest, ElicitationPurposeStrategy } from "../elicitation-purpose.types";

/**
 * Applies the participant's answer through the existing tool-approval authority.
 * IAM owns invocation transitions; this class never dispatches a tool or resumes a run.
 */
export class PrismaToolApprovalPurposeAuthority implements ElicitationPurposeStrategy
{
	/** Standing grants recorded by "this session" and "every time" answers. */
	private readonly _grants: ApprovalGrantRepository;

	/** Use the transaction that owns the request and its response. */
	public constructor(private readonly _transaction: Prisma.TransactionClient)
	{
		this._grants = new PrismaApprovalGrantRepository(this._transaction);
	}

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
		const decided = result.outcome === DeferredToolDecisionOutcomes.Approved || result.outcome === DeferredToolDecisionOutcomes.Denied || result.outcome === DeferredToolDecisionOutcomes.AlreadyDecided;
		if (decided && result.outcome !== DeferredToolDecisionOutcomes.Denied)
			await this._mintToolApprovalGrant(request, response, approval, subjectId);
		return decided;
	}

	/** Expire a deferred approval through its existing lifecycle authority. */
	public async expire(request: ElicitationPurposeRequest, now: Date): Promise<void>
	{
		await __ExpireDeferredToolApprovalBatch(this._transaction, { runId: request.runId, attempt: request.attempt, now });
	}

	/**
	 * Record the standing grant behind a tool approval answered "this session" or "every time".
	 *
	 * Keyed to the tool's resource and action rather than to the exact arguments, because the person
	 * agreed to stop being asked about this tool, not about one call of it. The decision above still
	 * governs this call; the grant only spares the next one a question.
	 */
	private async _mintToolApprovalGrant(request: ElicitationPurposeRequest, response: ElicitationResponseValue, approval: { siloId: string; resourceKind: string; resourceId: string; action: string }, subjectId: string): Promise<void>
	{
		const scope = _ApprovalScopeOf(response);
		if (scope === ElicitationApprovalScopes.Once)
			return;
		const conversation = await this._transaction.elicitationRequest.findUnique({ where: { id: request.id }, select: { conversationId: true } });
		if (conversation === null)
			return;
		await this._grants.mint({
			siloId: approval.siloId,
			purpose: ElicitationPurposes.ToolApproval,
			subjectId,
			resourceKind: approval.resourceKind,
			resourceId: approval.resourceId,
			action: approval.action,
			scope,
			conversationId: conversation.conversationId,
			requestId: request.id,
			expiresAt: null,
		});
	}
}
