import type { AgentIdentity } from "@opencrane/contracts";
import type { ToolInvocationAuthorizationEvidence, ToolInvocationRecord, ProductAuthorizationWorkloadContext } from "@opencrane/backend/server/iam/authorization";
import type { ExecutionSubject, ExecutionSubjectHumanMembershipEvidence } from "@opencrane/models/agents";

import type { ConversationComputerCurrentCommand } from "@opencrane/backend/server/conversations/computers";

/** Saved run facts that still match this invocation and its original input snapshot. */
export interface ConversationToolRunEvidence
{
	/** Installation that owns the invocation. */
	readonly siloId: string;
	/** Conversation attached to the still-running attempt. */
	readonly conversationId: string;
	/** Exact tool revision selected for this invocation. */
	readonly toolRevisionId: string;
	/** Identity and membership facts saved when the run began. */
	readonly subject: ExecutionSubject;
	/** Permission coordinates saved with the invocation. */
	readonly authorization: ToolInvocationAuthorizationEvidence;
	/** Digest checked against the arguments the executor will receive. */
	readonly argumentsDigest: `sha256:${string}`;
	/** Original run deadline; a later permission check cannot extend it. */
	readonly deadlineEpochMs: number;
}

/** Reads the original run and budget without granting permission to dispatch. */
export interface ConversationToolRunEvidenceReader
{
	/** Return null when saved inputs no longer match, or the run has exhausted its budget. */
	load(invocation: ToolInvocationRecord, now: Date): Promise<ConversationToolRunEvidence | null>;
}

/** Current history agrees with the identity and computer lease saved on the run. */
export interface ConversationToolComputerEvidence
{
	/** Current identity, checked against the run's saved history head. */
	readonly identity: AgentIdentity;
	/** Expiry of the exact lease; reading it never renews it. */
	readonly leaseExpiresAtEpochMs: number;
}

/** Resolves history coordinates from the server's open-conversation projection. */
export interface ConversationToolComputerCoordinates
{
	/** Return null when this computer no longer belongs to an open agent conversation. */
	resolve(siloId: string, computerId: string): Promise<ConversationComputerCurrentCommand | null>;
}

/** Keeps the requesting person's membership separate from a managed agent's membership. */
export interface ConversationToolCurrentMembership
{
	/** Current evidence for the person who requested the run. */
	readonly requester: ExecutionSubjectHumanMembershipEvidence;
	/** Current execution membership expiry, which may be shorter than the person's. */
	readonly executionTrustedUntil: string;
}

/** Current requester identity and deadline returned after every access check succeeds. */
export interface ConversationToolCurrentAccessAdmission
{
	/** OIDC subject loaded from the exact Principal used for current conversation participation. */
	readonly requesterSubjectId: string;
	/** Earliest current membership expiry; later owners may only shorten it. */
	readonly notAfterEpochMs: number;
}

/** Physical actor that asks IAM to recheck the run's saved tool coordinates. */
export type ConversationToolAuthorizationActor =
	| { readonly actorKind: "workload"; readonly actorId: string; readonly workload: ProductAuthorizationWorkloadContext }
	| { readonly actorKind: "system"; readonly actorId: string; readonly workload?: never };

/** Rechecks current participation and permissions within the caller's transaction. */
export interface ConversationToolCurrentAccess
{
	/** Return the current requester and membership expiry only after every required permission is allowed. */
	admitUntil(run: ConversationToolRunEvidence, identity: AgentIdentity, actor: ConversationToolAuthorizationActor, decisionTime: number): Promise<ConversationToolCurrentAccessAdmission | null>;
}
