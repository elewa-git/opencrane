import type { PersonalExecutionEvidenceAuthorityPort } from "@opencrane/backend/server/agents/agent-services";
import type { AgentScope, ClaimedLeaseScope, ComputerLease, ComputerScope, ConversationComputer } from "@opencrane/contracts";
import type { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";

import type { ExecutionSubjectAuthority } from "./session-assembly.types";

/**
 * Exact conversation-owned coordinates that a personal execution subject must recheck.
 *
 * The conversation package builds its run admission command from this shape and adds the message
 * input; this package owns the shape because run input compilation sits below conversations and
 * must not depend on them.
 */
export interface PersonalConversationExecutionSubjectCoordinates
{
	/** Stable logical run identifier derived from the pending immutable entry. */
	readonly runId: string;
	/** Names the silo, conversation, computer and agent identity proven by the active computer projection. */
	readonly computer: ComputerScope;
	/** Names the bound agent service, its published revision and the computer profile revision. */
	readonly agent: AgentScope;
	/** Names the active lease, its generation and the SandboxClaim whose Pod binding was verified. */
	readonly lease: ClaimedLeaseScope;
	/** Principal stamped on the pending human entry and rechecked against current membership and Use authority. */
	readonly requesterPrincipalId: string;
	/** Issuer loaded from that exact durable Principal rather than accepted from the computer. */
	readonly requesterIssuer: string;
	/** Subject loaded from that exact durable Principal rather than accepted from the computer. */
	readonly requesterSubjectId: string;
	/** Verified credential authentication instant preserved on the immutable human author. */
	readonly requesterAuthenticatedAt: string;
	/** Immutable pending entry used as the admission idempotency coordinate. */
	readonly requestIdempotencyKey: string;
}

/** Selects the computer whose current active lease the subject must recheck. */
export interface ActiveConversationComputerLeaseQuery
{
	/** Names the silo, conversation, computer and agent identity the stored snapshot must match. */
	readonly computer: ComputerScope;
	/** Identifies the immutable profile revision that must remain bound to this computer. */
	readonly profileRevisionId: string;
	/** Server-owned instant used to reject an expired lease. */
	readonly nowEpochMilliseconds: number;
}

/** Current computer snapshot with its active lease, as the history owner reports it. */
export interface ActiveConversationComputerLease
{
	readonly computer: ConversationComputer;
	readonly lease: ComputerLease;
}

/** Reads the current active lease of one computer; the conversations package supplies the implementation. */
export interface ActiveConversationComputerLeaseReader
{
	/** Throws when the computer is missing, not warm, or its lease is not the current active one. */
	loadActiveLease(query: ActiveConversationComputerLeaseQuery): Promise<ActiveConversationComputerLease>;
}

/** Binds the personal evidence repository to the exact run-admission transaction. */
export type PersonalExecutionEvidenceAuthorityFactory = (transaction: Parameters<ExecutionSubjectAuthority["load"]>[2]) => PersonalExecutionEvidenceAuthorityPort;

/** Dependencies that join the two checked histories with transaction-bound product evidence. */
export interface PersonalConversationExecutionSubjectDependencies
{
	readonly coordinates: PersonalConversationExecutionSubjectCoordinates;
	readonly identityHistory: Pick<AgentIdentityHistory, "loadActive">;
	readonly executionEvidence: PersonalExecutionEvidenceAuthorityFactory;
	readonly computerHistory: ActiveConversationComputerLeaseReader;
}
