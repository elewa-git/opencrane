import { ConversationComputerRealizationKinds, type ConversationComputerRealization } from "@opencrane/contracts";

import type { ActiveConversationComputerLease, ConversationExecutionSubjectCoordinates } from "./conversation-execution-subject-admission.types";
import type { ExecutionSubjectAuthority, SessionAssemblyCommand } from "./session-assembly.types";

/**
 * Checks the caller-independent app and run coordinates before either authority reads identity state.
 *
 * Called by: personal and managed conversation execution-subject authorities.
 * @see _MatchesConversationExecutionSubjectAdmissionFence
 */
export function _MatchesConversationExecutionSubjectCommand(command: SessionAssemblyCommand, run: Parameters<ExecutionSubjectAuthority["load"]>[1], coordinates: ConversationExecutionSubjectCoordinates): boolean
{
	return command.conversationId !== null
		&& command.trigger === "interactive"
		&& command.runId === coordinates.runId
		&& command.siloId === coordinates.computer.siloId
		&& command.conversationId === coordinates.computer.conversationId
		&& command.agentServiceId === coordinates.agent.agentServiceId
		&& run.agentServiceId === coordinates.agent.agentServiceId
		&& run.agentRevisionId === coordinates.agent.agentRevisionId
		&& command.requester.issuer === coordinates.requesterIssuer
		&& command.requester.subjectId === coordinates.requesterSubjectId
		&& command.requester.authenticatedAt === coordinates.requesterAuthenticatedAt
		&& command.requestIdempotencyKey === coordinates.requestIdempotencyKey
		&& !!coordinates.requesterPrincipalId.trim()
		&& Number.isSafeInteger(coordinates.lease.leaseGeneration)
		&& coordinates.lease.leaseGeneration > 0;
}

/**
 * Fences one current computer and lease to the exact app-bound run coordinates shared by both identities.
 *
 * This comparison grants no identity or product authority. Personal and managed authorities must
 * separately prove their own identity, membership and capability evidence in the same transaction.
 *
 * Called by: personal and managed conversation execution-subject authorities after history loading.
 * @see ConversationExecutionSubjectCoordinates
 */
export function _MatchesConversationExecutionSubjectAdmissionFence(command: SessionAssemblyCommand, run: Parameters<ExecutionSubjectAuthority["load"]>[1], coordinates: ConversationExecutionSubjectCoordinates, active: ActiveConversationComputerLease): boolean
{
	return _MatchesConversationExecutionSubjectCommand(command, run, coordinates)
		&& active.computer.siloId === command.siloId
		&& active.computer.id === coordinates.computer.computerId
		&& active.computer.conversationId === command.conversationId
		&& active.computer.agentIdentityId === coordinates.computer.agentIdentityId
		&& active.computer.profileRevisionId === coordinates.agent.profileRevisionId
		&& active.lease.id === coordinates.lease.leaseId
		&& active.lease.computerId === coordinates.computer.computerId
		&& active.lease.generation === coordinates.lease.leaseGeneration
		&& _sameConversationComputerRealization(active.lease.realization, coordinates.lease.realization);
}

/** Compares the stable coordinates owned by each closed realization variant. */
function _sameConversationComputerRealization(current: ConversationComputerRealization, expected: ConversationComputerRealization): boolean
{
	if (current.kind !== expected.kind)
		return false;

	switch (expected.kind)
	{
		case ConversationComputerRealizationKinds.AgentSandbox:
			return current.kind === ConversationComputerRealizationKinds.AgentSandbox
				&& current.claimId === expected.claimId
				&& current.sandboxId === expected.sandboxId
				&& current.serviceFQDN === expected.serviceFQDN;

		case ConversationComputerRealizationKinds.HostDevelopmentProcess:
			return current.kind === ConversationComputerRealizationKinds.HostDevelopmentProcess
				&& current.processId === expected.processId
				&& current.endpoint === expected.endpoint;

		default:
			return _unreachableRealization(expected);
	}
}

/** Makes a future realization variant a compile-time addition to the admission fence. */
function _unreachableRealization(_realization: never): boolean
{
	return false;
}
