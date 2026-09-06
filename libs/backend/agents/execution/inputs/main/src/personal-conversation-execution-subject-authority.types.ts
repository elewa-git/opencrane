import type { PersonalExecutionEvidenceAuthorityPort } from "@opencrane/backend/server/agents/agent-services";
import type { ConversationComputerHistory } from "@opencrane/backend/server/conversations";
import type { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";

import type { ExecutionSubjectAuthority } from "./session-assembly.types";

/** Exact conversation-owned coordinates that a personal execution subject must recheck. */
export interface PersonalConversationExecutionSubjectCoordinates
{
	readonly runId: string;
	readonly siloId: string;
	readonly conversationId: string;
	readonly agentServiceId: string;
	readonly agentRevisionId: string;
	readonly agentIdentityId: string;
	readonly profileRevisionId: string;
	readonly requesterPrincipalId: string;
	readonly requesterIssuer: string;
	readonly requesterSubjectId: string;
	readonly requesterAuthenticatedAt: string;
	readonly requestIdempotencyKey: string;
	readonly computerId: string;
	readonly leaseId: string;
	readonly leaseGeneration: number;
	readonly sandboxClaimId: string;
}

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
