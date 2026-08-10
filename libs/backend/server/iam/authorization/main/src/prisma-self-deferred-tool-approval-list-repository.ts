import { ApprovalRequestState, type Prisma } from "@prisma/client";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import type { JsonValue } from "@opencrane/util";

import { DeferredToolApprovalStates, type SelfDeferredToolApproval, type SelfDeferredToolApprovalListRepository } from "./deferred-tool-approval.types.js";

/** Exact actor-safe columns selected for an owned tool approval. */
type SafeApprovalRow = {
	/** Interrupt identifier and ApprovalRequest primary key. */
	readonly id: string;
	/** Logical run owning the interrupt. */
	readonly runId: string;
	/** Positive attempt owning the interrupt. */
	readonly attempt: number;
	/** Frozen tool revision being reviewed. */
	readonly resourceId: string;
	/** Safe logical identifier from the exact linked tool invocation. */
	readonly toolInvocation: { readonly toolInvocationId: string } | null;
	/** Durable approval lifecycle state. */
	readonly state: ApprovalRequestState;
	/** Pre-redacted proposed arguments; never the server-only reviewed arguments. */
	readonly safeProposedArguments: Prisma.JsonValue | null;
	/** Pre-derived decision schema; never the raw resume material. */
	readonly responseSchema: Prisma.JsonValue | null;
	/** Server-owned decision deadline. */
	readonly expiresAt: Date;
	/** Server-owned creation instant. */
	readonly createdAt: Date;
};

/** Fields the actor reader is permitted to select from the approval authority. */
const _SAFE_SELECT = { id: true, runId: true, attempt: true, resourceId: true, state: true, safeProposedArguments: true, responseSchema: true, expiresAt: true, createdAt: true, toolInvocation: { select: { toolInvocationId: true } } } as const;

/** Prisma reader for the signed-in owner's approval inbox and interrupt detail. */
export class PrismaSelfDeferredToolApprovalListRepository implements SelfDeferredToolApprovalListRepository
{
	/** Canonical product authority used for owner-bound approval reads. */
	private readonly _prisma: Prisma.TransactionClient;

	/** Construct the approval reader around the server-owned Prisma client. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this._prisma = prisma;
	}

	/** List the latest fifty still-pending deferred tool approvals for one exact owner and silo. */
	async listPendingOwned(siloId: string, subjectId: string, now: Date): Promise<readonly SelfDeferredToolApproval[]>
	{
		const prisma = this._prisma;
		return ___DoWithTrace("approval.list.db", { siloId, subjectId }, async function _traceListDb()
		{
			const approvals = await prisma.approvalRequest.findMany({ where: { siloId, subjectId, state: ApprovalRequestState.Pending, expiresAt: { gt: now }, toolInvocationRowId: { not: null } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50, select: _SAFE_SELECT });
			return approvals.map(function _map(approval) { return _toSelfDeferredToolApproval(approval, now); });
		});
	}

	/** List current approval overlays only for a run bound to the requested conversation. */
	async listPendingOwnedForConversation(conversationId: string, siloId: string, subjectId: string, now: Date): Promise<readonly SelfDeferredToolApproval[]>
	{
		const prisma = this._prisma;
		return ___DoWithTrace("approval.list_conversation.db", { siloId, subjectId, conversationId }, async function _traceConversationListDb()
		{
			const approvals = await prisma.approvalRequest.findMany({ where: { siloId, subjectId, state: ApprovalRequestState.Pending, expiresAt: { gt: now }, toolInvocationRowId: { not: null }, run: { conversationId } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 50, select: _SAFE_SELECT });
			return approvals.map(function _map(approval) { return _toSelfDeferredToolApproval(approval, now); });
		});
	}

	/** Read one actor-owned deferred tool interrupt without selecting server-only authority fields. */
	async readOwned(approvalRequestId: string, siloId: string, subjectId: string, now: Date): Promise<SelfDeferredToolApproval | null>
	{
		const prisma = this._prisma;
		return ___DoWithTrace("approval.read.db", { siloId, subjectId }, async function _traceReadDb()
		{
			const approval = await prisma.approvalRequest.findFirst({ where: { id: approvalRequestId, siloId, subjectId, toolInvocationRowId: { not: null } }, select: _SAFE_SELECT });
			return approval === null ? null : _toSelfDeferredToolApproval(approval, now);
		});
	}
}

/** Map a durable state into the actor-facing state, deriving an overdue pending row as expired. */
function _state(approval: SafeApprovalRow, now: Date): DeferredToolApprovalStates
{
	if (approval.state === ApprovalRequestState.Pending) return approval.expiresAt.getTime() <= now.getTime() ? DeferredToolApprovalStates.Expired : DeferredToolApprovalStates.Pending;
	if (approval.state === ApprovalRequestState.Approved) return DeferredToolApprovalStates.Approved;
	if (approval.state === ApprovalRequestState.Denied) return DeferredToolApprovalStates.Denied;
	if (approval.state === ApprovalRequestState.Expired) return DeferredToolApprovalStates.Expired;
	return DeferredToolApprovalStates.Cancelled;
}

/** Map only pre-redacted durable fields to the actor's approval projection. */
function _toSelfDeferredToolApproval(approval: SafeApprovalRow, now: Date): SelfDeferredToolApproval
{
	if (approval.toolInvocation === null) throw new Error("deferred tool approval is missing its invocation linkage");
	return {
		approvalRequestId: approval.id,
		runId: approval.runId,
		attempt: approval.attempt,
		toolRevisionId: approval.resourceId,
		toolInvocationId: approval.toolInvocation.toolInvocationId,
		state: _state(approval, now),
		proposedArguments: approval.safeProposedArguments as JsonValue,
		responseSchema: approval.responseSchema as JsonValue,
		expiresAt: approval.expiresAt.toISOString(),
		createdAt: approval.createdAt.toISOString(),
	};
}
