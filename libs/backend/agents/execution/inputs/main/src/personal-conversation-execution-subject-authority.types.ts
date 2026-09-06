import type { PersonalExecutionEvidenceAuthorityPort } from "@opencrane/backend/server/agents/agent-services";
import type { ConversationComputerHistory, ConversationComputerRunAdmissionCommand } from "@opencrane/backend/server/conversations";
import type { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";

import type { ExecutionSubjectAuthority } from "./session-assembly.types";

/**
 * Exact conversation-owned coordinates that a personal execution subject must recheck.
 *
 * These are the run admission command's computer, agent, lease and requester facts; only the
 * message input is left out because the subject never reads history itself.
 * @see ConversationComputerRunAdmissionCommand for what each bundle fences.
 */
export type PersonalConversationExecutionSubjectCoordinates = Omit<ConversationComputerRunAdmissionCommand, "messageInput">;

/** Binds the personal evidence repository to the exact run-admission transaction. */
export type PersonalExecutionEvidenceAuthorityFactory = (transaction: Parameters<ExecutionSubjectAuthority["load"]>[2]) => PersonalExecutionEvidenceAuthorityPort;

/** Dependencies that join the two checked histories with transaction-bound product evidence. */
export interface PersonalConversationExecutionSubjectDependencies
{
	readonly coordinates: PersonalConversationExecutionSubjectCoordinates;
	readonly identityHistory: Pick<AgentIdentityHistory, "loadActive">;
	readonly executionEvidence: PersonalExecutionEvidenceAuthorityFactory;
	readonly computerHistory: Pick<ConversationComputerHistory, "loadActiveLease">;
}
