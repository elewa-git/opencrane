import type { PersonalExecutionEvidenceAuthorityPort } from "@opencrane/backend/server/agents/agent-services";
import type { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";

import type { ConversationExecutionSubjectCoordinates, ActiveConversationComputerLeaseReader } from "./conversation-execution-subject-admission.types";
import type { ExecutionSubjectAuthority } from "./session-assembly.types";

/** Binds the personal evidence repository to the exact run-admission transaction. */
export type PersonalExecutionEvidenceAuthorityFactory = (transaction: Parameters<ExecutionSubjectAuthority["load"]>[2]) => PersonalExecutionEvidenceAuthorityPort;

/** Dependencies that join the two checked histories with transaction-bound product evidence. */
export interface PersonalConversationExecutionSubjectDependencies
{
	readonly coordinates: ConversationExecutionSubjectCoordinates;
	readonly identityHistory: Pick<AgentIdentityHistory, "loadActive">;
	readonly executionEvidence: PersonalExecutionEvidenceAuthorityFactory;
	readonly computerHistory: ActiveConversationComputerLeaseReader;
}
