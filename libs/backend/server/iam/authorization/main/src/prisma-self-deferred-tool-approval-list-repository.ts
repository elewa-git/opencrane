import { ApprovalRequestState, OrgMemberStatus, Prisma, type PrismaClient } from "@prisma/client";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import type { JsonValue } from "@opencrane/util";

import { DeferredToolApprovalStates, type SelfDeferredToolApproval, type SelfDeferredToolApprovalListRepository, type SelfDeferredToolApprovalReadUnitOfWork } from "./deferred-tool-approval-interrupt.types.js";

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
	/** Tool-call id from the linked invocation row. */
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
	/** Prisma client used to read only the caller's own approvals. */
	private readonly _prisma: Prisma.TransactionClient;

	/** Construct the approval reader around the server-owned Prisma client. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this._prisma = prisma;
	}

	/** Prove the caller still owns one active local membership in the exact silo. */
	async hasActiveMembership(siloId: string, subjectId: string): Promise<boolean>
	{
		const membership = await this._prisma.orgMembership.findFirst({ where: { clusterTenant: siloId, subject: subjectId, status: OrgMemberStatus.Active }, select: { id: true } });
		return membership !== null;
	}

	/** List the latest fifty still-pending deferred tool approvals for one exact owner and silo. */
	async listPendingOwned(siloId: string, subjectId: string, now: Date): Promise<readonly SelfDeferredToolApproval[]>
	{
		const approvals = await this._prisma.approvalRequest.findMany({ where: { siloId, subjectId, state: ApprovalRequestState.Pending, expiresAt: { gt: now }, toolInvocationRowId: { not: null } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50, select: _SAFE_SELECT });
		return approvals.map(function _map(approval) { return _toSelfDeferredToolApproval(approval, now); });
	}

	/** List current approval overlays only for a run bound to the requested conversation. */
	async listPendingOwnedForConversation(conversationId: string, siloId: string, subjectId: string, now: Date): Promise<readonly SelfDeferredToolApproval[]>
	{
		const approvals = await this._prisma.approvalRequest.findMany({ where: { siloId, subjectId, state: ApprovalRequestState.Pending, expiresAt: { gt: now }, toolInvocationRowId: { not: null }, run: { conversationId } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 50, select: _SAFE_SELECT });
		return approvals.map(function _map(approval) { return _toSelfDeferredToolApproval(approval, now); });
	}

	/** Read one actor-owned deferred tool interrupt without selecting server-only authority fields. */
	async readOwned(approvalRequestId: string, siloId: string, subjectId: string, now: Date): Promise<SelfDeferredToolApproval | null>
	{
		const approval = await this._prisma.approvalRequest.findFirst({ where: { id: approvalRequestId, siloId, subjectId, toolInvocationRowId: { not: null } }, select: _SAFE_SELECT });
		return approval === null ? null : _toSelfDeferredToolApproval(approval, now);
	}
}

/** Checks the caller's membership and reads their approvals in one serializable transaction. */
export class PrismaSelfDeferredToolApprovalReadUnitOfWork implements SelfDeferredToolApprovalReadUnitOfWork
{
	/** Process-owned Prisma root used only to start exact serializable read transactions. */
	private readonly _prisma: PrismaClient;

	/** Build the read UnitOfWork over the Prisma client. */
	constructor(prisma: PrismaClient)
	{
		this._prisma = prisma;
	}

	/** List actor-owned pending approvals under one current membership snapshot. */
	async listPendingOwned(siloId: string, subjectId: string, now: Date): Promise<readonly SelfDeferredToolApproval[]>
	{
		return this._read("approval.list.db", { siloId, subjectId }, async function _list(repository) { return repository.listPendingOwned(siloId, subjectId, now); }, []);
	}

	/** List conversation overlays under one current membership snapshot. */
	async listPendingOwnedForConversation(conversationId: string, siloId: string, subjectId: string, now: Date): Promise<readonly SelfDeferredToolApproval[]>
	{
		return this._read("approval.list_conversation.db", { siloId, subjectId, conversationId }, async function _list(repository) { return repository.listPendingOwnedForConversation(conversationId, siloId, subjectId, now); }, []);
	}

	/** Read one actor-owned approval under one current membership snapshot. */
	async readOwned(approvalRequestId: string, siloId: string, subjectId: string, now: Date): Promise<SelfDeferredToolApproval | null>
	{
		return this._read("approval.read.db", { siloId, subjectId }, async function _read(repository) { return repository.readOwned(approvalRequestId, siloId, subjectId, now); }, null);
	}

	/** Run one actor-safe read only after membership succeeds inside the same transaction. */
	private async _read<TResult>(operation: string, attributes: Record<string, string>, read: (repository: SelfDeferredToolApprovalListRepository) => Promise<TResult>, denied: TResult): Promise<TResult>
	{
		const prisma = this._prisma;
		return ___DoWithTrace(operation, attributes, async function _traceReadDb()
		{
			return prisma.$transaction(async function _membershipSnapshot(transaction): Promise<TResult>
			{
				const repository = new PrismaSelfDeferredToolApprovalListRepository(transaction);
				return await repository.hasActiveMembership(attributes["siloId"] ?? "", attributes["subjectId"] ?? "") ? read(repository) : denied;
			}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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
