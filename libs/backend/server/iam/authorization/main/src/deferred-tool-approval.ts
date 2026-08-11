import { AgentRunState, ApprovalRequestState, OrgMemberStatus, Prisma, WorkloadAssignmentState } from "@prisma/client";

import { ___CloneCanonicalJson, type JsonValue } from "@opencrane/util";

import { __DigestCanonicalJson } from "./canonical-json-digest.js";
import { __PlanDeferredToolApprovalLifecycle } from "./deferred-tool-approval-lifecycle.js";
import { __IsDeferredToolApprovalReplacementAllowed, __ProjectDeferredToolApproval, __ValidateDeferredToolArguments } from "./deferred-tool-approval-schema.js";
import { DeferredToolDecisionKinds, type DecideDeferredToolRequestCommand, type DecideDeferredToolRequestResult, type ExpireDeferredToolApprovalBatchCommand, type ExpireDeferredToolApprovalBatchResult } from "./deferred-tool-approval-decision.types.js";
import { DeferredToolApprovalLifecycleActions, DeferredToolApprovalLifecycleEvents, DeferredToolApprovalRunStates } from "./deferred-tool-approval-lifecycle.types.js";
import type { DeferToolRequestCommand, DeferToolRequestResult } from "./deferred-tool-approval-open.types.js";
import { ToolInvocationStates } from "./tool-invocation-lifecycle.types.js";
import { __FindToolInvocationInTransaction, __MarkToolInvocationApprovalRejectedInTransaction, __MarkToolInvocationApprovedInTransaction } from "./prisma-tool-invocation-repository.js";

/** Converts the only two run states that can have open approvals into the lifecycle enum; anything else gives null. */
function _approvalRunState(state: AgentRunState): DeferredToolApprovalRunStates | null
{
	if (state === AgentRunState.Running) return DeferredToolApprovalRunStates.Running;
	if (state === AgentRunState.WaitingForInput) return DeferredToolApprovalRunStates.WaitingForInput;
	return null;
}

/**
 * Pause one prepared tool invocation behind a new pending deferred-tool approval.
 *
 * This is the create half of the deferred-tool lifecycle: when the runtime external-action authority
 * returns `deferred` for an approval-gated tool, the composition root calls this to open the pending
 * {@link ApprovalRequest} bound to the awaiting ToolInvocation (`toolInvocationRowId`). It reuses the
 * existing approval table (no second approval model) rather than the capability-proof catalog path —
 * the workload/proof-key binding is copied from the live run so the approval is still bound to the
 * exact executing Pod, while the catalog columns stay null because a tool is not a signed capability.
 * Deferral is idempotent through the `(runId, attempt, actionDigest)` key: a repeated defer returns
 * the existing pending row rather than opening a second approval.
 *
 * @param transaction - Prisma transaction already holding the owning run's approval fence.
 * @param command - Awaiting invocation coordinates, tool identity, and expiry.
 * @returns The opened (or replayed) approval id, or `unavailable` when the live workload is absent.
 */
export async function __DeferToolRequest(transaction: Prisma.TransactionClient, command: DeferToolRequestCommand): Promise<DeferToolRequestResult>
{
	// 1. Bind the approval to the exact live workload and proof key executing the attempt.
	const assignment = await transaction.workloadAssignment.findUnique({ where: { runId_attempt: { runId: command.runId, attempt: command.attempt } } });
	const proofKey = await transaction.runProofKey.findUnique({ where: { runId_attempt: { runId: command.runId, attempt: command.attempt } } });
	if (assignment === null || proofKey === null || assignment.podUid === null || assignment.state !== WorkloadAssignmentState.Registered || assignment.expiresAt.getTime() <= command.now.getTime() || proofKey.revokedAt !== null || proofKey.expiresAt.getTime() <= command.now.getTime()) return { outcome: "unavailable" };
	if (assignment.subjectId.startsWith("agent-service:")) return { outcome: "unavailable" };
	const expiresAt = new Date(Math.min(command.expiresAt.getTime(), assignment.expiresAt.getTime(), proofKey.expiresAt.getTime()));
	if (expiresAt.getTime() <= command.now.getTime()) return { outcome: "unavailable" };
	const invocation = await __FindToolInvocationInTransaction(transaction, command.toolInvocationRowId);
	if (invocation === null || invocation.runId !== command.runId || invocation.attempt !== command.attempt || invocation.toolRevisionId !== command.toolRevisionId || invocation.argumentsDigest !== command.argumentsDigest || invocation.state !== ToolInvocationStates.AwaitingApproval) return { outcome: "unavailable" };

	// 2. Replay an exact existing defer before changing run state; digest collisions fail closed.
	const existing = await transaction.approvalRequest.findFirst({ where: { runId: command.runId, attempt: command.attempt, actionDigest: command.actionDigest } });
	if (existing !== null)
	{
		if (existing.id !== command.interruptId || existing.argumentsDigest !== command.argumentsDigest || existing.reviewedToolSchemaDigest !== command.reviewedParametersSchemaDigest) throw new Error("deferred approval action digest collision");
		return { outcome: "already_deferred", approvalRequestId: existing.id };
	}

	// 3. Move the run behind its approval fence before the first row becomes visible, or join its batch.
	const run = await transaction.agentRun.findUnique({ where: { id: command.runId } });
	if (run === null || run.attempt !== command.attempt) return { outcome: "unavailable" };
	const runState = _approvalRunState(run.state);
	if (runState === null) return { outcome: "unavailable" };
	const pendingCount = await transaction.approvalRequest.count({ where: { runId: command.runId, attempt: command.attempt, state: ApprovalRequestState.Pending } });
	const action = __PlanDeferredToolApprovalLifecycle({ runState, event: DeferredToolApprovalLifecycleEvents.Open, pendingCount });
	if (action === DeferredToolApprovalLifecycleActions.PauseAndOpen)
	{
		const paused = await transaction.agentRun.updateMany({ where: { id: command.runId, attempt: command.attempt, state: AgentRunState.Running }, data: { state: AgentRunState.WaitingForInput } });
		if (paused.count !== 1) return { outcome: "unavailable" };
	}
	else if (action !== DeferredToolApprovalLifecycleActions.OpenInBatch) return { outcome: "unavailable" };

	// 4. Open the pending approval only after the same transaction owns the waiting-state fence.
	try
	{
		const created = await transaction.approvalRequest.create({
			data: {
				id: command.interruptId,
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
				expiresAt,
				toolInvocationRowId: command.toolInvocationRowId,
				reviewedToolArguments: command.reviewedArguments as unknown as Prisma.InputJsonValue,
				reviewedToolSchema: command.reviewedParametersSchema as unknown as Prisma.InputJsonValue,
				reviewedToolSchemaDigest: command.reviewedParametersSchemaDigest,
				safeProposedArguments: command.safeProposedArguments as unknown as Prisma.InputJsonValue,
				responseSchema: command.responseSchema as unknown as Prisma.InputJsonValue,
			},
		});
		return { outcome: "deferred", approvalRequestId: created.id };
	}
	catch (error)
	{
		if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
		const raced = await transaction.approvalRequest.findFirst({ where: { runId: command.runId, attempt: command.attempt, actionDigest: command.actionDigest } });
		if (raced === null) throw error;
		if (raced.id !== command.interruptId || raced.argumentsDigest !== command.argumentsDigest || raced.reviewedToolSchemaDigest !== command.reviewedParametersSchemaDigest) throw error;
		return { outcome: "already_deferred", approvalRequestId: raced.id };
	}
}

/** Maps a decided approval state back to the stable decision literal, or null while still pending. */
function _decisionOf(state: ApprovalRequestState): DeferredToolDecisionKinds | null
{
	if (state === ApprovalRequestState.Approved) return DeferredToolDecisionKinds.Approved;
	if (state === ApprovalRequestState.Denied) return DeferredToolDecisionKinds.Denied;
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
	if (approval === null || approval.siloId !== command.siloId || approval.subjectId !== command.subjectId || approval.toolInvocationRowId === null) return { outcome: "conflict" };
	const membership = await transaction.orgMembership.findFirst({ where: { clusterTenant: command.siloId, subject: command.subjectId, status: OrgMemberStatus.Active } });
	const run = await transaction.agentRun.findUnique({ where: { id: approval.runId } });
	const invocation = await __FindToolInvocationInTransaction(transaction, approval.toolInvocationRowId);
	if (membership === null || run === null || run.attempt !== approval.attempt || run.state !== AgentRunState.WaitingForInput || invocation === null || invocation.runId !== approval.runId || invocation.attempt !== approval.attempt || invocation.toolRevisionId !== approval.resourceId || invocation.argumentsDigest !== approval.argumentsDigest) return { outcome: "conflict" };
	if (approval.reviewedToolArguments === null || approval.reviewedToolSchema === null || approval.reviewedToolSchemaDigest === null || approval.responseSchema === null) return { outcome: "conflict" };
	const reviewedSchema = approval.reviewedToolSchema as JsonValue;
	const reviewedArguments = approval.reviewedToolArguments as JsonValue;
	if (__DigestCanonicalJson(reviewedSchema) !== approval.reviewedToolSchemaDigest || !__ValidateDeferredToolArguments(reviewedSchema, reviewedArguments)) return { outcome: "conflict" };
	const projection = __ProjectDeferredToolApproval(reviewedSchema, reviewedArguments);
	if (__DigestCanonicalJson(approval.safeProposedArguments as JsonValue) !== __DigestCanonicalJson(projection.proposedArguments) || __DigestCanonicalJson(approval.responseSchema as JsonValue) !== __DigestCanonicalJson(projection.responseSchema)) return { outcome: "conflict" };
	const replacementAllowed = __IsDeferredToolApprovalReplacementAllowed(reviewedSchema);

	// 2. A previously decided request replays idempotently or conflicts on a differing outcome.
	const priorDecision = _decisionOf(approval.state);
	if (priorDecision !== null)
	{
		if (priorDecision !== command.decision) return { outcome: "conflict" };
		if (priorDecision === DeferredToolDecisionKinds.Denied) return command.arguments === undefined ? { outcome: "already_decided", decision: priorDecision } : { outcome: "conflict" };
		if (command.arguments === undefined) return { outcome: "conflict" };
		const digest = __DigestCanonicalJson(___CloneCanonicalJson(command.arguments));
		return digest === approval.finalArgumentsDigest ? { outcome: "already_decided", decision: priorDecision, argumentsDigest: digest } : { outcome: "conflict" };
	}
	if (approval.state !== ApprovalRequestState.Pending) return { outcome: "conflict" };
	if (approval.expiresAt.getTime() <= command.now.getTime())
	{
		return await _ExpireDeferredToolApproval(transaction, approval, command.now) ? { outcome: "expired" } : { outcome: "conflict" };
	}

	// 3. Denial writes the result delivery, then terminalises the waiting action with the real reason.
	if (command.decision === DeferredToolDecisionKinds.Denied)
	{
		if (command.arguments !== undefined) return { outcome: "invalid_arguments" };
		const denied = await transaction.approvalRequest.updateMany({
			where: { id: command.approvalRequestId, state: ApprovalRequestState.Pending, expiresAt: { gt: command.now } },
			data: { state: ApprovalRequestState.Denied, decidedAt: command.now, decidedBy: command.decidedBy },
		});
		if (denied.count !== 1) return _conflictOrExpire(transaction, command);
		if (!await __MarkToolInvocationApprovalRejectedInTransaction(transaction, invocation.id, command.now, "approval_denied")) throw new Error("deferred approval lost its awaiting invocation fence");
		await _FinishDeferredToolApprovalBatch(transaction, approval.runId, approval.attempt, DeferredToolApprovalLifecycleEvents.Decision);
		return { outcome: "denied" };
	}

	// 4. Validate the frozen schema and proposed arguments before an actor replacement becomes effective.
	if (invocation.state !== ToolInvocationStates.AwaitingApproval) return { outcome: "conflict" };
	if (!replacementAllowed || command.arguments === undefined || command.arguments === null || typeof command.arguments !== "object" || Array.isArray(command.arguments) || !__ValidateDeferredToolArguments(reviewedSchema, command.arguments)) return { outcome: "invalid_arguments" };
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
	if (approved.count !== 1) return _conflictOrExpire(transaction, command);
	if (!await __MarkToolInvocationApprovedInTransaction(transaction, invocation.id, approval.reviewedToolArguments as JsonValue, approval.argumentsDigest, finalArguments, finalArgumentsDigest)) throw new Error("deferred approval lost its awaiting invocation fence");
	await _FinishDeferredToolApprovalBatch(transaction, approval.runId, approval.attempt, DeferredToolApprovalLifecycleEvents.Decision);
	return { outcome: "approved", argumentsDigest: finalArgumentsDigest };
}
/** After the decision update matched no row: expire the request if its deadline has passed, otherwise report a conflict. */
async function _conflictOrExpire(transaction: Prisma.TransactionClient, command: DecideDeferredToolRequestCommand): Promise<DecideDeferredToolRequestResult>
{
	const approval = await transaction.approvalRequest.findUnique({ where: { id: command.approvalRequestId } });
	if (approval === null || approval.siloId !== command.siloId || approval.subjectId !== command.subjectId || approval.state !== ApprovalRequestState.Pending || approval.expiresAt.getTime() > command.now.getTime()) return { outcome: "conflict" };
	return await _ExpireDeferredToolApproval(transaction, approval, command.now) ? { outcome: "expired" } : { outcome: "conflict" };
}

/** Expires every approval past its deadline for this attempt, and resumes the run once none are left pending. */
export async function __ExpireDeferredToolApprovalBatch(transaction: Prisma.TransactionClient, command: ExpireDeferredToolApprovalBatchCommand): Promise<ExpireDeferredToolApprovalBatchResult>
{
	const run = await transaction.agentRun.findUnique({ where: { id: command.runId } });
	if (run === null || run.attempt !== command.attempt || run.state !== AgentRunState.WaitingForInput) return { expiredCount: 0, resumed: false };
	const due = await transaction.approvalRequest.findMany({ where: { runId: command.runId, attempt: command.attempt, state: ApprovalRequestState.Pending, expiresAt: { lte: command.now }, toolInvocationRowId: { not: null } }, orderBy: { id: "asc" } });
	let expiredCount = 0;
	for (const approval of due)
	{
		if (await _ExpireDeferredToolApproval(transaction, approval, command.now)) expiredCount += 1;
	}
	const after = await transaction.agentRun.findUnique({ where: { id: command.runId } });
	return { expiredCount, resumed: after?.state === AgentRunState.Running };
}

/**
 * Close one overdue approval, fail the tool call it was gating, and resume the run if it was the
 * last pending approval.
 *
 * Returns false without writing anything when the row was already decided by someone else.
 */
async function _ExpireDeferredToolApproval(transaction: Prisma.TransactionClient, approval: { id: string; runId: string; attempt: number; toolInvocationRowId: string | null }, now: Date): Promise<boolean>
{
	if (approval.toolInvocationRowId === null) return false;
	const expired = await transaction.approvalRequest.updateMany({ where: { id: approval.id, state: ApprovalRequestState.Pending, expiresAt: { lte: now } }, data: { state: ApprovalRequestState.Expired, decidedAt: now, decidedBy: null } });
	if (expired.count !== 1) return false;
	if (!await __MarkToolInvocationApprovalRejectedInTransaction(transaction, approval.toolInvocationRowId, now, "approval_expired")) throw new Error("expired approval lost its awaiting invocation fence");
	await _FinishDeferredToolApprovalBatch(transaction, approval.runId, approval.attempt, DeferredToolApprovalLifecycleEvents.Expiry);
	return true;
}

/** Leaves the run waiting while approvals are still pending, or moves it back to Running once the last one is resolved. */
async function _FinishDeferredToolApprovalBatch(transaction: Prisma.TransactionClient, runId: string, attempt: number, event: DeferredToolApprovalLifecycleEvents.Decision | DeferredToolApprovalLifecycleEvents.Expiry): Promise<void>
{
	const pendingCount = await transaction.approvalRequest.count({ where: { runId, attempt, state: ApprovalRequestState.Pending } });
	const action = __PlanDeferredToolApprovalLifecycle({ runState: DeferredToolApprovalRunStates.WaitingForInput, event, pendingCount });
	if (action === DeferredToolApprovalLifecycleActions.KeepWaiting) return;
	if (action !== DeferredToolApprovalLifecycleActions.Resume) throw new Error("deferred approval batch has no valid lifecycle action");
	const resumed = await transaction.agentRun.updateMany({ where: { id: runId, attempt, state: AgentRunState.WaitingForInput }, data: { state: AgentRunState.Running } });
	if (resumed.count !== 1) throw new Error("deferred approval lost its waiting run fence");
}
