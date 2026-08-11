import { ActionExecutionState, AgentRunState, ApprovalRequestState, OrgMemberStatus, Prisma, WorkloadAssignmentState } from "@prisma/client";

import { ___CloneCanonicalJson, type JsonValue } from "@opencrane/util";

import { __DigestCanonicalJson } from "./canonical-json-digest.js";
import { __PlanDeferredToolApprovalLifecycle } from "./deferred-tool-approval-lifecycle.js";
import { __ValidateDeferredToolArguments } from "./deferred-tool-approval-schema.js";
import { DeferredToolDecisionKinds, type DecideDeferredToolRequestCommand, type DecideDeferredToolRequestResult, type ExpireDeferredToolApprovalBatchCommand, type ExpireDeferredToolApprovalBatchResult } from "./deferred-tool-approval-decision.types.js";
import { DeferredToolApprovalStates } from "./deferred-tool-approval-interrupt.types.js";
import { DeferredToolApprovalLifecycleActions, DeferredToolApprovalLifecycleEvents, DeferredToolApprovalRunStates } from "./deferred-tool-approval-lifecycle.types.js";
import type { DeferToolRequestCommand, DeferToolRequestResult } from "./deferred-tool-approval-open.types.js";

/** Map the two run states that may own a live approval batch into the lifecycle authority. */
function _approvalRunState(state: AgentRunState): DeferredToolApprovalRunStates | null
{
	if (state === AgentRunState.Running) return DeferredToolApprovalRunStates.Running;
	if (state === AgentRunState.WaitingForApproval) return DeferredToolApprovalRunStates.WaitingForApproval;
	return null;
}

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
	if (assignment === null || proofKey === null || assignment.podUid === null || assignment.state !== WorkloadAssignmentState.Registered || assignment.expiresAt.getTime() <= command.now.getTime() || proofKey.revokedAt !== null || proofKey.expiresAt.getTime() <= command.now.getTime()) return { outcome: "unavailable" };
	if (assignment.subjectId.startsWith("agent-service:")) return { outcome: "unavailable" };
	const expiresAt = new Date(Math.min(command.expiresAt.getTime(), assignment.expiresAt.getTime(), proofKey.expiresAt.getTime()));
	if (expiresAt.getTime() <= command.now.getTime()) return { outcome: "unavailable" };

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
		const paused = await transaction.agentRun.updateMany({ where: { id: command.runId, attempt: command.attempt, state: AgentRunState.Running }, data: { state: AgentRunState.WaitingForApproval } });
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
	// 1. Reload owner, membership, waiting run, approval, and invocation inside one serializable unit.
	const approval = await transaction.approvalRequest.findUnique({ where: { id: command.approvalRequestId } });
	if (approval === null || approval.siloId !== command.siloId || approval.subjectId !== command.subjectId || approval.toolInvocationRowId === null) return { outcome: "conflict" };
	const membership = await transaction.orgMembership.findFirst({ where: { clusterTenant: command.siloId, subject: command.subjectId, status: OrgMemberStatus.Active } });
	const run = await transaction.agentRun.findUnique({ where: { id: approval.runId } });
	const invocation = await transaction.toolInvocation.findUnique({ where: { id: approval.toolInvocationRowId } });
	if (membership === null || run === null || run.attempt !== approval.attempt || run.state !== AgentRunState.WaitingForApproval || invocation === null || invocation.runId !== approval.runId || invocation.attempt !== approval.attempt || invocation.toolRevisionId !== approval.resourceId || invocation.argumentsDigest !== approval.argumentsDigest) return { outcome: "conflict" };

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

	// 3. Denial records an explicit resume result and terminalises the reserved action truthfully.
	if (command.decision === DeferredToolDecisionKinds.Denied)
	{
		if (command.arguments !== undefined) return { outcome: "invalid_arguments" };
		const resumeTokenHash = __DigestCanonicalJson({ approvalRequestId: approval.id, decision: DeferredToolDecisionKinds.Denied, decidedAt: command.now.toISOString() });
		const denied = await transaction.approvalRequest.updateMany({
			where: { id: command.approvalRequestId, state: ApprovalRequestState.Pending, expiresAt: { gt: command.now } },
			data: { state: ApprovalRequestState.Denied, decidedAt: command.now, decidedBy: command.decidedBy, resumeTokenHash },
		});
		if (denied.count !== 1) return _conflictOrExpire(transaction, command);
		const failed = await transaction.toolInvocation.updateMany({ where: { id: invocation.id, state: ActionExecutionState.Reserved }, data: { state: ActionExecutionState.Failed, failureCode: "approval_denied", completedAt: command.now } });
		if (failed.count !== 1) throw new Error("deferred approval lost its reserved invocation fence");
		await _FinishDeferredToolApprovalBatch(transaction, approval.runId, approval.attempt, DeferredToolApprovalLifecycleEvents.Decision);
		return { outcome: "denied" };
	}

	// 4. Join the reserved ToolInvocation so the recorded result names the exact pending tool call the
	// runtime must map the approval back to. A missing reservation row is a broken linkage: conflict,
	// never an approval whose resume payload the runtime could not act on.
	if (invocation.state !== ActionExecutionState.Reserved || approval.reviewedToolSchema === null || approval.reviewedToolSchemaDigest === null || __DigestCanonicalJson(approval.reviewedToolSchema as JsonValue) !== approval.reviewedToolSchemaDigest) return { outcome: "conflict" };
	if (command.arguments === undefined || command.arguments === null || typeof command.arguments !== "object" || Array.isArray(command.arguments) || !__ValidateDeferredToolArguments(approval.reviewedToolSchema as JsonValue, command.arguments)) return { outcome: "invalid_arguments" };
	const finalArguments = ___CloneCanonicalJson(command.arguments);
	const finalArgumentsDigest = __DigestCanonicalJson(finalArguments);
	const resumeTokenHash = __DigestCanonicalJson({ approvalRequestId: approval.id, argumentsDigest: finalArgumentsDigest, decidedBy: command.decidedBy, decidedAt: command.now.toISOString() });

	// 5. Approve atomically, persisting the exact normalized replacement and one resume marker.
	const approved = await transaction.approvalRequest.updateMany({
		where: { id: command.approvalRequestId, state: ApprovalRequestState.Pending, expiresAt: { gt: command.now } },
		data: {
			state: ApprovalRequestState.Approved,
			decidedAt: command.now,
			decidedBy: command.decidedBy,
			resumeTokenHash,
			finalArguments: finalArguments as unknown as Prisma.InputJsonValue,
			finalArgumentsDigest,
		},
	});
	if (approved.count !== 1) return _conflictOrExpire(transaction, command);
	await _FinishDeferredToolApprovalBatch(transaction, approval.runId, approval.attempt, DeferredToolApprovalLifecycleEvents.Decision);
	return { outcome: "approved", argumentsDigest: finalArgumentsDigest };
}
/** Terminalise a just-expired owner-bound request after a decision compare-and-set loses its fence. */
async function _conflictOrExpire(transaction: Prisma.TransactionClient, command: DecideDeferredToolRequestCommand): Promise<DecideDeferredToolRequestResult>
{
	const approval = await transaction.approvalRequest.findUnique({ where: { id: command.approvalRequestId } });
	if (approval === null || approval.siloId !== command.siloId || approval.subjectId !== command.subjectId || approval.state !== ApprovalRequestState.Pending || approval.expiresAt.getTime() > command.now.getTime()) return { outcome: "conflict" };
	return await _ExpireDeferredToolApproval(transaction, approval, command.now) ? { outcome: "expired" } : { outcome: "conflict" };
}

/** Close every due request for one waiting attempt and resume only after its final pending row. */
export async function __ExpireDeferredToolApprovalBatch(transaction: Prisma.TransactionClient, command: ExpireDeferredToolApprovalBatchCommand): Promise<ExpireDeferredToolApprovalBatchResult>
{
	const run = await transaction.agentRun.findUnique({ where: { id: command.runId } });
	if (run === null || run.attempt !== command.attempt || run.state !== AgentRunState.WaitingForApproval) return { expiredCount: 0, resumed: false };
	const due = await transaction.approvalRequest.findMany({ where: { runId: command.runId, attempt: command.attempt, state: ApprovalRequestState.Pending, expiresAt: { lte: command.now }, toolInvocationRowId: { not: null } }, orderBy: { id: "asc" } });
	let expiredCount = 0;
	for (const approval of due)
	{
		if (await _ExpireDeferredToolApproval(transaction, approval, command.now)) expiredCount += 1;
	}
	const after = await transaction.agentRun.findUnique({ where: { id: command.runId } });
	return { expiredCount, resumed: after?.state === AgentRunState.Running };
}

/** Expire one pending approval, fail its reservation, and apply the batch-resume strategy. */
async function _ExpireDeferredToolApproval(transaction: Prisma.TransactionClient, approval: { id: string; runId: string; attempt: number; toolInvocationRowId: string | null }, now: Date): Promise<boolean>
{
	if (approval.toolInvocationRowId === null) return false;
	const resumeTokenHash = __DigestCanonicalJson({ approvalRequestId: approval.id, decision: DeferredToolApprovalStates.Expired, decidedAt: now.toISOString() });
	const expired = await transaction.approvalRequest.updateMany({ where: { id: approval.id, state: ApprovalRequestState.Pending, expiresAt: { lte: now } }, data: { state: ApprovalRequestState.Expired, decidedAt: now, decidedBy: null, resumeTokenHash } });
	if (expired.count !== 1) return false;
	const failed = await transaction.toolInvocation.updateMany({ where: { id: approval.toolInvocationRowId, runId: approval.runId, attempt: approval.attempt, state: ActionExecutionState.Reserved }, data: { state: ActionExecutionState.Failed, failureCode: "approval_expired", completedAt: now } });
	if (failed.count !== 1) throw new Error("expired approval lost its reserved invocation fence");
	await _FinishDeferredToolApprovalBatch(transaction, approval.runId, approval.attempt, DeferredToolApprovalLifecycleEvents.Expiry);
	return true;
}

/** Keep the run waiting while requests remain, or atomically resume after the final result marker. */
async function _FinishDeferredToolApprovalBatch(transaction: Prisma.TransactionClient, runId: string, attempt: number, event: DeferredToolApprovalLifecycleEvents.Decision | DeferredToolApprovalLifecycleEvents.Expiry): Promise<void>
{
	const pendingCount = await transaction.approvalRequest.count({ where: { runId, attempt, state: ApprovalRequestState.Pending } });
	const action = __PlanDeferredToolApprovalLifecycle({ runState: DeferredToolApprovalRunStates.WaitingForApproval, event, pendingCount });
	if (action === DeferredToolApprovalLifecycleActions.KeepWaiting) return;
	if (action !== DeferredToolApprovalLifecycleActions.Resume) throw new Error("deferred approval batch has no valid lifecycle action");
	const resumed = await transaction.agentRun.updateMany({ where: { id: runId, attempt, state: AgentRunState.WaitingForApproval }, data: { state: AgentRunState.Running } });
	if (resumed.count !== 1) throw new Error("deferred approval lost its waiting run fence");
}
