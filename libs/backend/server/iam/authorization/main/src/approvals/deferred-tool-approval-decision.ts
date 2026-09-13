import { AgentRunState, ApprovalRequestState, OrgMemberStatus, Prisma } from "@prisma/client";
import { ___ExecutionSubjectSchema } from "@opencrane/contracts";
import { ___CloneCanonicalJson, type JsonValue } from "@opencrane/util";
import { __DigestCanonicalJson } from "../authority/canonical-json-digest";
import { __IsDeferredToolApprovalReplacementAllowed, __ProjectDeferredToolApproval, __ValidateDeferredToolArguments } from "./deferred-tool-approval-schema";
import { DeferredToolDecisionKinds, DeferredToolDecisionOutcomes, type DecideDeferredToolRequestCommand, type DecideDeferredToolRequestResult } from "./deferred-tool-approval-decision.types";
import { DeferredToolApprovalLifecycleEvents } from "./deferred-tool-approval-lifecycle.types";
import { ToolInvocationStates } from "../tool-invocations/tool-invocation-lifecycle.types";
import { __FindToolInvocationInTransaction, __MarkToolInvocationApprovalRejectedInTransaction, __MarkToolInvocationApprovedInTransaction } from "../tool-invocations/persistence/tool-invocation-transaction";
import { _ExpireDeferredToolApproval } from "./deferred-tool-approval-expiry";
import { __ReconcileDeferredToolApprovalGrants } from "./deferred-tool-approval-grants";
import { _FinishDeferredToolApprovalBatch } from "./deferred-tool-approval-batch";

/** Maps a decided approval state back to the stable decision literal, or null while still pending. */
function _decisionOf(state: ApprovalRequestState): DeferredToolDecisionKinds | null
{
	if (state === ApprovalRequestState.Approved)
		return DeferredToolDecisionKinds.Approved;
	if (state === ApprovalRequestState.Denied)
		return DeferredToolDecisionKinds.Denied;
	return null;
}

/**
 * Decide one pending deferred tool request inside a caller-owned transaction.
 *
 * This extends the existing {@link ApprovalRequest} lifecycle for the deferred-tool flow: a runtime
 * external action that requires approval prepares its ToolInvocation, pauses (DeferredToolRequests),
 * and a reviewer calls this to move the pending row to Approved or Denied. Approval records the
 * authenticated effective arguments on the invocation so only reviewed values can reach dispatch;
 * denial closes the request with one durable result delivery. Deciding is idempotent — re-deciding the same
 * way returns `already_decided`, and any conflicting decision (different outcome, or a row that was
 * cancelled/expired out from under the reviewer) returns `conflict` rather than mutating a terminal
 * approval. The caller commits this in the same transaction that transitions the owning run state.
 * The active conversation computer lease is fenced once, by the approval_requests trigger on the
 * decision update; when it rejects a stale lease the Prisma error propagates so the transaction
 * owner rolls back (recognisable with {@link _IsApprovalRequestFenceRejection}).
 *
 * The browser-facing Phase F decision route supplies only an authenticated owner, a silo, and the
 * terminal choice. This authority rechecks that ownership against the durable row and mints no
 * browser-controlled result or credential, so a caller cannot redirect a pending action.
 *
 * @param transaction - Prisma transaction already holding the owning run's approval fence.
 * @param command - Exact pending request, reviewer decision, and trusted instant.
 * @returns The authorized deferred result on approval, a denial, an idempotent replay, or a conflict.
 */
export async function __DecideDeferredToolRequest(transaction: Prisma.TransactionClient, command: DecideDeferredToolRequestCommand): Promise<DecideDeferredToolRequestResult>
{
	// 1. Reload owner, membership, waiting run, approval, and invocation inside one serializable unit.
	const approval = await transaction.approvalRequest.findUnique({ where: { id: command.approvalRequestId } });
	const requester = await transaction.principal.findFirst({ where: { siloId: command.siloId, subject: command.reviewerSubjectId }, select: { id: true } });
	if (approval === null || requester === null || approval.siloId !== command.siloId || approval.principalId !== requester.id || approval.toolInvocationRowId === null)
		return { outcome: DeferredToolDecisionOutcomes.Conflict };
	const membership = await transaction.orgMembership.findFirst({ where: { clusterTenant: command.siloId, subject: command.reviewerSubjectId, status: OrgMemberStatus.Active } });
	const run = await transaction.agentRun.findUnique({ where: { id: approval.runId } });
	const invocation = await __FindToolInvocationInTransaction(transaction, approval.toolInvocationRowId);
	if (membership === null || run === null || run.attempt !== approval.attempt || run.state !== AgentRunState.WaitingForInput || invocation === null || invocation.runId !== approval.runId || invocation.attempt !== approval.attempt || invocation.toolRevisionId !== approval.resourceId || invocation.argumentsDigest !== approval.argumentsDigest)
		return { outcome: DeferredToolDecisionOutcomes.Conflict };
	if (approval.reviewedToolArguments === null || approval.reviewedToolSchema === null || approval.reviewedToolSchemaDigest === null || approval.responseSchema === null)
		return { outcome: DeferredToolDecisionOutcomes.Conflict };
	const reviewedSchema = approval.reviewedToolSchema as JsonValue;
	const reviewedArguments = approval.reviewedToolArguments as JsonValue;
	if (__DigestCanonicalJson(reviewedSchema) !== approval.reviewedToolSchemaDigest || !__ValidateDeferredToolArguments(reviewedSchema, reviewedArguments))
		return { outcome: DeferredToolDecisionOutcomes.Conflict };
	const projection = __ProjectDeferredToolApproval(reviewedSchema, reviewedArguments);
	if (__DigestCanonicalJson(approval.safeProposedArguments as JsonValue) !== __DigestCanonicalJson(projection.proposedArguments) || __DigestCanonicalJson(approval.responseSchema as JsonValue) !== __DigestCanonicalJson(projection.responseSchema))
		return { outcome: DeferredToolDecisionOutcomes.Conflict };
	const replacementAllowed = __IsDeferredToolApprovalReplacementAllowed(reviewedSchema);

	// 2. A previously decided request replays idempotently or conflicts on a differing outcome.
	const priorDecision = _decisionOf(approval.state);
	if (priorDecision !== null)
	{
		if (priorDecision !== command.decision)
			return { outcome: DeferredToolDecisionOutcomes.Conflict };
		if (priorDecision === DeferredToolDecisionKinds.Denied)
			return command.arguments === undefined ? { outcome: DeferredToolDecisionOutcomes.AlreadyDecided, decision: priorDecision } : { outcome: DeferredToolDecisionOutcomes.Conflict };
		if (command.arguments === undefined)
			return { outcome: DeferredToolDecisionOutcomes.Conflict };
		const digest = __DigestCanonicalJson(___CloneCanonicalJson(command.arguments));
		return digest === approval.finalArgumentsDigest ? { outcome: DeferredToolDecisionOutcomes.AlreadyDecided, decision: priorDecision, argumentsDigest: digest } : { outcome: DeferredToolDecisionOutcomes.Conflict };
	}
	if (approval.state !== ApprovalRequestState.Pending)
		return { outcome: DeferredToolDecisionOutcomes.Conflict };
	if (approval.expiresAt.getTime() <= command.now.getTime())
	{
		return await _ExpireDeferredToolApproval(transaction, approval, command.now) ? { outcome: DeferredToolDecisionOutcomes.Expired } : { outcome: DeferredToolDecisionOutcomes.Conflict };
	}

	// 3. Denial writes the result delivery, then terminalises the waiting action with the real reason.
	if (command.decision === DeferredToolDecisionKinds.Denied)
	{
		if (command.arguments !== undefined)
			return { outcome: DeferredToolDecisionOutcomes.InvalidArguments };
		const denied = await transaction.approvalRequest.updateMany({
			where: { id: command.approvalRequestId, state: ApprovalRequestState.Pending, expiresAt: { gt: command.now } },
			data: { state: ApprovalRequestState.Denied, decidedAt: command.now, decidedBy: command.decidedBy },
		});
		if (denied.count !== 1)
			return _conflictOrExpire(transaction, command);
		if (!await __MarkToolInvocationApprovalRejectedInTransaction(transaction, invocation.id, command.now, "approval_denied"))
			throw new Error("deferred approval lost its awaiting invocation fence");
		await __ReconcileDeferredToolApprovalGrants(transaction, approval.siloId, approval.id, null, command.now);
		if (approval.elicitationRequestId === null)
			await _FinishDeferredToolApprovalBatch(transaction, approval.runId, approval.attempt, DeferredToolApprovalLifecycleEvents.Decision);
		return { outcome: DeferredToolDecisionOutcomes.Denied };
	}

	// 4. Validate the frozen schema and proposed arguments before an actor replacement becomes effective.
	//    The active computer lease is not compared here: the approval_requests trigger fences it once, on the update below.
	if (invocation.state !== ToolInvocationStates.AwaitingApproval)
		return { outcome: DeferredToolDecisionOutcomes.Conflict };
	const runSubject = ___ExecutionSubjectSchema.safeParse(run.executionSubject);
	const invocationSubject = invocation.authorizationEvidence !== null && "executionSubject" in invocation.authorizationEvidence ? ___ExecutionSubjectSchema.safeParse(invocation.authorizationEvidence.executionSubject) : null;
	if (!runSubject.success || invocationSubject === null || !invocationSubject.success
		|| __DigestCanonicalJson(runSubject.data as unknown as JsonValue) !== __DigestCanonicalJson(invocationSubject.data as unknown as JsonValue))
		return { outcome: DeferredToolDecisionOutcomes.Conflict };
	if (!replacementAllowed || command.arguments === undefined || command.arguments === null || typeof command.arguments !== "object" || Array.isArray(command.arguments) || !__ValidateDeferredToolArguments(reviewedSchema, command.arguments))
		return { outcome: DeferredToolDecisionOutcomes.InvalidArguments };
	const finalArguments = ___CloneCanonicalJson(command.arguments);
	const finalArgumentsDigest = __DigestCanonicalJson(finalArguments);

	// 5. Approve in one transaction so only the normalized reviewed arguments are the ones dispatch will use.
	const approved = await transaction.approvalRequest.updateMany({
		where: { id: command.approvalRequestId, state: ApprovalRequestState.Pending, expiresAt: { gt: command.now } },
		data: {
			state: ApprovalRequestState.Approved,
			decidedAt: command.now,
			decidedBy: command.decidedBy,
			finalArguments: finalArguments as unknown as Prisma.InputJsonValue,
			finalArgumentsDigest,
		},
	});
	if (approved.count !== 1)
		return _conflictOrExpire(transaction, command);
	if (!await __MarkToolInvocationApprovedInTransaction(transaction, invocation.id, approval.reviewedToolArguments as JsonValue, approval.argumentsDigest, finalArguments, finalArgumentsDigest))
		throw new Error("deferred approval lost its awaiting invocation fence");
	await __ReconcileDeferredToolApprovalGrants(transaction, approval.siloId, approval.id, null, command.now);
	if (approval.elicitationRequestId === null)
		await _FinishDeferredToolApprovalBatch(transaction, approval.runId, approval.attempt, DeferredToolApprovalLifecycleEvents.Decision);
	return { outcome: DeferredToolDecisionOutcomes.Approved, argumentsDigest: finalArgumentsDigest };
}

/** After the decision update matched no row: expire the request if its deadline has passed, otherwise report a conflict. */
async function _conflictOrExpire(transaction: Prisma.TransactionClient, command: DecideDeferredToolRequestCommand): Promise<DecideDeferredToolRequestResult>
{
	const approval = await transaction.approvalRequest.findUnique({ where: { id: command.approvalRequestId } });
	const requester = await transaction.principal.findFirst({ where: { siloId: command.siloId, subject: command.reviewerSubjectId }, select: { id: true } });
	if (approval === null || requester === null || approval.siloId !== command.siloId || approval.principalId !== requester.id || approval.state !== ApprovalRequestState.Pending || approval.expiresAt.getTime() > command.now.getTime())
		return { outcome: DeferredToolDecisionOutcomes.Conflict };
	return await _ExpireDeferredToolApproval(transaction, approval, command.now) ? { outcome: DeferredToolDecisionOutcomes.Expired } : { outcome: DeferredToolDecisionOutcomes.Conflict };
}
