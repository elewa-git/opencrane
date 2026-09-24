import { ElicitationApprovalGrantScope, ElicitationApprovalGrantState, ElicitationPurpose, type Prisma } from "@prisma/client";

import { ElicitationApprovalScopes, ElicitationPurposes } from "@opencrane/contracts";

import type { ApprovalGrantCoordinates, ApprovalGrantRepository, LiveApprovalGrant, MintApprovalGrantCommand } from "./elicitation-approval-grant.types";

/*
 * Reads and writes for the standing approval grants that let a question stop being asked.
 *
 * A grant is written only when an approval is answered "this session" or "every time", and is read
 * back by whichever gate minted it before that gate opens another question. Everything here runs on
 * the caller's transaction, so a grant and the decision that produced it commit together.
 */

/** Translate the public purpose to its durable spelling. */
function _Purpose(purpose: ElicitationPurposes): ElicitationPurpose
{
	return { [ElicitationPurposes.RuntimeInput]: ElicitationPurpose.RuntimeInput, [ElicitationPurposes.ToolApproval]: ElicitationPurpose.ToolApproval, [ElicitationPurposes.PersonalMemoryPermission]: ElicitationPurpose.PersonalMemoryPermission, [ElicitationPurposes.A2uiAction]: ElicitationPurpose.A2uiAction }[purpose];
}

/** Translate the public scope to its durable spelling. */
function _GrantScope(scope: ElicitationApprovalScopes.Session | ElicitationApprovalScopes.Always): ElicitationApprovalGrantScope
{
	return scope === ElicitationApprovalScopes.Session ? ElicitationApprovalGrantScope.Session : ElicitationApprovalGrantScope.Always;
}

/** Translate the durable scope back to the public one. */
function _PublicScope(scope: ElicitationApprovalGrantScope): ElicitationApprovalScopes.Session | ElicitationApprovalScopes.Always
{
	return scope === ElicitationApprovalGrantScope.Session ? ElicitationApprovalScopes.Session : ElicitationApprovalScopes.Always;
}

/** Prisma authority over standing approval grants, bound to one transaction. */
export class PrismaApprovalGrantRepository implements ApprovalGrantRepository
{
	/** Exact transaction every read and write runs on. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Bind every grant operation to one transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/**
	 * Write the grant behind one answered question.
	 *
	 * Keyed on the originating request, so replaying the same answer inside a retried transaction
	 * leaves exactly one grant rather than a second identical row. A session grant without a
	 * conversation is refused: it would otherwise match every conversation and behave as `Always`.
	 */
	async mint(command: MintApprovalGrantCommand): Promise<boolean>
	{
		if (command.scope === ElicitationApprovalScopes.Session && command.conversationId === null)
			return false;
		await this._transaction.elicitationApprovalGrant.upsert({
			where: { grantedFromId: command.requestId },
			update: {},
			create: {
				siloId: command.siloId,
				purpose: _Purpose(command.purpose),
				subjectId: command.subjectId,
				resourceKind: command.resourceKind,
				resourceId: command.resourceId,
				action: command.action,
				scope: _GrantScope(command.scope),
				conversationId: command.scope === ElicitationApprovalScopes.Session ? command.conversationId : null,
				grantedFromId: command.requestId,
				state: ElicitationApprovalGrantState.Active,
				expiresAt: command.expiresAt,
			},
		});
		return true;
	}

	/**
	 * Find a grant that still answers this question, or null when the person must be asked again.
	 *
	 * An always grant matches whatever conversation the call is in; a session grant matches only the
	 * one it was granted in. Revoked and lapsed grants match nothing — expiry is read from
	 * `expiresAt` rather than by moving the row, so a lapsed grant keeps its history.
	 */
	async findLive(coordinates: ApprovalGrantCoordinates, conversationId: string, now: Date): Promise<LiveApprovalGrant | null>
	{
		const grant = await this._transaction.elicitationApprovalGrant.findFirst({
			where: {
				siloId: coordinates.siloId,
				purpose: _Purpose(coordinates.purpose),
				subjectId: coordinates.subjectId,
				resourceKind: coordinates.resourceKind,
				resourceId: coordinates.resourceId,
				action: coordinates.action,
				state: ElicitationApprovalGrantState.Active,
				OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
				AND: [{ OR: [{ scope: ElicitationApprovalGrantScope.Always }, { scope: ElicitationApprovalGrantScope.Session, conversationId }] }],
			},
			select: { id: true, scope: true },
		});
		if (grant === null)
			return null;
		return { id: grant.id, scope: _PublicScope(grant.scope) };
	}

	/**
	 * Revoke one grant so its question is asked again.
	 *
	 * Only the subject the grant belongs to may revoke it, which is why the subject is matched rather
	 * than trusted from the caller. Returns whether an active grant was actually revoked.
	 */
	async revoke(siloId: string, subjectId: string, grantId: string, now: Date): Promise<boolean>
	{
		const revoked = await this._transaction.elicitationApprovalGrant.updateMany({
			where: { id: grantId, siloId, subjectId, state: ElicitationApprovalGrantState.Active },
			data: { state: ElicitationApprovalGrantState.Revoked, revokedAt: now, revokedBy: subjectId },
		});
		return revoked.count === 1;
	}
}
