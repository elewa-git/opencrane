import type { Prisma } from "@prisma/client";

import type { AgentIdentity } from "@opencrane/contracts";
import { PrismaAuthorizationAuthority, type ProductAuthorizationWorkloadContext } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import { PrismaGroupChildAccessRepository } from "../../../children/db/prisma-group-child-access-repository";
import type { ConversationToolDispatchDependencies } from "./conversation-tool-dispatch.types";
import type { ConversationToolCurrentAccess, ConversationToolCurrentMembership, ConversationToolRunEvidence } from "./conversation-tool-dispatch-evidence.types";

/** Rechecks who may use this conversation and tool, recording decisions in the existing transaction. */
export class PrismaConversationToolAccessAuthority implements ConversationToolCurrentAccess
{
	/** Delegate membership and tool assignment to their existing owners on this same transaction. */
	public constructor(private readonly transaction: Prisma.TransactionClient, private readonly dependencies: ConversationToolDispatchDependencies) {}

	/** Keep the agent's membership and the requesting person's membership as separate expiry limits. */
	public async admitUntil(run: ConversationToolRunEvidence, identity: AgentIdentity, workload: ProductAuthorizationWorkloadContext, decisionTime: number): Promise<number | null>
	{
		const authorization = new PrismaAuthorizationAuthority(this.transaction);
		const membership = await this._LoadMembership(run, identity, authorization, decisionTime);
		if (membership === null)
			return null;
		if (!await this._AdmitRequester(run, membership, authorization, decisionTime))
			return null;
		if (!await this._AdmitTool(run, workload, authorization, decisionTime))
			return null;
		return Math.min(Date.parse(membership.requester.trustedUntil), Date.parse(membership.executionTrustedUntil));
	}

	/** Ask agent-services to check the identity's existing personal or company membership rules. */
	private async _LoadMembership(run: ConversationToolRunEvidence, identity: AgentIdentity, authorization: PrismaAuthorizationAuthority, decisionTime: number): Promise<ConversationToolCurrentMembership | null>
	{
		const execution = this.dependencies.executionEvidence(this.transaction);
		const evidenceTransaction = { authorization, admittedAtEpochMs: decisionTime };
		const command = { requesterPrincipalId: run.subject.requester.requesterPrincipalId, agentRevisionId: run.subject.runScope.agentRevisionId };
		if (identity.kind === "proxied")
		{
			const result = await execution.loadPersonal({ ...command, identity }, evidenceTransaction);
			if (result.outcome !== "loaded")
				return null;
			return { requester: result.value.membership, executionTrustedUntil: result.value.membership.trustedUntil };
		}
		if (identity.kind === "managed")
		{
			const result = await execution.loadManaged({ ...command, identity }, evidenceTransaction);
			if (result.outcome !== "loaded")
				return null;
			return { requester: result.value.requesterMembership, executionTrustedUntil: result.value.membership.trustedUntil };
		}
		return null;
	}

	/** Require both current participation and current permission, including a child chat's parent access. */
	private async _AdmitRequester(run: ConversationToolRunEvidence, membership: ConversationToolCurrentMembership, authorization: PrismaAuthorizationAuthority, decisionTime: number): Promise<boolean>
	{
		const requester = await this.transaction.principal.findFirst({
			where: { id: run.subject.requester.requesterPrincipalId, siloId: run.siloId },
			select: { subject: true, issuer: true },
		});
		if (requester === null)
			return false;
		const caller = {
			siloId: run.siloId, principalId: run.subject.requester.requesterPrincipalId,
			subjectId: requester.subject, externalIssuer: requester.issuer,
			verifiedAuthenticationAt: run.subject.requester.authenticatedAt,
		};
		const participant = await this.transaction.conversationParticipant.findFirst({
			where: { conversationId: run.conversationId, userId: requester.subject, accessEndedPosition: null },
			select: { userId: true },
		});
		const childAccess = new PrismaGroupChildAccessRepository(this.transaction);
		if (participant === null || !await childAccess.mayAccess(caller, run.conversationId))
			return false;
		const decision = await authorization.admitPrincipal({
			siloId: run.siloId, principalId: caller.principalId, actorKind: "user", actorId: caller.principalId,
			resource: { kind: ProductAuthorizationResourceKinds.Conversation, id: run.conversationId },
			action: ProductAuthorizationActions.Use, argumentsDigest: run.argumentsDigest,
			membershipRevision: this.dependencies.membershipRevision(membership.requester),
			nowEpochMs: Math.max(decisionTime, Date.now()),
		});
		return decision.outcome === AuthorizationDecisionOutcomes.Allow && decision.evidence !== null;
	}

	/** Recheck assignment and every saved permission; the verified executor identity owns the audit entry. */
	private async _AdmitTool(run: ConversationToolRunEvidence, workload: ProductAuthorizationWorkloadContext, authorization: PrismaAuthorizationAuthority, decisionTime: number): Promise<boolean>
	{
		const scope = run.subject.runScope;
		const eligibility = this.dependencies.toolEligibility(this.transaction);
		const assignment = { siloId: run.siloId, agentServiceId: scope.agentServiceId, agentRevisionId: scope.agentRevisionId, toolRevisionId: run.toolRevisionId };
		if (!await eligibility.isEligible(assignment))
			return false;
		if (!run.authorization.coordinates.some(coordinate => coordinate.resource.kind === ProductAuthorizationResourceKinds.McpToolRevision && coordinate.resource.id === run.toolRevisionId && coordinate.action === ProductAuthorizationActions.Invoke))
			return false;
		for (const coordinate of run.authorization.coordinates)
		{
			const decision = await authorization.admitPrincipal({
				siloId: run.siloId, principalId: run.subject.principalId, actorKind: "workload", actorId: workload.podUid, workload,
				run: { runId: scope.runId, attempt: scope.attempt, agentServiceId: scope.agentServiceId, agentRevisionId: scope.agentRevisionId },
				...coordinate, argumentsDigest: run.argumentsDigest, nowEpochMs: Math.max(decisionTime, Date.now()),
			});
			if (decision.outcome !== AuthorizationDecisionOutcomes.Allow || decision.evidence === null)
				return false;
		}
		return true;
	}
}
