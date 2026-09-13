import type { ExecutionSubject } from "@opencrane/models/agents";

import type { ManagedConversationExecutionSubjectDependencies } from "./managed-conversation-execution-subject-authority.types";
import type { ExecutionSubjectAuthority, SessionAssemblyCommand, SessionAssemblyLoad } from "../assembly/session-assembly.types";

/** Freezes a company assistant's own execution authority while retaining the requesting human separately. */
export class ManagedConversationExecutionSubjectAuthority implements ExecutionSubjectAuthority
{
	/** Receives app-bound coordinates and transaction-scoped evidence readers. */
	public constructor(private readonly dependencies: ManagedConversationExecutionSubjectDependencies) {}

	/** Rejects mismatched commands, identities, revisions and leases before producing a managed subject. */
	public async load(command: SessionAssemblyCommand, run: Parameters<ExecutionSubjectAuthority["load"]>[1], transaction: Parameters<ExecutionSubjectAuthority["load"]>[2]): Promise<SessionAssemblyLoad<ExecutionSubject>>
	{
		const coordinates = this.dependencies.coordinates;
		const { computer, agent, lease } = coordinates;
		if (command.conversationId === null || command.trigger !== "interactive" || command.runId !== coordinates.runId
			|| command.siloId !== computer.siloId || command.conversationId !== computer.conversationId
			|| command.agentServiceId !== agent.agentServiceId || run.agentServiceId !== agent.agentServiceId || run.agentRevisionId !== agent.agentRevisionId
			|| command.requester.issuer !== coordinates.requesterIssuer || command.requester.subjectId !== coordinates.requesterSubjectId
			|| command.requester.authenticatedAt !== coordinates.requesterAuthenticatedAt || command.requestIdempotencyKey !== coordinates.requestIdempotencyKey
			|| !Number.isSafeInteger(lease.leaseGeneration) || lease.leaseGeneration <= 0)
			return { outcome: "denied", reason: "identity_unavailable" };
		const principalId = await this.dependencies.resolvePrincipalId(transaction);
		if (principalId === null || principalId === coordinates.requesterPrincipalId)
			return { outcome: "denied", reason: "identity_unavailable" };
		let identity;
		let active;
		try
		{
			identity = await this.dependencies.identityHistory.loadActive({ siloId: command.siloId, agentIdentityId: computer.agentIdentityId, agentServiceId: agent.agentServiceId, principalId });
			active = await this.dependencies.computerHistory.loadActiveLease({ computer: { siloId: command.siloId, computerId: computer.computerId, conversationId: command.conversationId, agentIdentityId: computer.agentIdentityId }, profileRevisionId: agent.profileRevisionId, nowEpochMilliseconds: transaction.admittedAtEpochMs });
		}
		catch
		{
			return { outcome: "denied", reason: "identity_unavailable" };
		}
		if (identity.identity.kind !== "managed" || identity.identity.principalId !== principalId
			|| identity.identity.id !== computer.agentIdentityId || identity.identity.siloId !== command.siloId || identity.identity.agentServiceId !== agent.agentServiceId
			|| active.computer.siloId !== command.siloId || active.computer.id !== computer.computerId || active.computer.conversationId !== command.conversationId
			|| active.computer.agentIdentityId !== computer.agentIdentityId || active.computer.profileRevisionId !== agent.profileRevisionId
			|| active.lease.id !== lease.leaseId || active.lease.computerId !== computer.computerId || active.lease.generation !== lease.leaseGeneration || active.lease.sandboxClaimId !== lease.sandboxClaimId)
			return { outcome: "denied", reason: "identity_unavailable" };
		if (transaction.authorization === undefined)
			return { outcome: "denied", reason: "product_authorization_unavailable" };
		const evidence = await this.dependencies.executionEvidence(transaction).load({ identity: identity.identity, requesterPrincipalId: coordinates.requesterPrincipalId, agentRevisionId: run.agentRevisionId }, { authorization: transaction.authorization, admittedAtEpochMs: transaction.admittedAtEpochMs });
		if (evidence.outcome === "denied")
			return evidence;
		const value = evidence.value;
		if (value.membership.principalId !== principalId || value.membership.siloId !== command.siloId || value.membership.agentServiceId !== agent.agentServiceId || value.membership.agentRevisionId !== run.agentRevisionId
			|| value.requesterMembership.principalId !== coordinates.requesterPrincipalId || value.requesterMembership.siloId !== command.siloId)
			return { outcome: "denied", reason: "identity_unavailable" };
		return { outcome: "loaded", value: {
			schemaVersion: 1, siloId: command.siloId, agentIdentityId: computer.agentIdentityId, principalId,
			identity: { agentIdentityId: computer.agentIdentityId, principalId, siloId: command.siloId, headRevision: identity.revision.toString(), headDigest: identity.headDigest, decisionEvidenceId: identity.headEventId, verifiedAt: transaction.admittedAt },
			membership: value.membership,
			capability: { agentIdentityId: computer.agentIdentityId, computerId: computer.computerId, capabilitySetDigest: value.capability.effectiveBoundaryAttachmentDigest, effectiveContractDigest: value.capability.effectiveContractDigest, decisionEvidenceId: value.membership.decisionEvidenceId, decidedAt: transaction.admittedAt },
			runScope: { siloId: command.siloId, runId: command.runId, attempt: 1, agentServiceId: agent.agentServiceId, agentRevisionId: agent.agentRevisionId },
			computerScope: { siloId: command.siloId, computerId: computer.computerId, leaseId: lease.leaseId, leaseGeneration: lease.leaseGeneration },
			requester: { siloId: command.siloId, requesterPrincipalId: coordinates.requesterPrincipalId, requestIdempotencyKey: command.requestIdempotencyKey, authenticatedAt: command.requester.authenticatedAt, membership: value.requesterMembership },
			admission: { authorizingPrincipalId: coordinates.requesterPrincipalId, decisionEvidenceId: value.admissionDecisionDigest, admittedAt: transaction.admittedAt },
		} };
	}
}
