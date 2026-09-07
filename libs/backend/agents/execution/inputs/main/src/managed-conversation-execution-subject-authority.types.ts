import type { ManagedExecutionEvidenceAuthorityPort } from "@opencrane/backend/server/agents/agent-services";
import type { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";

import type { PersonalConversationExecutionSubjectCoordinates, ActiveConversationComputerLeaseReader } from "./personal-conversation-execution-subject-authority.types";
import type { ExecutionSubjectAuthority } from "./session-assembly.types";

/** Joins checked company identity history, human requester evidence and the current computer lease. */
export interface ManagedConversationExecutionSubjectDependencies
{
	readonly coordinates: PersonalConversationExecutionSubjectCoordinates;
	readonly identityHistory: Pick<AgentIdentityHistory, "loadActive">;
	readonly computerHistory: ActiveConversationComputerLeaseReader;
	readonly executionEvidence: (transaction: Parameters<ExecutionSubjectAuthority["load"]>[2]) => ManagedExecutionEvidenceAuthorityPort;
	/** Loads the service's own persisted Principal before the identity history is queried. */
	readonly resolvePrincipalId: (transaction: Parameters<ExecutionSubjectAuthority["load"]>[2]) => Promise<string | null>;
}
