import { ConversationLifecycle, OrgMemberStatus, PrincipalProvenance, type Prisma } from "@prisma/client";

import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import type { RoutineConversationDirectoryRepository, RoutineDirectoryCaller } from "./routine-conversation-directory.types";

/** Resolves opaque membership references without exposing conversation persistence to scheduling. */
export class PrismaRoutineConversationDirectoryRepository implements RoutineConversationDirectoryRepository
{
	/** Shares the routine transaction with membership, participation, and authorization reads. */
	public constructor(private readonly transaction: Prisma.TransactionClient) {}

	/** Resolves selected active membership references into current external Principals. */
	public async resolveAudience(caller: RoutineDirectoryCaller, destinationConversationId: string, participantRefs: readonly string[], now: Date): Promise<{ readonly participantRefs: readonly string[]; readonly principalIds: readonly string[] } | null>
	{
		if (participantRefs.length === 0 || new Set(participantRefs).size !== participantRefs.length)
			return null;
		const conversation = await this._Conversation(caller, destinationConversationId, now);
		if (conversation === null)
			return null;
		const memberships = await this.transaction.orgMembership.findMany({ where: { id: { in: [...participantRefs] }, clusterTenant: caller.siloId, status: OrgMemberStatus.Active }, select: { id: true, subject: true }, orderBy: { id: "asc" } });
		if (memberships.length !== participantRefs.length || new Set(memberships.map(row => row.subject)).size !== memberships.length)
			return null;
		const subjects = new Set(conversation.participants.map(row => row.userId));
		if (memberships.some(row => !subjects.has(row.subject)))
			return null;
		const self = memberships.filter(row => row.subject === caller.subjectId);
		if (self.length !== 1)
			return null;
		const principals = await this.transaction.principal.findMany({ where: { siloId: caller.siloId, issuer: caller.issuer, provenance: PrincipalProvenance.External, subject: { in: memberships.map(row => row.subject) } }, select: { id: true, subject: true } });
		if (principals.length !== memberships.length || new Set(principals.map(row => row.subject)).size !== principals.length)
			return null;
		const principalBySubject = new Map(principals.map(row => [row.subject, row.id]));
		if (principalBySubject.get(caller.subjectId) !== caller.principalId)
			return null;
		const authorization = new PrismaAuthorizationAuthority(this.transaction);
		for (const principal of principals)
		{
			const allowed = await _MayRead(authorization, caller.siloId, principal.id, destinationConversationId, now);
			if (!allowed)
				return null;
		}
		const selected = memberships.map(row => ({ participantRef: row.id, principalId: principalBySubject.get(row.subject)! })).sort((left, right) => left.participantRef.localeCompare(right.participantRef));
		return { participantRefs: selected.map(row => row.participantRef), principalIds: selected.map(row => row.principalId).sort() };
	}

	/** Projects every frozen Principal to one durable membership reference without requiring it to remain active. */
	public async projectAudience(caller: RoutineDirectoryCaller, destinationConversationId: string, principalIds: readonly string[]): Promise<readonly { readonly participantRef: string; readonly displayName: string; readonly isSelf: boolean }[]>
	{
		const principals = await this.transaction.principal.findMany({ where: { id: { in: [...principalIds] }, siloId: caller.siloId, provenance: PrincipalProvenance.External }, select: { id: true, issuer: true, subject: true } });
		if (principals.length !== principalIds.length || new Set(principals.map(row => row.subject)).size !== principals.length || principals.some(row => row.issuer !== caller.issuer))
			throw new Error("routine audience Principal projection is incomplete or ambiguous");
		const callerPrincipal = principals.find(row => row.id === caller.principalId);
		if (callerPrincipal === undefined || callerPrincipal.issuer !== caller.issuer || callerPrincipal.subject !== caller.subjectId)
			throw new Error("routine audience caller projection is inconsistent");
		const memberships = await this.transaction.orgMembership.findMany({ where: { clusterTenant: caller.siloId, subject: { in: principals.map(row => row.subject) } }, select: { id: true, subject: true, displayName: true } });
		if (memberships.length !== principals.length || new Set(memberships.map(row => row.subject)).size !== memberships.length)
			throw new Error("routine audience membership projection is incomplete or ambiguous");
		const conversation = await this.transaction.conversation.findFirst({ where: { id: destinationConversationId, siloId: caller.siloId }, select: { id: true } });
		if (conversation === null)
			throw new Error("routine audience destination projection is unavailable");
		return memberships.map(row => ({ participantRef: row.id, displayName: row.displayName?.trim() || "Unnamed member", isSelf: row.subject === caller.subjectId })).sort((left, right) => left.participantRef.localeCompare(right.participantRef));
	}

	/** Lists current participants that retain Conversation Read in the requested destination. */
	public async creationAudience(caller: RoutineDirectoryCaller, destinationConversationId: string, now: Date): Promise<readonly { readonly participantRef: string; readonly displayName: string; readonly isSelf: boolean }[] | null>
	{
		const conversation = await this._Conversation(caller, destinationConversationId, now);
		if (conversation === null)
			return null;
		const subjects = conversation.participants.map(row => row.userId);
		const memberships = await this.transaction.orgMembership.findMany({ where: { clusterTenant: caller.siloId, status: OrgMemberStatus.Active, subject: { in: subjects } }, select: { id: true, subject: true, displayName: true }, orderBy: { id: "asc" } });
		const principals = await this.transaction.principal.findMany({ where: { siloId: caller.siloId, issuer: caller.issuer, provenance: PrincipalProvenance.External, subject: { in: memberships.map(row => row.subject) } }, select: { id: true, subject: true } });
		const principalBySubject = new Map(principals.map(row => [row.subject, row.id]));
		const authorization = new PrismaAuthorizationAuthority(this.transaction);
		const choices: { readonly participantRef: string; readonly displayName: string; readonly isSelf: boolean }[] = [];
		for (const membership of memberships)
		{
			const principalId = principalBySubject.get(membership.subject);
			if (principalId === undefined || !await _MayRead(authorization, caller.siloId, principalId, destinationConversationId, now))
				continue;
			choices.push({ participantRef: membership.id, displayName: membership.displayName?.trim() || "Unnamed member", isSelf: membership.subject === caller.subjectId });
		}
		if (choices.filter(choice => choice.isSelf).length !== 1 || principalBySubject.get(caller.subjectId) !== caller.principalId)
			return null;
		return choices;
	}

	/** Filters occurrence conversations through current participation and central Conversation Read. */
	public async readableConversationIds(caller: RoutineDirectoryCaller, conversationIds: readonly string[], now: Date): Promise<readonly string[]>
	{
		const candidates = await this.transaction.conversation.findMany({ where: { id: { in: [...new Set(conversationIds)] }, siloId: caller.siloId, lifecycle: ConversationLifecycle.Open, participants: { some: { userId: caller.subjectId, accessEndedPosition: null } } }, select: { id: true } });
		const authorization = new PrismaAuthorizationAuthority(this.transaction);
		const entitled = await authorization.listPrincipalEntitled({ siloId: caller.siloId, principalId: caller.principalId, action: ProductAuthorizationActions.Read, resources: candidates.map(row => ({ kind: ProductAuthorizationResourceKinds.Conversation, id: row.id })), nowEpochMs: now.getTime() });
		return entitled.map(resource => resource.id).sort();
	}

	/** Loads one open destination after checking the exact caller Principal and current Conversation Read. */
	private async _Conversation(caller: RoutineDirectoryCaller, destinationConversationId: string, now: Date): Promise<{ readonly participants: readonly { readonly userId: string }[] } | null>
	{
		const principal = await this.transaction.principal.findFirst({ where: { id: caller.principalId, siloId: caller.siloId, issuer: caller.issuer, subject: caller.subjectId, provenance: PrincipalProvenance.External }, select: { id: true } });
		const conversation = await this.transaction.conversation.findFirst({ where: { id: destinationConversationId, siloId: caller.siloId, lifecycle: ConversationLifecycle.Open, participants: { some: { userId: caller.subjectId, accessEndedPosition: null } } }, select: { participants: { where: { accessEndedPosition: null }, select: { userId: true } } } });
		if (principal === null || conversation === null)
			return null;
		const authorization = new PrismaAuthorizationAuthority(this.transaction);
		return await _MayRead(authorization, caller.siloId, caller.principalId, destinationConversationId, now) ? conversation : null;
	}
}

/** Checks one Principal's current Conversation Read without recording decision evidence. */
async function _MayRead(authorization: PrismaAuthorizationAuthority, siloId: string, principalId: string, conversationId: string, now: Date): Promise<boolean>
{
	const decision = await authorization.decidePrincipal({ siloId, principalId, resource: { kind: ProductAuthorizationResourceKinds.Conversation, id: conversationId }, action: ProductAuthorizationActions.Read, nowEpochMs: now.getTime() });
	return decision.outcome === AuthorizationDecisionOutcomes.Allow;
}
