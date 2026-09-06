import type { PersonalExecutionEvidenceTransaction } from "@opencrane/backend/server/agents/agent-services";
import { PersonalExecutionEvidenceDenialReasons } from "@opencrane/backend/server/agents/agent-services";
import type { ExecutionSubject } from "@opencrane/models/agents";

import type { ExecutionSubjectAuthority, SessionAssemblyCommand, SessionAssemblyLoad } from "./session-assembly.types";
import type { PersonalConversationExecutionSubjectCoordinates, PersonalConversationExecutionSubjectDependencies } from "./personal-conversation-execution-subject-authority.types";

/** Builds an attempt-one personal execution subject only from current authority evidence. */
export class PersonalConversationExecutionSubjectAuthority implements ExecutionSubjectAuthority
{
	public constructor(private readonly dependencies: PersonalConversationExecutionSubjectDependencies) {}

	/** Rechecks every run, identity, requester, computer, and lease coordinate at the admission fence. */
	public async load(command: SessionAssemblyCommand, run: Parameters<ExecutionSubjectAuthority["load"]>[1], transaction: Parameters<ExecutionSubjectAuthority["load"]>[2]): Promise<SessionAssemblyLoad<ExecutionSubject>>
	{
		const coordinates = this.dependencies.coordinates;
		const { computer, agent, lease } = coordinates;
		if (command.conversationId === null || command.trigger !== "interactive" || !_MatchesCommand(command, run, coordinates)
			|| coordinates.requesterPrincipalId.trim().length === 0
			|| !Number.isSafeInteger(lease.leaseGeneration) || lease.leaseGeneration <= 0)
			return { outcome: "denied", reason: "identity_unavailable" };

		let currentIdentity;
		try
		{
			currentIdentity = await this.dependencies.identityHistory.loadActive({ siloId: command.siloId, agentIdentityId: computer.agentIdentityId, agentServiceId: run.agentServiceId, principalId: coordinates.requesterPrincipalId });
		}
		catch
		{
			return { outcome: "denied", reason: "identity_unavailable" };
		}
		if (currentIdentity.identity.kind !== "proxied")
			return { outcome: "denied", reason: "identity_unavailable" };

		if (transaction.authorization === undefined)
			return { outcome: "denied", reason: "product_authorization_unavailable" };
		const evidence = await this.dependencies.executionEvidence(transaction).load({ identity: currentIdentity.identity, requesterPrincipalId: coordinates.requesterPrincipalId, agentRevisionId: run.agentRevisionId }, { authorization: transaction.authorization, admittedAtEpochMs: transaction.admittedAtEpochMs } as PersonalExecutionEvidenceTransaction);
		if (evidence.outcome === "denied")
			return { outcome: "denied", reason: _EvidenceDenial(evidence.reason) };

		let activeComputer;
		try
		{
			activeComputer = await this.dependencies.computerHistory.loadActiveLease({ computer: { siloId: command.siloId, computerId: computer.computerId, conversationId: command.conversationId, agentIdentityId: computer.agentIdentityId }, profileRevisionId: agent.profileRevisionId, nowEpochMilliseconds: transaction.admittedAtEpochMs });
		}
		catch
		{
			return { outcome: "denied", reason: "conversation_unavailable" };
		}

		const value = evidence.value;
		if (value.identity.siloId !== command.siloId || value.identity.agentIdentityId !== computer.agentIdentityId
			|| value.identity.agentServiceId !== run.agentServiceId || value.identity.agentRevisionId !== run.agentRevisionId
			|| value.identity.principalId !== coordinates.requesterPrincipalId || activeComputer.computer.siloId !== command.siloId
			|| activeComputer.computer.conversationId !== command.conversationId || activeComputer.computer.agentIdentityId !== computer.agentIdentityId
			|| activeComputer.computer.profileRevisionId !== agent.profileRevisionId || activeComputer.lease.id !== lease.leaseId
			|| activeComputer.lease.computerId !== computer.computerId || activeComputer.lease.generation !== lease.leaseGeneration
			|| activeComputer.lease.sandboxClaimId !== lease.sandboxClaimId)
			return { outcome: "denied", reason: "identity_unavailable" };

		// The stored execution subject keeps `computerScope` flat with `leaseId` and `leaseGeneration`: PostgreSQL triggers read that shape.
		return { outcome: "loaded", value: {
			schemaVersion: 1,
			siloId: command.siloId,
			agentIdentityId: computer.agentIdentityId,
			principalId: coordinates.requesterPrincipalId,
			identity: { agentIdentityId: computer.agentIdentityId, principalId: coordinates.requesterPrincipalId, siloId: command.siloId, headRevision: currentIdentity.revision.toString(10), headDigest: currentIdentity.headDigest, decisionEvidenceId: currentIdentity.headEventId, verifiedAt: transaction.admittedAt },
			membership: { principalId: coordinates.requesterPrincipalId, siloId: command.siloId, revision: value.membership.revision, assertionId: value.membership.assertionId, payloadDigest: value.membership.payloadDigest, decisionEvidenceId: value.membership.assertionId, trustedUntil: value.membership.trustedUntil },
			capability: { agentIdentityId: computer.agentIdentityId, computerId: computer.computerId, capabilitySetDigest: value.capability.effectiveBoundaryAttachmentDigest, effectiveContractDigest: value.capability.effectiveContractDigest, decisionEvidenceId: value.admissionDecisionDigest, decidedAt: transaction.admittedAt },
			runScope: { siloId: command.siloId, runId: command.runId, attempt: 1, agentServiceId: run.agentServiceId, agentRevisionId: run.agentRevisionId },
			computerScope: { siloId: command.siloId, computerId: computer.computerId, leaseId: lease.leaseId, leaseGeneration: lease.leaseGeneration },
			requester: { siloId: command.siloId, requesterPrincipalId: coordinates.requesterPrincipalId, requestIdempotencyKey: command.requestIdempotencyKey, authenticatedAt: command.requester.authenticatedAt },
			admission: { authorizingPrincipalId: coordinates.requesterPrincipalId, decisionEvidenceId: value.admissionDecisionDigest, admittedAt: transaction.admittedAt },
		} };
	}
}

/** Compares the app-bound conversation command with the command admitted by the transaction. */
function _MatchesCommand(command: SessionAssemblyCommand, run: Parameters<ExecutionSubjectAuthority["load"]>[1], coordinates: PersonalConversationExecutionSubjectCoordinates): boolean
{
	return command.runId === coordinates.runId && command.siloId === coordinates.computer.siloId
		&& command.conversationId === coordinates.computer.conversationId && command.agentServiceId === coordinates.agent.agentServiceId
		&& run.agentServiceId === coordinates.agent.agentServiceId && run.agentRevisionId === coordinates.agent.agentRevisionId
		&& command.requester.issuer === coordinates.requesterIssuer && command.requester.subjectId === coordinates.requesterSubjectId
		&& command.requester.authenticatedAt === coordinates.requesterAuthenticatedAt
		&& command.requestIdempotencyKey === coordinates.requestIdempotencyKey;
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
