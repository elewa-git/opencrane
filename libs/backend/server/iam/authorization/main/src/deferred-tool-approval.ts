import { ApprovalRequestState, Prisma } from "@prisma/client";

import type { JsonValue } from "@opencrane/util";

import type { DecideDeferredToolRequestCommand, DecideDeferredToolRequestResult, DeferredToolDecision, DeferToolRequestCommand, DeferToolRequestResult } from "./deferred-tool-approval.types.js";

/**
 * Pause one reserved tool invocation behind a new pending deferred-tool approval.
 *
 * This is the create half of the deferred-tool lifecycle: when the runtime external-action authority
 * returns `deferred` for an approval-gated tool, the composition root calls this to open the pending
 * {@link ApprovalRequest} bound to the reserved ToolInvocation (`toolInvocationRowId`). It reuses the
 * existing approval table (no second approval model) rather than the capability-proof catalog path —
 * the workload/proof-key binding is copied from the live run so the approval is still bound to the
 * exact executing Pod, while the catalog columns stay null because a tool is not a signed capability.
 * Deferral is idempotent through the `(runId, attempt, actionDigest)` key: a repeated defer returns
 * the existing pending row rather than opening a second approval.
 *
 * @param transaction - Prisma transaction already holding the owning run's approval fence.
 * @param command - Reserved invocation coordinates, tool identity, and expiry.
 * @returns The opened (or replayed) approval id, or `unavailable` when the live workload is absent.
 */
export async function __DeferToolRequest(transaction: Prisma.TransactionClient, command: DeferToolRequestCommand): Promise<DeferToolRequestResult>
{
	// 1. Bind the approval to the exact live workload and proof key executing the attempt.
	const assignment = await transaction.workloadAssignment.findUnique({ where: { runId_attempt: { runId: command.runId, attempt: command.attempt } } });
	const proofKey = await transaction.runProofKey.findUnique({ where: { runId_attempt: { runId: command.runId, attempt: command.attempt } } });
	if (assignment === null || proofKey === null || assignment.podUid === null) return { outcome: "unavailable" };

	// 2. Open the pending approval; a duplicate defer for the same action replays the existing row.
	try
	{
		const created = await transaction.approvalRequest.create({
			data: {
				runId: command.runId,
				attempt: command.attempt,
				agentRevisionId: assignment.agentRevisionId,
				agentServiceId: assignment.agentServiceId,
				siloId: assignment.siloId,
				proofKeyId: proofKey.id,
				proofKeyThumbprint: proofKey.keyThumbprint,
				subjectId: assignment.subjectId,
				workloadAudience: assignment.audience,
				serviceAccountName: assignment.serviceAccountName,
				namespace: assignment.namespace,
				workloadKind: assignment.workloadKind,
				workloadUid: assignment.workloadUid,
				podUid: assignment.podUid,
				resourceKind: "tool",
				resourceId: command.toolRevisionId,
				action: "invoke",
				argumentsDigest: command.argumentsDigest,
				actionDigest: command.actionDigest,
				approverPolicyRevision: command.approverPolicyRevision,
				effectivePolicyDigest: command.effectivePolicyDigest,
				state: ApprovalRequestState.Pending,
				expiresAt: command.expiresAt,
				toolInvocationRowId: command.toolInvocationRowId,
			},
		});
		return { outcome: "deferred", approvalRequestId: created.id };
	}
	catch (error)
	{
		if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
		const existing = await transaction.approvalRequest.findFirst({ where: { runId: command.runId, attempt: command.attempt, actionDigest: command.actionDigest } });
		if (existing === null) throw error;
		return { outcome: "already_deferred", approvalRequestId: existing.id };
	}
}

/** Maps a decided approval state back to the stable decision literal, or null while still pending. */
function _decisionOf(state: ApprovalRequestState): DeferredToolDecision | null
{
	if (state === ApprovalRequestState.Approved) return "approved";
	if (state === ApprovalRequestState.Denied) return "denied";
	return null;
}

/**
 * Decide one pending deferred tool request inside a caller-owned transaction.
 *
 * This extends the existing {@link ApprovalRequest} lifecycle for the deferred-tool flow: a runtime
 * external action that requires approval reserves its ToolInvocation, pauses (DeferredToolRequests),
 * and a reviewer calls this to move the pending row to Approved or Denied. Approval records the
 * authorized DeferredToolResults and the single-use resume-token hash so exactly one `resume_attempt`
 * can feed the result back; denial closes the request. Deciding is idempotent — re-deciding the same
 * way returns `already_decided`, and any conflicting decision (different outcome, or a row that was
 * cancelled/expired out from under the reviewer) returns `conflict` rather than mutating a terminal
 * approval. The caller commits this in the same transaction that transitions the owning run state.
 *
 * The browser-facing Phase F decision route supplies only an authenticated owner, a silo, and the
 * terminal choice. This authority rechecks that ownership against the durable row and mints no
 * browser-controlled result or resume credential, so a caller cannot redirect a pending action.
 *
 * @param transaction - Prisma transaction already holding the owning run's approval fence.
 * @param command - Exact pending request, reviewer decision, and trusted instant.
 * @returns The authorized deferred result on approval, a denial, an idempotent replay, or a conflict.
 */
export async function __DecideDeferredToolRequest(transaction: Prisma.TransactionClient, command: DecideDeferredToolRequestCommand): Promise<DecideDeferredToolRequestResult>
{
	// 1. Lock and reload the exact approval row bound to the run attempt before any state change.
	const approval = await transaction.approvalRequest.findUnique({ where: { id: command.approvalRequestId } });
	if (approval === null || approval.siloId !== command.siloId || approval.subjectId !== command.subjectId || approval.toolInvocationRowId === null) return { outcome: "conflict" };

	// 2. A previously decided request replays idempotently or conflicts on a differing outcome.
	const priorDecision = _decisionOf(approval.state);
	if (priorDecision !== null) return priorDecision === command.decision ? { outcome: "already_decided", decision: priorDecision } : { outcome: "conflict" };
	if (approval.state !== ApprovalRequestState.Pending) return { outcome: "conflict" };
	if (approval.expiresAt.getTime() <= command.now.getTime())
	{
		const expired = await transaction.approvalRequest.updateMany({
			where: { id: command.approvalRequestId, state: ApprovalRequestState.Pending, expiresAt: { lte: command.now } },
			data: { state: ApprovalRequestState.Expired, decidedAt: command.now, decidedBy: null, resumeTokenHash: null },
		});
		return expired.count === 1 ? { outcome: "expired" } : { outcome: "conflict" };
	}

	// 3. Deny by closing the pending row; no result and no resume token are recorded.
	if (command.decision === "denied")
	{
		const denied = await transaction.approvalRequest.updateMany({
			where: { id: command.approvalRequestId, state: ApprovalRequestState.Pending, expiresAt: { gt: command.now } },
			data: { state: ApprovalRequestState.Denied, decidedAt: command.now, decidedBy: command.decidedBy },
		});
		return denied.count === 1 ? { outcome: "denied" } : _conflictOrExpire(transaction, command);
	}

	// 4. Join the reserved ToolInvocation so the recorded result names the exact pending tool call the
	// runtime must map the approval back to. A missing reservation row is a broken linkage: conflict,
	// never an approval whose resume payload the runtime could not act on.
	const invocation = await transaction.toolInvocation.findUnique({ where: { id: approval.toolInvocationRowId } });
	if (invocation === null || invocation.runId !== approval.runId || invocation.attempt !== approval.attempt) return { outcome: "conflict" };

	// 5. Approve atomically, recording the authorized deferred result and single-use resume-token hash.
	const suppliedResult = command.deferredToolResult;
	const deferredToolResult: JsonValue = { ...(suppliedResult !== undefined && suppliedResult !== null && typeof suppliedResult === "object" && !Array.isArray(suppliedResult) ? suppliedResult : {}), toolInvocationId: invocation.toolInvocationId };
	const approved = await transaction.approvalRequest.updateMany({
		where: { id: command.approvalRequestId, state: ApprovalRequestState.Pending, expiresAt: { gt: command.now } },
		data: {
			state: ApprovalRequestState.Approved,
			decidedAt: command.now,
			decidedBy: command.decidedBy,
			resumeTokenHash: command.resumeTokenHash ?? null,
			deferredToolResult: deferredToolResult as unknown as Prisma.InputJsonValue,
		},
	});
	return approved.count === 1 ? { outcome: "approved", deferredToolResult } : _conflictOrExpire(transaction, command);
}
/** Terminalise a just-expired owner-bound request after a decision compare-and-set loses its fence. */
async function _conflictOrExpire(transaction: Prisma.TransactionClient, command: DecideDeferredToolRequestCommand): Promise<DecideDeferredToolRequestResult>
{
	const approval = await transaction.approvalRequest.findUnique({ where: { id: command.approvalRequestId } });
	if (approval === null || approval.siloId !== command.siloId || approval.subjectId !== command.subjectId || approval.state !== ApprovalRequestState.Pending || approval.expiresAt.getTime() > command.now.getTime()) return { outcome: "conflict" };
	const expired = await transaction.approvalRequest.updateMany({
		where: { id: command.approvalRequestId, state: ApprovalRequestState.Pending, expiresAt: { lte: command.now } },
		data: { state: ApprovalRequestState.Expired, decidedAt: command.now, decidedBy: null, resumeTokenHash: null },
	});
	return expired.count === 1 ? { outcome: "expired" } : { outcome: "conflict" };
}
