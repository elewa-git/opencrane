import type { Prisma } from "@prisma/client";

import { PrismaAuthorizationAuthority, PrismaManagedAuthorizationGrantRepository } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationDecisionOutcomes, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability, type ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { ConversationCaller } from "../types/conversation-caller.types";
import type { ConversationProductAuthorizationRepository } from "./conversation-product-authorization.types";

/** Isolates grants that mirror current conversation participation. */
const CONVERSATION_PARTICIPANT_GRANT_MANAGER_ID = "conversation-participant-access";
/** Isolates lifecycle administration granted only to the creator of a new conversation. */
const CONVERSATION_CREATOR_GRANT_MANAGER_ID = "conversation-creator-access";

/** Transaction-scoped product authority and grant projector for the conversation domain. */
export class PrismaConversationProductAuthorizationRepository implements ConversationProductAuthorizationRepository
{
	private readonly transaction: Prisma.TransactionClient;
	private readonly authority: PrismaAuthorizationAuthority;
	private readonly managedGrants: PrismaManagedAuthorizationGrantRepository;

	constructor(transaction: Prisma.TransactionClient) { this.transaction = transaction; this.authority = new PrismaAuthorizationAuthority(transaction); this.managedGrants = new PrismaManagedAuthorizationGrantRepository(transaction); }

	/** Decides an exact conversation action inside the owning domain transaction. */
	async canAccess(caller: ConversationCaller, conversationId: string, action: ProductAuthorizationActions): Promise<boolean>
	{
		const entitled = await this.authority.listPrincipalEntitled({ siloId: caller.siloId, principalId: caller.principalId, resources: [{ kind: ProductAuthorizationResourceKinds.Conversation, id: conversationId }], action, nowEpochMs: Date.now() });
		return entitled.length === 1;
	}

	/** Records an exact conversation or collection mutation/effect before its protected write. */
	async admit(caller: ConversationCaller, resource: ProductAuthorizationResourceLocator, action: ProductAuthorizationActions, argumentsValue: JsonValue): Promise<boolean>
	{
		const result = await this.authority.admitPrincipal({ siloId: caller.siloId, principalId: caller.principalId, actorKind: "user", actorId: caller.principalId, resource, action, argumentsDigest: ___DigestCanonicalJson(argumentsValue), nowEpochMs: Date.now() });
		return result.outcome === AuthorizationDecisionOutcomes.Allow;
	}

	/** Filters exact conversation ids through one transaction-bound catalogue decision. */
	async entitledIds(caller: ConversationCaller, conversationIds: readonly string[], action: ProductAuthorizationActions): Promise<ReadonlySet<string>>
	{
		const entitled = await this.authority.listPrincipalEntitled({ siloId: caller.siloId, principalId: caller.principalId, action, resources: conversationIds.map(id => ({ kind: ProductAuthorizationResourceKinds.Conversation, id })), nowEpochMs: Date.now() });
		return new Set(entitled.map(resource => resource.id));
	}

	/** Filters a small directory candidate set through exact current read grants. */
	async canReadResources(caller: ConversationCaller, resources: readonly ProductAuthorizationResourceLocator[]): Promise<boolean>
	{
		const entitled = await this.authority.listPrincipalEntitled({ siloId: caller.siloId, principalId: caller.principalId, action: ProductAuthorizationActions.Read, resources, nowEpochMs: Date.now() });
		return entitled.length === resources.length;
	}

	/** Mirrors participant visibility and ordinary interaction without granting lifecycle deletion. */
	async reconcileParticipants(siloId: string, conversationId: string, participantUserIds: readonly string[], createdByPrincipalId: string, now: Date): Promise<void>
	{
		const subjects = [...new Set(participantUserIds)];
		const principals = await this.transaction.principal.findMany({ where: { siloId, subject: { in: subjects } }, select: { id: true, subject: true } });
		for (const subject of subjects)
		{
			if (principals.filter(principal => principal.subject === subject).length !== 1)
				throw new Error("conversation participant Principal projection is unavailable or ambiguous");
		}
		const resource = { kind: ProductAuthorizationResourceKinds.Conversation, id: conversationId } as const;
		const actions = [ProductAuthorizationActions.Discover, ProductAuthorizationActions.Read, ProductAuthorizationActions.Edit, ProductAuthorizationActions.Use] as const;
		const grants = principals.flatMap(principal => actions.map(action => _Grant(principal.id, createdByPrincipalId, resource, action)));
		await this.managedGrants.reconcileManagedResourceGrants({ siloId, managerId: CONVERSATION_PARTICIPANT_GRANT_MANAGER_ID, resource, grants, now });
	}

	/** Grants irreversible lifecycle closure only to the Principal that created a new conversation. */
	async reconcileCreator(siloId: string, conversationId: string, creatorPrincipalId: string, now: Date): Promise<void>
	{
		const resource = { kind: ProductAuthorizationResourceKinds.Conversation, id: conversationId } as const;
		await this.managedGrants.reconcileManagedResourceGrants({ siloId, managerId: CONVERSATION_CREATOR_GRANT_MANAGER_ID, resource, grants: [_Grant(creatorPrincipalId, creatorPrincipalId, resource, ProductAuthorizationActions.Delete)], now });
	}
}

/** Builds one exact Personal-boundary grant from a domain-owned relation. */
function _Grant(principalId: string, createdByPrincipalId: string, resource: ProductAuthorizationResourceLocator, action: ProductAuthorizationActions)
{
	const capability = __ProductAuthorizationCapability(resource.kind as ProductAuthorizationResourceKinds, action);
	if (capability === null)
		throw new Error(`conversation capability ${resource.kind}:${action} is unavailable`);
	return { subject: { kind: AuthorizationSubjectKinds.Principal, principalId }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource, priority: 0, createdByPrincipalId } as const;
}
