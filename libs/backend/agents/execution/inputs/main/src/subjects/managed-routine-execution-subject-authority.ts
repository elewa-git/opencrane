import { ExecutionEvidenceOutcomes } from "@opencrane/backend/server/agents/agent-services";
import { ___CreateLogger, type Logger } from "@opencrane/backend/observability";
import type { RoutineRunAdmissionCommand } from "@opencrane/backend/agents/execution/runs";
import { AgentIdentityKinds, AgentRunTriggers } from "@opencrane/contracts";
import type { ExecutionSubject } from "@opencrane/models/agents";

import { SessionAssemblyLoadOutcomes, type ExecutionSubjectAuthority, type SessionAssemblyCommand, type SessionAssemblyLoad } from "../assembly/session-assembly.types";
import { _MatchesConversationExecutionLease } from "./conversation-execution-subject.validator";
import type { ManagedRoutineExecutionSubjectCoordinates, ManagedRoutineExecutionSubjectDependencies } from "./managed-routine-execution-subject-authority.types";

/** Reports failed authority reads without recording routine instructions or requester credentials. */
const _log = ___CreateLogger("routine-run-admission");

/** Builds a managed execution subject from one stored routine firing and current authority. */
export class ManagedRoutineExecutionSubjectAuthority implements ExecutionSubjectAuthority
{
	/** Receives product-owned occurrence coordinates and transaction-scoped authority readers. */
	public constructor(private readonly dependencies: ManagedRoutineExecutionSubjectDependencies, private readonly log: Pick<Logger, "warn"> = _log) {}

	/** Rejects changed firing, identity, revision, requester, and lease coordinates before admission. */
	public async load(command: SessionAssemblyCommand, run: Parameters<ExecutionSubjectAuthority["load"]>[1], transaction: Parameters<ExecutionSubjectAuthority["load"]>[2]): Promise<SessionAssemblyLoad<ExecutionSubject>>
	{
		if (command.trigger === AgentRunTriggers.Interactive || command.conversationId === null || !_MatchesRoutineCommand(command, run, this.dependencies.coordinates))
			return { outcome: SessionAssemblyLoadOutcomes.Denied, reason: "identity_unavailable" };
		const { computer, agent, lease } = this.dependencies.coordinates;
		const principalId = await this.dependencies.resolvePrincipalId(transaction);
		if (principalId === null || principalId === command.routineInput.requesterPrincipalId)
			return { outcome: SessionAssemblyLoadOutcomes.Denied, reason: "identity_unavailable" };
		let identity;
		let active;
		try
		{
			identity = await this.dependencies.identityHistory.loadActive({ siloId: command.siloId, agentIdentityId: computer.agentIdentityId, agentServiceId: agent.agentServiceId, principalId });
			active = await this.dependencies.computerHistory.loadActiveLease({ computer: { siloId: command.siloId, computerId: computer.computerId, conversationId: command.conversationId, agentIdentityId: computer.agentIdentityId }, profileRevisionId: agent.profileRevisionId, nowEpochMilliseconds: transaction.admittedAtEpochMs });
		}
		catch (err)
		{
			this.log.warn({ err, siloId: command.siloId, runId: command.runId, agentServiceId: command.agentServiceId }, "Routine identity or computer authority could not be read");
			return { outcome: SessionAssemblyLoadOutcomes.Denied, reason: "identity_unavailable" };
		}
		if (identity.identity.kind !== AgentIdentityKinds.Managed || identity.identity.principalId !== principalId
			|| identity.identity.id !== computer.agentIdentityId || identity.identity.siloId !== command.siloId || identity.identity.agentServiceId !== agent.agentServiceId
			|| !_MatchesConversationExecutionLease(active, this.dependencies.coordinates))
			return { outcome: SessionAssemblyLoadOutcomes.Denied, reason: "identity_unavailable" };
		if (transaction.authorization === undefined)
			return { outcome: SessionAssemblyLoadOutcomes.Denied, reason: "product_authorization_unavailable" };
		const evidence = await this.dependencies.executionEvidence(transaction).load({ identity: identity.identity, requesterPrincipalId: command.routineInput.requesterPrincipalId, agentRevisionId: run.agentRevisionId }, { authorization: transaction.authorization, admittedAtEpochMs: transaction.admittedAtEpochMs });
		if (evidence.outcome === ExecutionEvidenceOutcomes.Denied)
			return evidence;
		const value = evidence.value;
		if (value.membership.principalId !== principalId || value.membership.siloId !== command.siloId || value.membership.agentServiceId !== agent.agentServiceId || value.membership.agentRevisionId !== run.agentRevisionId
			|| value.requesterMembership.principalId !== command.routineInput.requesterPrincipalId || value.requesterMembership.siloId !== command.siloId)
			return { outcome: SessionAssemblyLoadOutcomes.Denied, reason: "identity_unavailable" };
		return { outcome: SessionAssemblyLoadOutcomes.Loaded, value: {
			schemaVersion: 1, siloId: command.siloId, agentIdentityId: computer.agentIdentityId, principalId,
			identity: { agentIdentityId: computer.agentIdentityId, principalId, siloId: command.siloId, headRevision: identity.revision.toString(), headDigest: identity.headDigest, decisionEvidenceId: identity.headEventId, verifiedAt: transaction.admittedAt },
			membership: value.membership,
			capability: { agentIdentityId: computer.agentIdentityId, computerId: computer.computerId, capabilitySetDigest: value.capability.effectiveBoundaryAttachmentDigest, effectiveContractDigest: value.capability.effectiveContractDigest, decisionEvidenceId: value.membership.decisionEvidenceId, decidedAt: transaction.admittedAt },
			runScope: { siloId: command.siloId, runId: command.runId, attempt: 1, agentServiceId: agent.agentServiceId, agentRevisionId: agent.agentRevisionId },
			computerScope: { siloId: command.siloId, computerId: computer.computerId, leaseId: lease.leaseId, leaseGeneration: lease.leaseGeneration },
			requester: { siloId: command.siloId, requesterPrincipalId: command.routineInput.requesterPrincipalId, requestIdempotencyKey: command.requestIdempotencyKey, authenticatedAt: command.routineInput.requesterAuthenticatedAt, membership: value.requesterMembership },
			admission: { authorizingPrincipalId: command.routineInput.requesterPrincipalId, decisionEvidenceId: value.admissionDecisionDigest, admittedAt: transaction.admittedAt },
		} };
	}
}

/** Check that product-owned command and prepared occurrence coordinates have not changed. */
function _MatchesRoutineCommand(command: RoutineRunAdmissionCommand, run: Parameters<ExecutionSubjectAuthority["load"]>[1], coordinates: ManagedRoutineExecutionSubjectCoordinates): boolean
{
	return command.runId === coordinates.runId && command.siloId === coordinates.computer.siloId
		&& command.conversationId === coordinates.computer.conversationId && command.agentServiceId === coordinates.agent.agentServiceId
		&& run.agentServiceId === coordinates.agent.agentServiceId && run.agentRevisionId === coordinates.agent.agentRevisionId
		&& command.requestIdempotencyKey === coordinates.requestIdempotencyKey
		&& command.routineInput.routineId === coordinates.routine.routineId
		&& command.routineInput.routineRevision === coordinates.routine.routineRevision
		&& command.routineInput.firingId === coordinates.routine.firingId
		&& command.routineInput.scheduledSlot === coordinates.routine.scheduledSlot
		&& command.routineInput.requesterPrincipalId === coordinates.routine.requesterPrincipalId
		&& command.routineInput.requesterIssuer === coordinates.routine.requesterIssuer
		&& command.routineInput.requesterSubjectId === coordinates.routine.requesterSubjectId
		&& command.routineInput.requesterAuthenticatedAt === coordinates.routine.requesterAuthenticatedAt
		&& command.routineInput.workflowTaskId === coordinates.routine.workflowTaskId
		&& command.routineInput.workflowTaskName === coordinates.routine.workflowTaskName
		&& command.routineInput.workflowTaskKey === coordinates.routine.workflowTaskKey
		&& Number.isSafeInteger(coordinates.lease.leaseGeneration) && coordinates.lease.leaseGeneration > 0;
}
