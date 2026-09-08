import { AgentRunState, type Prisma } from "@prisma/client";

import { AgentIdentityStates, ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";
import { __DigestCanonicalJson, PrismaAuthorizationAuthority, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { ConversationToolDispatchAuthority, ConversationToolDispatchDependencies } from "../conversation-tool-dispatch.types";
import { PrismaConversationComputerLifecycleProjectionRepository } from "./prisma-conversation-computer-lifecycle-projection-repository";
import { PrismaGroupChildAccessRepository } from "./prisma-group-child-access-repository";

/**
 * Rechecks the run's current conversation, identity, membership, lease and tool permission.
 *
 * All PostgreSQL decisions share the MCP claim transaction. KurrentDB reads verify the lease and
 * identity observed before that claim; they cannot prevent a later cross-store revocation race.
 * Known inactive or missing state denies dispatch. History transport and validation errors escape
 * so the MCP transaction rolls back and no provider request starts.
 * Called by: the authorization-owned MCP participant before a run-owned dispatch claim.
 */
export class PrismaConversationToolDispatchAuthority implements ConversationToolDispatchAuthority
{
	/** Bind history readers and the deployment-selected membership configuration. */
	public constructor(private readonly transaction: Prisma.TransactionClient, private readonly dependencies: ConversationToolDispatchDependencies) {}

	/** Refuse substituted or outdated execution authority before admitting every saved resource coordinate. */
	public async isCurrentlyEligible(invocation: ToolInvocationRecord, now: Date): Promise<boolean>
	{
		const transaction = this.transaction;
		const evidence = invocation.authorizationEvidence;
		if (invocation.mcpTaskId !== null || invocation.runId === null || invocation.attempt === null || invocation.agentRevisionId === null
			|| evidence === null || !("executionSubject" in evidence))
			return false;
		if (invocation.effectiveArguments === null || invocation.effectiveArgumentsDigest === null)
			return false;
		const argumentsDigest = __DigestCanonicalJson(invocation.effectiveArguments);
		if (argumentsDigest !== invocation.effectiveArgumentsDigest)
			return false;
		const subject = evidence.executionSubject;
		const scope = subject.runScope;
		if (scope.runId !== invocation.runId || scope.attempt !== invocation.attempt || scope.siloId !== invocation.siloId
			|| scope.agentRevisionId !== invocation.agentRevisionId || Date.parse(subject.membership.trustedUntil) <= now.getTime()
			|| Date.parse(subject.requester.membership.trustedUntil) <= now.getTime())
			return false;
		const run = await transaction.agentRun.findFirst({ where: { id: invocation.runId, siloId: invocation.siloId, attempt: invocation.attempt, state: AgentRunState.Running, agentServiceId: scope.agentServiceId, agentRevisionId: scope.agentRevisionId, agentIdentityId: subject.agentIdentityId, principalId: subject.principalId }, select: { conversationId: true, executionSubject: true } });
		if (run === null || run.conversationId === null || ___DigestCanonicalJson(run.executionSubject as JsonValue) !== ___DigestCanonicalJson(subject as unknown as JsonValue))
			return false;
		const projection = new PrismaConversationComputerLifecycleProjectionRepository(this.transaction);
		const coordinates = await projection.resolve(invocation.siloId, subject.computerScope.computerId);
		if (coordinates === null || coordinates.computer.conversationId !== run.conversationId || coordinates.computer.agentIdentityId !== subject.agentIdentityId)
			return false;
		const identity = await this.dependencies.identities.load({ siloId: invocation.siloId, agentIdentityId: subject.agentIdentityId, agentServiceId: scope.agentServiceId, principalId: subject.principalId });
		if (identity === null || identity.identity.state !== AgentIdentityStates.Active || identity.headDigest !== subject.identity.headDigest || identity.revision.toString() !== subject.identity.headRevision)
			return false;
		const current = await this.dependencies.computers.load(coordinates);
		const lease = current?.lease;
		if (current === null || current.computer.state !== ConversationComputerStates.Warm || lease === null || lease === undefined
			|| lease.state !== ComputerLeaseStates.Active || lease.id !== subject.computerScope.leaseId
			|| lease.generation !== subject.computerScope.leaseGeneration || current.computer.leaseGeneration !== lease.generation
			|| lease.computerId !== subject.computerScope.computerId || lease.sandboxId === null || Date.parse(lease.expiresAt) <= now.getTime())
			return false;
		const decisionTime = Math.max(now.getTime(), Date.now());
		const authorization = new PrismaAuthorizationAuthority(this.transaction);
		const evidenceTransaction = { authorization, admittedAtEpochMs: decisionTime };
		const execution = this.dependencies.executionEvidence(transaction);
		const command = { identity: identity.identity, requesterPrincipalId: subject.requester.requesterPrincipalId, agentRevisionId: scope.agentRevisionId };
		let membership;
		let executionTrustedUntil;
		if (identity.identity.kind === "proxied")
		{
			const result = await execution.loadPersonal({ ...command, identity: identity.identity }, evidenceTransaction);
			if (result.outcome !== "loaded")
				return false;
			membership = result.value.membership;
			executionTrustedUntil = membership.trustedUntil;
		}
		else if (identity.identity.kind === "managed")
		{
			const result = await execution.loadManaged({ ...command, identity: identity.identity }, evidenceTransaction);
			if (result.outcome !== "loaded")
				return false;
			membership = result.value.requesterMembership;
			executionTrustedUntil = result.value.membership.trustedUntil;
		}
		else
			return false;
		const requester = await transaction.principal.findFirst({ where: { id: subject.requester.requesterPrincipalId, siloId: invocation.siloId }, select: { subject: true, issuer: true } });
		if (requester === null)
			return false;
		const caller = { siloId: invocation.siloId, principalId: subject.requester.requesterPrincipalId, subjectId: requester.subject, externalIssuer: requester.issuer, verifiedAuthenticationAt: subject.requester.authenticatedAt };
		const participant = await transaction.conversationParticipant.findFirst({ where: { conversationId: run.conversationId, userId: requester.subject, accessEndedPosition: null }, select: { userId: true } });
		const childAccess = new PrismaGroupChildAccessRepository(this.transaction);
		if (participant === null || !await childAccess.mayAccess(caller, run.conversationId))
			return false;
		const conversation = await authorization.admitPrincipal({ siloId: invocation.siloId, principalId: caller.principalId, actorKind: "user", actorId: caller.principalId, resource: { kind: ProductAuthorizationResourceKinds.Conversation, id: run.conversationId }, action: ProductAuthorizationActions.Use, argumentsDigest, membershipRevision: this.dependencies.membershipRevision(membership), nowEpochMs: Math.max(decisionTime, Date.now()) });
		if (conversation.outcome !== AuthorizationDecisionOutcomes.Allow || conversation.evidence === null)
			return false;
		const eligibility = this.dependencies.toolEligibility(transaction);
		if (!await eligibility.isEligible({ siloId: invocation.siloId, agentServiceId: scope.agentServiceId, agentRevisionId: scope.agentRevisionId, toolRevisionId: invocation.toolRevisionId }))
			return false;
		if (!evidence.coordinates.some(coordinate => coordinate.resource.kind === ProductAuthorizationResourceKinds.McpToolRevision && coordinate.resource.id === invocation.toolRevisionId && coordinate.action === ProductAuthorizationActions.Invoke))
			return false;
		for (const coordinate of evidence.coordinates)
		{
			const admitted = await authorization.admitPrincipal({ siloId: invocation.siloId, principalId: subject.principalId, actorKind: "workload", actorId: subject.agentIdentityId, ...coordinate, argumentsDigest, nowEpochMs: Math.max(decisionTime, Date.now()) });
			if (admitted.outcome !== AuthorizationDecisionOutcomes.Allow || admitted.evidence === null)
				return false;
		}
		const checkedAt = Math.max(now.getTime(), Date.now());
		return Date.parse(lease.expiresAt) > checkedAt && Date.parse(subject.membership.trustedUntil) > checkedAt
			&& Date.parse(subject.requester.membership.trustedUntil) > checkedAt && Date.parse(membership.trustedUntil) > checkedAt && Date.parse(executionTrustedUntil) > checkedAt;
	}
}
