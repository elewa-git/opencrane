import type { ConversationElicitation, ElicitationBody, ElicitationPurposes, ElicitationResponseProjection, SubmitElicitationResponse } from "@opencrane/contracts";
import type { RunInputSnapshot } from "@opencrane/contracts";
import type { ToolInvocationClaim, ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import type { JsonValue } from "@opencrane/util";

/** Stable fail-closed result of checking one exact personal-memory permission receipt. */
export enum PersonalMemoryPermissionVerificationOutcomes
{
	/** The current active receipt matches every immutable invocation and snapshot coordinate. */
	Authorized = "authorized",
	/** Permission is absent, stale, expired, consumed, or bound to different authority. */
	Denied = "denied",
}

/** Result of checking personal-memory permission without reading any remembered fact content. */
export type PersonalMemoryPermissionVerificationResult =
	| { readonly outcome: PersonalMemoryPermissionVerificationOutcomes.Authorized }
	| { readonly outcome: PersonalMemoryPermissionVerificationOutcomes.Denied };

/** Production gate that opens and verifies one execution-user memory permission. */
export interface PersonalMemoryPermissionAuthority
{
	/** Open or replay the request for the exact awaiting invocation and immutable snapshot. */
	openMemoryPermission(invocation: ToolInvocationRecord, snapshot: RunInputSnapshot, now: Date): Promise<boolean>;
	/** Verify the exact accepted receipt and current dispatch claim without consuming either. */
	verifyMemoryPermission(invocation: ToolInvocationRecord, claim: ToolInvocationClaim, snapshot: RunInputSnapshot, now: Date): Promise<PersonalMemoryPermissionVerificationResult>;
}

/** Server-derived coordinates for opening one runtime-proposed request. */
export interface OpenElicitationCommand
{
	/** Stable request identifier derived from admitted candidate evidence. */
	readonly requestId: string;
	/** Current silo from trusted run authority. */
	readonly siloId: string;
	/** Current agent-session conversation, which is the canonical thread coordinate. */
	readonly conversationId: string;
	/** Exact active run. */
	readonly runId: string;
	/** Exact active attempt. */
	readonly attempt: number;
	/** Participant selected by server-owned conversation policy. */
	readonly assignedParticipantId: string;
	/** Runtime caller-stable key. */
	readonly requestKey: string;
	/** Server-owned purpose strategy. */
	readonly purpose: ElicitationPurposes;
	/** Validated participant-facing body. */
	readonly body: ElicitationBody;
	/** Protected purpose payload never copied into client projections. */
	readonly purposePayload?: JsonValue;
	/** Digest binding the protected purpose payload. */
	readonly purposePayloadDigest: string;
	/** Whether the response requires fresh verified reauthentication. */
	readonly requiresStepUp: boolean;
	/** Server-owned request instant. */
	readonly now: Date;
	/** Server-owned response deadline. */
	readonly expiresAt: Date;
}

/** Session-derived caller authority for one response. */
export interface RespondToElicitationCommand
{
	/** Silo derived from authenticated host and session. */
	readonly siloId: string;
	/** Conversation named by the authenticated route. */
	readonly conversationId: string;
	/** Stable request path coordinate. */
	readonly requestId: string;
	/** Authenticated subject; the browser cannot replace it. */
	readonly subjectId: string;
	/** Server-derived verified step-up instant. */
	readonly verifiedStepUpAt: Date | null;
	/** Idempotent typed browser response. */
	readonly submission: SubmitElicitationResponse;
	/** Trusted decision instant. */
	readonly now: Date;
}

/** Authoritative response outcome returned by the unit of work. */
export type RespondToElicitationResult =
	| { readonly outcome: "accepted"; readonly projection: ElicitationResponseProjection }
	| { readonly outcome: "not_found" | "unauthorized" | "expired" | "conflict" | "invalid_response" | "step_up_required" };

/** Read-only self projection port used by replay and direct reads. */
export interface SelfElicitationQueryRepository
{
	/** Read one request only when the caller remains its active assigned participant. */
	readOwned(siloId: string, conversationId: string, requestId: string, subjectId: string, now: Date): Promise<ConversationElicitation | null>;
	/** List current cursorless overlays for one exact owned conversation. */
	listOpenOwned(siloId: string, conversationId: string, subjectId: string, now: Date): Promise<readonly ConversationElicitation[]>;
	/** List recent canonical request references for the caller's derived Activity index. */
	listActivityOwned(siloId: string, subjectId: string, limit: number, now: Date): Promise<readonly ConversationElicitation[]>;
}

/** Atomic authority for request creation and one response/resume decision. */
export interface ElicitationUnitOfWork extends SelfElicitationQueryRepository
{
	/** Pause the exact run and create or replay one participant request in one transaction. */
	open(command: OpenElicitationCommand): Promise<ConversationElicitation | null>;
	/** Attribute, apply, and resume one response in one transaction. */
	respond(command: RespondToElicitationCommand): Promise<RespondToElicitationResult>;
}

/** Trusted server command for expiring every due request on one waiting run attempt. */
export interface ExpireElicitationBatchCommand
{
	/** Exact run whose row the caller already locked. */
	readonly runId: string;
	/** Current attempt fence. */
	readonly attempt: number;
	/** Trusted server time used for every deadline comparison. */
	readonly now: Date;
}

/** Result of applying all due purpose strategies inside one held transaction. */
export interface ExpireElicitationBatchResult
{
	/** Number of generic elicitation requests moved to their terminal expired state. */
	readonly expiredCount: number;
	/** Whether the final request released the waiting run back to runtime command polling. */
	readonly resumed: boolean;
}

/** Transaction-bound persistence authority constructed only by the unit of work. */
export interface ElicitationRepository extends ElicitationUnitOfWork, PersonalMemoryPermissionAuthority
{
	/** Expire all due requests for one exact waiting run attempt. */
	expireDue(command: ExpireElicitationBatchCommand): Promise<ExpireElicitationBatchResult>;
}
