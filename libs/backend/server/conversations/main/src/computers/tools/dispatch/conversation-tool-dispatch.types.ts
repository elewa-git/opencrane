import type { AgentIdentity } from "@opencrane/contracts";
import type { AuthorizationAuthority, ProductAuthorizationWorkloadContext, ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import type { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";
import type { ExecutionSubject, ExecutionSubjectHumanMembershipEvidence } from "@opencrane/models/agents";

import type { ConversationComputerHistory } from "@opencrane/backend/server/conversations/computers";

/** Current execution facts needed by dispatch; agent-services owns their evaluation. */
export interface ConversationToolExecutionEvidence
{
	/** Read the personal service and the proxied human's current membership and permissions. */
	loadPersonal(command: { readonly identity: Extract<AgentIdentity, { kind: "proxied" }>; readonly requesterPrincipalId: string; readonly agentRevisionId: string }, transaction: ConversationToolEvidenceTransaction): Promise<ConversationToolEvidenceResult<{ readonly membership: ExecutionSubjectHumanMembershipEvidence }>>;
	/** Read company execution separately from the requesting human's membership and permissions. */
	loadManaged(command: { readonly identity: Extract<AgentIdentity, { kind: "managed" }>; readonly requesterPrincipalId: string; readonly agentRevisionId: string }, transaction: ConversationToolEvidenceTransaction): Promise<ConversationToolEvidenceResult<{ readonly membership: { readonly trustedUntil: string }; readonly requesterMembership: ExecutionSubjectHumanMembershipEvidence }>>;
}

/** Retain the existing evidence owner's loaded/denied result without copying its internal facts. */
export type ConversationToolEvidenceResult<T> = { readonly outcome: "loaded"; readonly value: T } | { readonly outcome: "denied"; readonly reason: string };

/** Share the central authorization authority and server observation time with the evidence owner. */
export interface ConversationToolEvidenceTransaction
{
	/** Record permissions in the same transaction as the eventual provider claim. */
	readonly authorization: AuthorizationAuthority;
	/** Bound newly checked membership to a server-owned observation time. */
	readonly admittedAtEpochMs: number;
}

/** Current evidence readers used before the MCP executor claims a conversation's tool call. */
export interface ConversationToolDispatchDependencies
{
	/** Read checked identity history without converting transport errors into policy denials. */
	readonly identities: Pick<AgentIdentityHistory, "load">;
	/** Read the current computer and lease without minting or renewing either. */
	readonly computers: Pick<ConversationComputerHistory, "load">;
	/** Bind existing personal and managed evidence owners to the claim transaction. */
	readonly executionEvidence: (transaction: unknown) => ConversationToolExecutionEvidence;
	/** Produce the membership revision with the existing IAM membership formatter. */
	readonly membershipRevision: (membership: ExecutionSubjectHumanMembershipEvidence) => number | undefined;
	/** Bind the existing MCP publication and assignment reader to the claim transaction. */
	readonly toolEligibility: (transaction: unknown) => ConversationToolAssignmentAuthority;
}

/** Exact saved tool and revision coordinates checked by the MCP-owned assignment reader. */
export type ConversationToolAssignmentCommand = Pick<ExecutionSubject["runScope"], "siloId" | "agentServiceId" | "agentRevisionId"> & {
	/** Identify the tool revision stored on the invocation. */
	readonly toolRevisionId: string;
	/** Principal that owns the personal or managed execution. */
	readonly ownerPrincipalId: string;
};

/** Preserve MCP ownership of current publication and tool assignment checks. */
export interface ConversationToolAssignmentAuthority
{
	/** Return true only while the exact tool remains assigned and its server is published. */
	isEligible(command: ConversationToolAssignmentCommand): Promise<boolean>;
}

/** Evaluate current conversation tool authority inside the caller's already-bound transaction. */
export interface ConversationToolDispatchAuthority
{
	/** Return the admitted absolute expiry in epoch milliseconds, null for refusal, or throw on unavailable evidence. */
	admitUntil(invocation: ToolInvocationRecord, now: Date, workload: ProductAuthorizationWorkloadContext): Promise<number | null>;
}
