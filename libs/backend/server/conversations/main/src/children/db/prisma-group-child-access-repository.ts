import { ConversationChildRequestState, ConversationLifecycle, ConversationMode, OrgMemberStatus, type Prisma } from "@prisma/client";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import type { GroupChildAccessPort, GroupChildAgentResolver, GroupChildRequest, GroupChildOrigin } from "../group-child.types";
import type { ConversationCaller } from "../../authorization/conversation-caller.types";
import { _GroupChildCaller } from "../group-child.mapper";
import { PrismaConversationProductAuthorizationRepository } from "../../authorization/db/conversation-product-authorization";

/** Rechecks current parent, child and shared-source authority in the caller's transaction. */
export class PrismaGroupChildAccessRepository implements GroupChildAccessPort<Prisma.TransactionClient>
{
	private readonly authorization: PrismaConversationProductAuthorizationRepository;
	/** Binds every relationship and grant read to the caller's transaction. */
	public constructor(private readonly transaction: Prisma.TransactionClient) { this.authorization = new PrismaConversationProductAuthorizationRepository(this.transaction); }

	/** Requires a ready child, its frozen audience and continuing parent and child Read access. */
	public async mayAccess(caller: ConversationCaller, conversationId: string): Promise<boolean>
	{
		const request = await this.transaction.conversationChildRequest.findUnique({ where: { childConversationId: conversationId }, select: { siloId: true, state: true, parentConversationId: true, parentMessagePosition: true, participantSubjectIds: true } });
		if (request === null)
			return true;
		if (request.siloId !== caller.siloId || request.state !== ConversationChildRequestState.Ready || !Array.isArray(request.participantSubjectIds) || !request.participantSubjectIds.includes(caller.subjectId))
			return false;
		const child = await this.transaction.conversation.findFirst({ where: { id: conversationId, siloId: caller.siloId, participants: { some: { userId: caller.subjectId, accessEndedPosition: null } } }, select: { id: true } });
		return child !== null && await this.authorization.canAccess(caller, conversationId, ProductAuthorizationActions.Read) && await this.mayReadOrigin(caller, request.parentConversationId, request.parentMessagePosition);
	}

	/** Rejects a parent message outside the caller's current joining boundary. */
	public async mayReadOrigin(caller: ConversationCaller, parentConversationId: string, parentMessagePosition: bigint): Promise<boolean>
	{
		const parent = await this.transaction.conversation.findFirst({ where: { id: parentConversationId, siloId: caller.siloId, mode: ConversationMode.Group, participants: { some: { userId: caller.subjectId, accessEndedPosition: null, visibleFromPosition: { lte: parentMessagePosition } } } }, select: { id: true } });
		if (parent === null)
			return false;
		return this.authorization.canAccess(caller, parentConversationId, ProductAuthorizationActions.Read);
	}

	/** Releases breadcrumb coordinates only after the same access gate as child history. */
	public async origin(caller: ConversationCaller, conversationId: string): Promise<GroupChildOrigin | null>
	{
		if (!await this.mayAccess(caller, conversationId))
			return null;
		const request = await this.transaction.conversationChildRequest.findUnique({ where: { childConversationId: conversationId }, select: { id: true, parentConversationId: true, parentMessageId: true, parentMessagePosition: true } });
		return request === null ? null : { requestId: request.id, parentConversationId: request.parentConversationId, parentMessageId: request.parentMessageId, parentMessagePosition: request.parentMessagePosition.toString() };
	}

	/** Refuses shared copying unless every admitted recipient can currently read the exact parent revision. */
	public async audience(caller: ConversationCaller, parentId: string, position: bigint, frozen?: readonly string[]): Promise<readonly string[] | null>
	{
		const principal = await this.transaction.principal.findFirst({ where: { id: caller.principalId, siloId: caller.siloId, subject: caller.subjectId, issuer: caller.externalIssuer }, select: { id: true } });
		const parent = await this.transaction.conversation.findFirst({ where: { id: parentId, siloId: caller.siloId, mode: ConversationMode.Group, lifecycle: ConversationLifecycle.Open }, select: { participants: { where: { accessEndedPosition: null }, select: { userId: true, visibleFromPosition: true } } } });
		if (principal === null || parent === null)
			return null;
		const subjects = frozen ?? parent.participants.map(participant => participant.userId).sort();
		if (!subjects.includes(caller.subjectId) || subjects.length === 0 || subjects.some(subject => !parent.participants.some(participant => participant.userId === subject && participant.visibleFromPosition <= position)))
			return null;
		const memberships = await this.transaction.orgMembership.findMany({ where: { clusterTenant: caller.siloId, subject: { in: [...subjects] }, status: OrgMemberStatus.Active }, select: { subject: true } });
		const principals = await this.transaction.principal.findMany({ where: { siloId: caller.siloId, subject: { in: [...subjects] } }, select: { id: true, subject: true } });
		const authorization = this.authorization;
		for (const subject of subjects)
		{
			const matches = principals.filter(item => item.subject === subject);
			if (!memberships.some(item => item.subject === subject) || matches.length !== 1 || !await authorization.canAccess({ ...caller, subjectId: subject, principalId: matches[0]!.id }, parentId, ProductAuthorizationActions.Read))
				return null;
		}
		return subjects;
	}

	/** Rechecks the frozen company identity and all authority needed before another creation effect. */
	public async stillAdmitted(request: GroupChildRequest, agents: GroupChildAgentResolver<Prisma.TransactionClient>): Promise<boolean>
	{
		if (!Array.isArray(request.participantSubjectIds) || request.participantSubjectIds.some(subject => typeof subject !== "string"))
			return false;
		const caller = _GroupChildCaller(request);
		const audience = await this.audience(caller, request.parentConversationId, request.parentMessagePosition, request.participantSubjectIds as string[]);
		if (audience === null)
			return false;
		const child = await this.transaction.conversation.findUnique({ where: { id: request.childConversationId }, select: { lifecycle: true, participants: { where: { accessEndedPosition: null }, select: { userId: true, visibleFromPosition: true } } } });
		if (child !== null)
		{
			const authorization = this.authorization;
			if (child.lifecycle !== ConversationLifecycle.Open || !child.participants.some(participant => participant.userId === caller.subjectId && participant.visibleFromPosition <= 1n) || !await authorization.canAccess(caller, request.childConversationId, ProductAuthorizationActions.Read) || !await authorization.isCurrentlyEligible(caller, request.childConversationId, ProductAuthorizationActions.Use))
				return false;
		}
		const candidate = await agents.resolve(this.transaction, caller, request.agentServiceId);
		if (candidate === null || candidate.agentRevisionId !== request.agentRevisionId || candidate.agentIdentityId !== request.agentIdentityId || candidate.principalId !== request.agentPrincipalId || candidate.profileRevisionId !== request.profileRevisionId)
			return false;
		const authorization = this.authorization;
		return await authorization.admit(caller, { kind: ProductAuthorizationResourceKinds.Conversation, id: request.parentConversationId }, ProductAuthorizationActions.Delegate, { requestId: request.id, commandDigest: request.commandDigest }) && await authorization.admit(caller, { kind: ProductAuthorizationResourceKinds.ConversationCollection, id: request.siloId }, ProductAuthorizationActions.Create, { requestId: request.id, commandDigest: request.commandDigest });
	}
}
