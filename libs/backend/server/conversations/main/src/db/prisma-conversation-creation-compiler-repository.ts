import { AgentServiceKind, AgentServiceState, OrgMemberStatus, type Prisma } from "@prisma/client";

import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ConversationModes } from "@opencrane/models/conversations";

import type { CompiledConversationCreation, ConversationCreationCompilerRepository } from "../conversation-creation-compiler.types";
import type { ConversationCaller } from "../types/conversation-caller.types";
import type { CreateConversationRequest } from "../types/conversation-request.types";
import { PrismaConversationProductAuthorizationRepository } from "./conversation-product-authorization";

/** Resolves current participant and personal-Agent authority inside the creation transaction. */
export class PrismaConversationCreationCompilerRepository implements ConversationCreationCompilerRepository
{
	/** Holds the caller-scoped serializable transaction. */
	private readonly transaction: Prisma.TransactionClient;
	/** Checks the collection and referenced resources against this exact transaction snapshot. */
	private readonly authorization: PrismaConversationProductAuthorizationRepository;

	/** Binds reference resolution and authorization evidence to the same serializable transaction. */
	public constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
		this.authorization = new PrismaConversationProductAuthorizationRepository(transaction);
	}

	/** @inheritdoc */
	public async compile(caller: ConversationCaller, request: CreateConversationRequest): Promise<CompiledConversationCreation | null>
	{
		const callerMembership = await this.transaction.orgMembership.findFirst({ where: { clusterTenant: caller.siloId, subject: caller.subjectId, status: OrgMemberStatus.Active }, select: { id: true } });
		if (callerMembership === null)
			return null;
		if (request.mode === ConversationModes.AgentSession)
			return this._CompilePersonalAgent(caller, request.personalAgentRef);
		return this._CompileParticipants(caller, callerMembership.id, request.participantRefs);
	}

	/** Resolves opaque membership references without exposing which coordinate became unavailable. */
	private async _CompileParticipants(caller: ConversationCaller, callerMembershipId: string, participantRefs: readonly string[]): Promise<CompiledConversationCreation | null>
	{
		const uniqueReferences = [...new Set(participantRefs)];
		if (uniqueReferences.length !== participantRefs.length || uniqueReferences.includes(callerMembershipId))
			return null;
		const memberships = await this.transaction.orgMembership.findMany({ where: { id: { in: uniqueReferences }, clusterTenant: caller.siloId, status: OrgMemberStatus.Active }, select: { subject: true }, orderBy: { id: "asc" } });
		if (memberships.length !== uniqueReferences.length)
			return null;
		const readable = await this.authorization.canReadResources(caller, uniqueReferences.map(function _Membership(id) { return { kind: ProductAuthorizationResourceKinds.OrganizationMembership, id }; }));
		if (!readable)
			return null;
		return { participantUserIds: [caller.subjectId, ...memberships.map(function _Subject(membership) { return membership.subject; })], agentServiceId: null };
	}

	/** Resolves only the caller-owned active personal Agent and records its use evidence. */
	private async _CompilePersonalAgent(caller: ConversationCaller, personalAgentRef: string): Promise<CompiledConversationCreation | null>
	{
		const profile = await this.transaction.personaProfile.findUnique({ where: { siloId_userId: { siloId: caller.siloId, userId: caller.subjectId } }, select: { id: true, activeRevisionId: true } });
		if (profile?.activeRevisionId === null || profile?.activeRevisionId === undefined)
			return null;
		const services = await this.transaction.agentService.findMany({ where: { siloId: caller.siloId, kind: AgentServiceKind.Personal, state: AgentServiceState.Active, activeRevisionId: { not: null }, activeRevision: { is: { personaRevisionId: profile.activeRevisionId } } }, select: { id: true }, orderBy: { id: "asc" }, take: 2 });
		const service = services[0];
		if (services.length !== 1 || service === undefined || service.id !== personalAgentRef)
			return null;
		const readable = await this.authorization.canReadResources(caller, [{ kind: ProductAuthorizationResourceKinds.AgentService, id: service.id }]);
		if (!readable)
			return null;
		const invocable = await this.authorization.admit(caller, { kind: ProductAuthorizationResourceKinds.AgentService, id: service.id }, ProductAuthorizationActions.Invoke, { conversationMode: ConversationModes.AgentSession });
		if (!invocable)
			return null;
		const personaUsable = await this.authorization.admit(caller, { kind: ProductAuthorizationResourceKinds.Persona, id: profile.id }, ProductAuthorizationActions.Use, { conversationMode: ConversationModes.AgentSession });
		if (!personaUsable)
			return null;
		return { participantUserIds: [caller.subjectId], agentServiceId: service.id };
	}
}
