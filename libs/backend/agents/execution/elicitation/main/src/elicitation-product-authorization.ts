import type { Prisma } from "@prisma/client";

import { __DigestCanonicalJson, PrismaAuthorizationAuthority, type AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationBoundaryKinds, AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import type { JsonValue } from "@opencrane/util";

import type { ElicitationProductAuthorization } from "./elicitation-product-authorization.types";

/**
 * Applies central product authorization to browser elicitation reads and responses.
 *
 * Participant assignment and request lifecycle remain owned by the elicitation repository. This
 * adapter resolves the assigned subject to one durable Principal and evaluates the product grants
 * on the exact Prisma transaction that owns the protected read or response.
 *
 * Called by: `PrismaElicitationRepository` before returning browser data or writing a response.
 *
 * @see PrismaAuthorizationAuthority in @opencrane/backend/server/iam/authorization
 */
export class PrismaElicitationProductAuthorizationRepository implements ElicitationProductAuthorization
{
	/** Transaction shared with the protected elicitation operation. */
	private readonly transaction: Prisma.TransactionClient;
	/** Central product authority sharing that transaction. */
	private readonly authorization: AuthorizationAuthority;

	/** Binds Principal resolution and product decisions to the caller's open transaction. */
	constructor(transaction: Prisma.TransactionClient, authorization: AuthorizationAuthority = new PrismaAuthorizationAuthority(transaction))
	{
		this.transaction = transaction;
		this.authorization = authorization;
	}

	/** Requires the current Principal's exact personal Conversation/Read grant. */
	async canReadConversation(siloId: string, subjectId: string, conversationId: string, now: Date): Promise<boolean>
	{
		const principalId = await this._resolvePrincipal(siloId, subjectId);
		if (principalId === null)
			return false;
		const decision = await this.authorization.decide({ siloId, principalId, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId }, resource: { kind: ProductAuthorizationResourceKinds.Conversation, id: conversationId }, action: ProductAuthorizationActions.Read, nowEpochMs: now.getTime() });
		return decision.outcome === AuthorizationDecisionOutcomes.Allow;
	}

	/** Filters candidate conversation ids through one batched Conversation/Read decision. */
	async filterReadableConversationIds(siloId: string, subjectId: string, conversationIds: readonly string[], now: Date): Promise<ReadonlySet<string>>
	{
		const principalId = await this._resolvePrincipal(siloId, subjectId);
		if (principalId === null)
			return new Set();
		const resources = [...new Set(conversationIds)].map(id => ({ kind: ProductAuthorizationResourceKinds.Conversation, id }));
		const entitled = await this.authorization.listEntitled({ siloId, principalId, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId }, action: ProductAuthorizationActions.Read, resources, nowEpochMs: now.getTime() });
		return new Set(entitled.map(resource => resource.id));
	}

	/**
	 * Admits a response against Conversation/Use and, for tool approvals, ApprovalRequest/Decide.
	 *
	 * Both permissions are decided before either durable admission record is written, so a denied
	 * approval cannot leave a response attempt or a partial product decision behind.
	 */
	async admitResponse(siloId: string, subjectId: string, conversationId: string, approvalRequestId: string | null, response: JsonValue, now: Date): Promise<boolean>
	{
		const principalId = await this._resolvePrincipal(siloId, subjectId);
		if (principalId === null)
			return false;
		const argumentsDigest = __DigestCanonicalJson(response);
		const conversationCommand = { siloId, principalId, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId } as const, resource: { kind: ProductAuthorizationResourceKinds.Conversation, id: conversationId }, action: ProductAuthorizationActions.Use, nowEpochMs: now.getTime() };
		const conversationDecision = await this.authorization.decide(conversationCommand);
		if (conversationDecision.outcome !== AuthorizationDecisionOutcomes.Allow)
			return false;
		const approvalCommand = approvalRequestId === null ? null : { siloId, principalId, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId } as const, resource: { kind: ProductAuthorizationResourceKinds.ApprovalRequest, id: approvalRequestId }, action: ProductAuthorizationActions.Decide, nowEpochMs: now.getTime() };
		if (approvalCommand !== null)
		{
			const approvalDecision = await this.authorization.decide(approvalCommand);
			if (approvalDecision.outcome !== AuthorizationDecisionOutcomes.Allow)
				return false;
		}
		const conversationAdmission = await this.authorization.admit({ ...conversationCommand, actorKind: "user", actorId: principalId, argumentsDigest });
		if (conversationAdmission.outcome !== AuthorizationDecisionOutcomes.Allow)
			return false;
		if (approvalCommand === null)
			return true;
		const approvalAdmission = await this.authorization.admit({ ...approvalCommand, actorKind: "user", actorId: principalId, argumentsDigest });
		return approvalAdmission.outcome === AuthorizationDecisionOutcomes.Allow;
	}

	/** Resolves one authenticated subject to exactly one local Principal in this silo. */
	private async _resolvePrincipal(siloId: string, subjectId: string): Promise<string | null>
	{
		const principals = await this.transaction.principal.findMany({ where: { siloId, subject: subjectId }, select: { id: true }, take: 2 });
		return principals.length === 1 ? principals[0].id : null;
	}
}
