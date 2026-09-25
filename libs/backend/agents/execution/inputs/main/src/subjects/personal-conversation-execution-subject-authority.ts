import { AgentIdentityKinds } from "@opencrane/contracts";
import { ExecutionEvidenceOutcomes, PersonalExecutionEvidenceDenialReasons, type PersonalExecutionEvidenceTransaction } from "@opencrane/backend/server/agents/agent-services";
import type { ExecutionSubject } from "@opencrane/models/agents";

import { SessionAssemblyLoadOutcomes, type ExecutionSubjectAuthority, type SessionAssemblyCommand, type SessionAssemblyLoad } from "../assembly/session-assembly.types";
import type { PersonalConversationExecutionSubjectDependencies } from "./personal-conversation-execution-subject-authority.types";
import { _MatchesConversationExecutionCommand, _MatchesConversationExecutionLease } from "./conversation-execution-subject.validator";

/** Builds an attempt-one personal execution subject only from current authority evidence. */
export class PersonalConversationExecutionSubjectAuthority implements ExecutionSubjectAuthority
{
	/** Binds the saved conversation coordinates to current identity, lease and permission readers. */
	public constructor(private readonly dependencies: PersonalConversationExecutionSubjectDependencies) {}

	/** Rechecks every run, identity, requester, computer, and lease coordinate at the admission fence. */
	public async load(command: SessionAssemblyCommand, run: Parameters<ExecutionSubjectAuthority["load"]>[1], transaction: Parameters<ExecutionSubjectAuthority["load"]>[2]): Promise<SessionAssemblyLoad<ExecutionSubject>>
	{
		const coordinates = this.dependencies.coordinates;
		const { computer, agent, lease } = coordinates;
		if (command.conversationId === null || command.trigger !== "interactive" || !_MatchesConversationExecutionCommand(command, run, coordinates)
			|| coordinates.requesterPrincipalId.trim().length === 0)
			return { outcome: SessionAssemblyLoadOutcomes.Denied, reason: "identity_unavailable" };

		let currentIdentity;
		try
		{
			currentIdentity = await this.dependencies.identityHistory.loadActive({ siloId: command.siloId, agentIdentityId: computer.agentIdentityId, agentServiceId: run.agentServiceId, principalId: coordinates.requesterPrincipalId });
		}
		catch
		{
			return { outcome: SessionAssemblyLoadOutcomes.Denied, reason: "identity_unavailable" };
		}
		if (currentIdentity.identity.kind !== AgentIdentityKinds.Proxied)
			return { outcome: SessionAssemblyLoadOutcomes.Denied, reason: "identity_unavailable" };

		if (transaction.authorization === undefined)
			return { outcome: SessionAssemblyLoadOutcomes.Denied, reason: "product_authorization_unavailable" };
		const evidence = await this.dependencies.executionEvidence(transaction).load({ identity: currentIdentity.identity, requesterPrincipalId: coordinates.requesterPrincipalId, agentRevisionId: run.agentRevisionId }, { authorization: transaction.authorization, admittedAtEpochMs: transaction.admittedAtEpochMs } as PersonalExecutionEvidenceTransaction);
		if (evidence.outcome === ExecutionEvidenceOutcomes.Denied)
			return { outcome: SessionAssemblyLoadOutcomes.Denied, reason: _EvidenceDenial(evidence.reason) };

		let activeComputer;
		try
		{
			activeComputer = await this.dependencies.computerHistory.loadActiveLease({ computer: { siloId: command.siloId, computerId: computer.computerId, conversationId: command.conversationId, agentIdentityId: computer.agentIdentityId }, profileRevisionId: agent.profileRevisionId, nowEpochMilliseconds: transaction.admittedAtEpochMs });
		}
		catch
		{
			return { outcome: SessionAssemblyLoadOutcomes.Denied, reason: "conversation_unavailable" };
		}

		const value = evidence.value;
		if (value.identity.siloId !== command.siloId || value.identity.agentIdentityId !== computer.agentIdentityId
			|| value.identity.agentServiceId !== run.agentServiceId || value.identity.agentRevisionId !== run.agentRevisionId
			|| value.identity.principalId !== coordinates.requesterPrincipalId || !_MatchesConversationExecutionLease(activeComputer, coordinates))
			return { outcome: SessionAssemblyLoadOutcomes.Denied, reason: "identity_unavailable" };

		// The stored execution subject keeps `computerScope` flat with `leaseId` and `leaseGeneration`: PostgreSQL triggers read that shape.
		const membership = value.membership;
		return { outcome: SessionAssemblyLoadOutcomes.Loaded, value: {
			schemaVersion: 1,
			siloId: command.siloId,
			agentIdentityId: computer.agentIdentityId,
			principalId: coordinates.requesterPrincipalId,
			identity: { agentIdentityId: computer.agentIdentityId, principalId: coordinates.requesterPrincipalId, siloId: command.siloId, headRevision: currentIdentity.revision.toString(10), headDigest: currentIdentity.headDigest, decisionEvidenceId: currentIdentity.headEventId, verifiedAt: transaction.admittedAt },
			membership,
			capability: { agentIdentityId: computer.agentIdentityId, computerId: computer.computerId, capabilitySetDigest: value.capability.effectiveBoundaryAttachmentDigest, effectiveContractDigest: value.capability.effectiveContractDigest, decisionEvidenceId: value.admissionDecisionDigest, decidedAt: transaction.admittedAt },
			runScope: { siloId: command.siloId, runId: command.runId, attempt: 1, agentServiceId: run.agentServiceId, agentRevisionId: run.agentRevisionId },
			computerScope: { siloId: command.siloId, computerId: computer.computerId, leaseId: lease.leaseId, leaseGeneration: lease.leaseGeneration },
			requester: { siloId: command.siloId, requesterPrincipalId: coordinates.requesterPrincipalId, requestIdempotencyKey: command.requestIdempotencyKey, authenticatedAt: command.requester.authenticatedAt, membership },
			admission: { authorizingPrincipalId: coordinates.requesterPrincipalId, decisionEvidenceId: value.admissionDecisionDigest, admittedAt: transaction.admittedAt },
		} };
	}
}

/** Keeps evidence-authority refusals inside the assembly refusal vocabulary. */
function _EvidenceDenial(reason: PersonalExecutionEvidenceDenialReasons): "identity_unavailable" | "run_not_admittable" | "membership_stale" | "product_authorization_unavailable"
{
	if (reason === PersonalExecutionEvidenceDenialReasons.RunNotAdmittable)
		return "run_not_admittable";
	if (reason === PersonalExecutionEvidenceDenialReasons.MembershipStale)
		return "membership_stale";
	if (reason === PersonalExecutionEvidenceDenialReasons.CapabilityUnavailable)
		return "product_authorization_unavailable";
	return "identity_unavailable";
}
