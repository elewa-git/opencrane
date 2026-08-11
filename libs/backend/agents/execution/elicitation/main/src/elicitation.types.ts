import type { ConversationElicitation, ElicitationBody, ElicitationPurposes, ElicitationResponseProjection, SubmitElicitationResponse } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

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

/** Transaction-bound persistence authority constructed only by the unit of work. */
export interface ElicitationRepository extends ElicitationUnitOfWork {}
