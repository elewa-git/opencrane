import type { JsonValue } from "@opencrane/util";

/** Version of the browser-safe, replayable conversation elicitation envelope. */
export const CONVERSATION_ELICITATION_VERSION = "opencrane.elicitation.v1";

/** Durable lifecycle of one server-owned request for participant input. */
export enum ElicitationRequestStates
{
	/** The selected participant may still answer the request. */
	Requested = "requested",
	/** An authoritative response was accepted. */
	Answered = "answered",
	/** The selected participant explicitly declined the request. */
	Declined = "declined",
	/** The server-owned response window ended. */
	Expired = "expired",
	/** Run cancellation closed the request. */
	Cancelled = "cancelled",
	/** The authority could not safely continue the request. */
	Failed = "failed",
}

/** Durable lifecycle of one idempotent response submission. */
export enum ElicitationResponseAttemptStates
{
	/** The server is validating and applying the response atomically. */
	Submitting = "submitting",
	/** The response became the request's authoritative outcome. */
	Accepted = "accepted",
	/** The response was refused without changing request authority. */
	Rejected = "rejected",
}

/** Supported interaction bodies rendered with one lifecycle contract. */
export enum ElicitationBodyKinds
{
	/** Explicit approve-or-deny decision. */
	Approval = "approval",
	/** Exactly one server-authored option. */
	SingleChoice = "single_choice",
	/** One or more server-authored options within a declared limit. */
	MultipleChoice = "multiple_choice",
	/** Bounded participant-authored text. */
	FreeText = "free_text",
}

/** Server-owned reason for requesting participant input. */
export enum ElicitationPurposes
{
	/** Ordinary additional input requested by the active runtime. */
	RuntimeInput = "runtime_input",
	/** Permission for one exact governed tool invocation. */
	ToolApproval = "tool_approval",
	/** One-use permission for an exact personal-memory invocation. */
	PersonalMemoryPermission = "personal_memory_permission",
	/** Confirmation of one reviewed server-bound A2UI action. */
	A2uiAction = "a2ui_action",
}

/** One bounded option authored by the server. */
export interface ElicitationChoice
{
	/** Stable opaque value returned when selected. */
	readonly value: string;
	/** Participant-facing option label. */
	readonly label: string;
	/** Optional bounded explanation of the consequence. */
	readonly description?: string;
}

/** Approval body with the exact consequential action disclosed. */
export interface ElicitationApprovalBody
{
	/** Body discriminant. */
	readonly kind: ElicitationBodyKinds.Approval;
	/** Participant-facing question. */
	readonly prompt: string;
	/** Exact action being considered. */
	readonly action: string;
	/** Server-selected target label. */
	readonly target: string;
	/** Plain-language description of data sent or changed. */
	readonly dataUse: string;
	/** External system label, when an external system is involved. */
	readonly externalSystem?: string;
	/** Plain-language consequence of approval. */
	readonly consequence: string;
	/** Optional bounded cost disclosure. */
	readonly cost?: string;
}

/** Body requiring exactly one server-authored choice. */
export interface ElicitationSingleChoiceBody
{
	/** Body discriminant. */
	readonly kind: ElicitationBodyKinds.SingleChoice;
	/** Participant-facing question. */
	readonly prompt: string;
	/** Bounded server-authored options. */
	readonly choices: readonly ElicitationChoice[];
}

/** Body allowing a bounded subset of server-authored choices. */
export interface ElicitationMultipleChoiceBody
{
	/** Body discriminant. */
	readonly kind: ElicitationBodyKinds.MultipleChoice;
	/** Participant-facing question. */
	readonly prompt: string;
	/** Bounded server-authored options. */
	readonly choices: readonly ElicitationChoice[];
	/** Minimum number of accepted selections. */
	readonly minimumSelections: number;
	/** Maximum number of accepted selections. */
	readonly maximumSelections: number;
}

/** Body accepting participant-authored text within server-owned bounds. */
export interface ElicitationFreeTextBody
{
	/** Body discriminant. */
	readonly kind: ElicitationBodyKinds.FreeText;
	/** Participant-facing question. */
	readonly prompt: string;
	/** Maximum accepted Unicode code points. */
	readonly maximumLength: number;
	/** Whether an empty trimmed response is accepted. */
	readonly allowEmpty: boolean;
}

/** Complete supported elicitation body union. */
export type ElicitationBody = ElicitationApprovalBody | ElicitationSingleChoiceBody | ElicitationMultipleChoiceBody | ElicitationFreeTextBody;

/** Browser-safe request projected from durable server authority. */
export interface ConversationElicitation
{
	/** Exact public contract version. */
	readonly version: typeof CONVERSATION_ELICITATION_VERSION;
	/** Stable request identifier. */
	readonly requestId: string;
	/** Canonical conversation-thread coordinate containing the active run. */
	readonly conversationId: string;
	/** Exact active run. */
	readonly runId: string;
	/** Exact run-attempt fence. */
	readonly attempt: number;
	/** Server-selected participant allowed to answer. */
	readonly assignedParticipantId: string;
	/** Server-owned request purpose. */
	readonly purpose: ElicitationPurposes;
	/** Finite durable request state. */
	readonly state: ElicitationRequestStates;
	/** Typed body shared by replay and live delivery. */
	readonly body: ElicitationBody;
	/** Whether verified OpenID Connect reauthentication is required. */
	readonly requiresStepUp: boolean;
	/** ISO-8601 request time. */
	readonly requestedAt: string;
	/** ISO-8601 response deadline. */
	readonly expiresAt: string;
	/** ISO-8601 terminal time after resolution. */
	readonly resolvedAt?: string;
	/** Fixed safe outcome reason with no provider body or secret material. */
	readonly safeReason?: string;
}

/** Participant answer carried through the sole authoritative response endpoint. */
export type ElicitationResponseValue =
	| { readonly kind: ElicitationBodyKinds.Approval; readonly approved: boolean }
	| { readonly kind: ElicitationBodyKinds.SingleChoice; readonly selection: string }
	| { readonly kind: ElicitationBodyKinds.MultipleChoice; readonly selections: readonly string[] }
	| { readonly kind: ElicitationBodyKinds.FreeText; readonly text: string };

/** Idempotent browser response body. Actor and run coordinates remain server-owned. */
export interface SubmitElicitationResponse
{
	/** Caller-stable key used to replay the same response safely. */
	readonly idempotencyKey: string;
	/** Typed response matching the persisted request body. */
	readonly response: ElicitationResponseValue;
}

/** Authoritative response projection returned after submission. */
export interface ElicitationResponseProjection
{
	/** Request that owns the outcome. */
	readonly requestId: string;
	/** Durable request state after the transaction. */
	readonly state: ElicitationRequestStates;
	/** Whether this call replayed the already-accepted identical response. */
	readonly idempotent: boolean;
	/** ISO-8601 terminal time. */
	readonly resolvedAt: string;
}

/** Browser-safe technical detail selected from explicit server vocabularies. */
export interface SafeToolTechnicalDetails
{
	/** Server-selected external system label. */
	readonly externalSystem?: string;
	/** Reviewed tool display identifier. */
	readonly toolIdentifier: string;
	/** Exact immutable tool revision label. */
	readonly toolRevision: string;
	/** Fixed safe failure category. */
	readonly failureCategory?: string;
	/** Fixed provider code explicitly admitted by the adapter. */
	readonly providerCode?: string;
	/** Bounded Hypertext Transfer Protocol status, when meaningful. */
	readonly httpStatus?: number;
	/** Server-authored summary that never derives from raw provider text. */
	readonly summary?: string;
	/** ISO-8601 occurrence time. */
	readonly occurredAt: string;
	/** Provider-free retry attempts already consumed. */
	readonly retryCount: number;
	/** Provider-free retry attempt limit. */
	readonly retryLimit: number;
}

/** Runtime-proposed request body; the server supplies respondent and authority coordinates. */
export interface RuntimeElicitationProposal
{
	/** Caller-stable key scoped to the exact run attempt. */
	readonly requestKey: string;
	/** Server-interpreted purpose strategy. */
	readonly purpose: ElicitationPurposes;
	/** Typed participant-facing body. */
	readonly body: ElicitationBody;
	/** Digest of the purpose-specific protected payload. */
	readonly purposePayloadDigest: string;
	/** Optional protected payload interpreted only by the purpose strategy. */
	readonly purposePayload?: JsonValue;
	/** Requested response window in seconds, bounded by the server. */
	readonly expiresInSeconds: number;
}
