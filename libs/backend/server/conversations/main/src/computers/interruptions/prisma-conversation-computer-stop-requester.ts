import { ConversationLifecycle, OrgMemberStatus, Prisma } from "@prisma/client";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";

import { PrismaConversationProductAuthorizationRepository } from "../../authorization/db/conversation-product-authorization";
import type { ConversationComputerStopCommand, ConversationComputerStopRequesterRepository } from "./conversation-computer-stop.types";
import { ConversationComputerStopDenied } from "./conversation-computer-stop-denied";

/** Owns current requester, participation, lease and product authorization for Stop. */
export class PrismaConversationComputerStopRequesterRepository implements ConversationComputerStopRequesterRepository
{
	/** Binds every authority read and its audit decision to one transaction. */
	public constructor(private readonly transaction: Prisma.TransactionClient) {}

	/** Records Conversation Use only for the current authorized participant and exact active lease. */
	public async authorize(command: ConversationComputerStopCommand, commandDigest: `sha256:${string}`, leaseId: string, now: Date): Promise<string>
	{
		const conversation = await this.transaction.conversation.findFirst({ where: { id: command.conversationId, siloId: command.siloId, lifecycle: ConversationLifecycle.Open, computerId: command.computerId, participants: { some: { userId: command.requester.subjectId, accessEndedPosition: null } } }, select: { id: true } });
		const membership = await this.transaction.orgMembership.findUnique({ where: { clusterTenant_subject: { clusterTenant: command.siloId, subject: command.requester.subjectId } }, select: { status: true } });
		const principal = await this.transaction.principal.findFirst({ where: { id: command.requester.principalId, siloId: command.siloId, subject: command.requester.subjectId, issuer: command.requester.issuer }, select: { id: true } });
		const lease = await this.transaction.conversationComputerActiveLease.findFirst({ where: { conversationId: command.conversationId, siloId: command.siloId, computerId: command.computerId, leaseId, leaseGeneration: command.generation, expiresAt: { gt: now } }, select: { leaseId: true } });
		if (conversation === null || membership?.status !== OrgMemberStatus.Active || principal === null || lease === null)
			throw new ConversationComputerStopDenied("conversation Stop requester or active lease is unavailable");
		const caller = { siloId: command.siloId, principalId: command.requester.principalId, subjectId: command.requester.subjectId, externalIssuer: command.requester.issuer, verifiedAuthenticationAt: command.requester.authenticatedAt };
		const eligibility = new PrismaConversationProductAuthorizationRepository(this.transaction);
		if (!await eligibility.isCurrentlyEligible(caller, command.conversationId, ProductAuthorizationActions.Use))
			throw new ConversationComputerStopDenied("conversation Stop requester lacks current conversation Use authority");
		const authorization = new PrismaAuthorizationAuthority(this.transaction);
		const admitted = await authorization.admitPrincipal({ siloId: command.siloId, principalId: command.requester.principalId, actorKind: "user", actorId: command.requester.principalId, resource: { kind: ProductAuthorizationResourceKinds.Conversation, id: command.conversationId }, action: ProductAuthorizationActions.Use, argumentsDigest: commandDigest, nowEpochMs: now.getTime() });
		if (admitted.outcome !== AuthorizationDecisionOutcomes.Allow || admitted.evidence === null)
			throw new ConversationComputerStopDenied("conversation Stop requester lacks current conversation Use authority");
		return admitted.evidence.decisionDigest;
	}
}
