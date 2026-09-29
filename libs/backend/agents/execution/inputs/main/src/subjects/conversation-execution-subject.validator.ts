import { AgentRunTriggers } from "@opencrane/contracts";

import type { ExecutionSubjectAuthority, SessionAssemblyCommand } from "../assembly/session-assembly.types";
import type { ActiveConversationComputerLease, PersonalConversationExecutionSubjectCoordinates } from "./personal-conversation-execution-subject-authority.types";

/**
 * Checks that admission still uses the run and requester captured from conversation history.
 * Personal and managed subject authorities call this before reading identity or permission evidence.
 * It checks coordinates, not permission; the caller must still load current authority in its transaction.
 * @param command - The input command being admitted.
 * @param run - The run loaded by the admission transaction.
 * @param coordinates - The conversation's saved run, requester and lease coordinates.
 * @returns Whether those coordinates agree and the proposed generation is a positive integer.
 */
export function _MatchesConversationExecutionCommand(command: SessionAssemblyCommand, run: Parameters<ExecutionSubjectAuthority["load"]>[1], coordinates: PersonalConversationExecutionSubjectCoordinates): boolean
{
	if (command.trigger !== AgentRunTriggers.Interactive)
		return false;
	const matchesRun = command.runId === coordinates.runId && command.siloId === coordinates.computer.siloId
		&& command.conversationId === coordinates.computer.conversationId && command.agentServiceId === coordinates.agent.agentServiceId
		&& run.agentServiceId === coordinates.agent.agentServiceId && run.agentRevisionId === coordinates.agent.agentRevisionId;
	const matchesRequester = command.requester.issuer === coordinates.requesterIssuer
		&& command.requester.subjectId === coordinates.requesterSubjectId
		&& command.requester.authenticatedAt === coordinates.requesterAuthenticatedAt
		&& command.requestIdempotencyKey === coordinates.requestIdempotencyKey;
	return matchesRun && matchesRequester && Number.isSafeInteger(coordinates.lease.leaseGeneration) && coordinates.lease.leaseGeneration > 0;
}

/**
 * Rejects a computer or lease substituted after the conversation selected its execution attempt.
 * Personal and managed subject authorities share these comparisons so their lease checks cannot drift.
 * The history reader remains responsible for Warm/Active state and expiry at the admission instant.
 * @param active - The computer and active lease returned by that history reader.
 * @param coordinates - The conversation's saved computer, profile and claimed lease.
 * @returns Whether every execution coordinate still matches; a false result must deny admission.
 */
export function _MatchesConversationExecutionLease(active: ActiveConversationComputerLease, coordinates: Pick<PersonalConversationExecutionSubjectCoordinates, "computer" | "agent" | "lease">): boolean
{
	const matchesComputer = active.computer.siloId === coordinates.computer.siloId
		&& active.computer.id === coordinates.computer.computerId
		&& active.computer.conversationId === coordinates.computer.conversationId
		&& active.computer.agentIdentityId === coordinates.computer.agentIdentityId
		&& active.computer.profileRevisionId === coordinates.agent.profileRevisionId;
	const matchesLease = active.lease.id === coordinates.lease.leaseId
		&& active.lease.computerId === coordinates.computer.computerId
		&& active.lease.generation === coordinates.lease.leaseGeneration
		&& active.lease.sandboxClaimId === coordinates.lease.sandboxClaimId;
	return matchesComputer && matchesLease;
}
