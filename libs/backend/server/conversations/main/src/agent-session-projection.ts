import { AgentRevisionState, AgentServiceKind, AgentServiceState, ConversationMode, OrgMemberStatus, Prisma, type PrismaClient } from "@prisma/client";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import type { AgentSessionCandidate, AgentSessionCoordinates, AgentSessionReleaseProfile } from "./agent-session-creation.types";
import { PrismaConversationProductAuthorizationRepository } from "./db/conversation-product-authorization";
import type { ConversationCaller } from "./types/conversation-caller.types";

/** Owns relational prechecks and rebuildable agent-session projections. */
export class PrismaAgentSessionProjection
{
	/** Connects mutable authority to its database and frozen release profile map. */
	public constructor(private readonly prisma: PrismaClient, private readonly profiles: readonly AgentSessionReleaseProfile[]) {}

	/** Loads one active caller-owned personal service and records collection-create authority. */
	public precheck(caller: ConversationCaller, personalAgentRef: string): Promise<AgentSessionCandidate | null>
	{
		const profiles = this.profiles;
		return this.prisma.$transaction(async function _Precheck(transaction)
		{
			const membership = await transaction.orgMembership.count({ where: { clusterTenant: caller.siloId, subject: caller.subjectId, status: OrgMemberStatus.Active } });
			if (membership !== 1 || !personalAgentRef.trim())
				return null;
			const service = await transaction.agentService.findFirst({ where: { id: personalAgentRef, siloId: caller.siloId, kind: AgentServiceKind.Personal, state: AgentServiceState.Active, activeRevisionId: { not: null } }, select: { id: true, name: true, workloadProfile: true, activeRevision: { select: { personaRevisionId: true, state: true } } } });
			if (service === null || service.activeRevision === null || service.activeRevision.personaRevisionId === null || service.activeRevision.state !== AgentRevisionState.Published)
				return null;
			const persona = await transaction.personaProfile.count({ where: { siloId: caller.siloId, userId: caller.subjectId, activeRevisionId: service.activeRevision.personaRevisionId } });
			const profile = profiles.filter(item => item.workloadProfile === service.workloadProfile);
			if (persona !== 1 || profile.length !== 1)
				return null;
			const authorization = new PrismaConversationProductAuthorizationRepository(transaction);
			const admitted = await authorization.admit(caller, { kind: ProductAuthorizationResourceKinds.ConversationCollection, id: caller.siloId }, ProductAuthorizationActions.Create, { mode: "agent_session", agentServiceId: service.id });
			if (!admitted)
				return null;
			return { agentServiceId: service.id, agentName: service.name, profileRevisionId: profile[0]!.profileRevisionId, workloadProfile: service.workloadProfile };
		}, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
	}

	/** Rechecks mutable authority and installs or validates the history-derived projection. */
	public project(caller: ConversationCaller, candidate: AgentSessionCandidate, coordinates: AgentSessionCoordinates): Promise<string | null>
	{
		return this.prisma.$transaction(async function _Project(transaction)
		{
			const membership = await transaction.orgMembership.count({ where: { clusterTenant: caller.siloId, subject: caller.subjectId, status: OrgMemberStatus.Active } });
			const service = await transaction.agentService.findFirst({ where: { id: candidate.agentServiceId, siloId: caller.siloId, kind: AgentServiceKind.Personal, state: AgentServiceState.Active, workloadProfile: candidate.workloadProfile, activeRevisionId: { not: null } }, select: { activeRevision: { select: { personaRevisionId: true, state: true } } } });
			if (membership !== 1 || service === null || service.activeRevision === null || service.activeRevision.personaRevisionId === null || service.activeRevision.state !== AgentRevisionState.Published)
				return null;
			const persona = await transaction.personaProfile.count({ where: { siloId: caller.siloId, userId: caller.subjectId, activeRevisionId: service.activeRevision.personaRevisionId } });
			if (persona !== 1)
				return null;
			const authorization = new PrismaConversationProductAuthorizationRepository(transaction);
			const admitted = await authorization.admit(caller, { kind: ProductAuthorizationResourceKinds.ConversationCollection, id: caller.siloId }, ProductAuthorizationActions.Create, { mode: "agent_session", agentServiceId: candidate.agentServiceId });
			if (!admitted)
				return null;
			const existing = await transaction.conversation.findUnique({ where: { id: coordinates.conversationId }, select: { siloId: true, mode: true, agentServiceId: true, computerId: true, computerAgentIdentityId: true, computerProfileRevisionId: true } });
			if (existing === null)
			{
				await transaction.conversation.create({ data: { id: coordinates.conversationId, siloId: caller.siloId, mode: ConversationMode.AgentSession, agentServiceId: candidate.agentServiceId, computerId: coordinates.computerId, computerAgentIdentityId: coordinates.agentIdentityId, computerProfileRevisionId: candidate.profileRevisionId, participants: { create: [{ userId: caller.subjectId, visibleFromPosition: 1n, readThroughPosition: 0n }] } } });
			}
			else if (existing.siloId !== caller.siloId || existing.mode !== ConversationMode.AgentSession || existing.agentServiceId !== candidate.agentServiceId || existing.computerId !== coordinates.computerId || existing.computerAgentIdentityId !== coordinates.agentIdentityId || existing.computerProfileRevisionId !== candidate.profileRevisionId)
				throw new Error("Existing conversation projection conflicts with immutable history");
			else
				return coordinates.conversationId;
			const now = new Date();
			await authorization.reconcileParticipants(caller.siloId, coordinates.conversationId, [caller.subjectId], caller.principalId, now);
			await authorization.reconcileCreator(caller.siloId, coordinates.conversationId, caller.principalId, now);
			return coordinates.conversationId;
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}
