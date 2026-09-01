import type { ElicitationRequestEntry } from "@opencrane/contracts";
import type { HistoryAppendReceipt } from "@opencrane/backend/server/infra/history-store";
import type { JsonValue } from "@opencrane/util";

/** Carries the session identity that the authenticated transport resolved for a participant command. */
export interface ConversationComputerElicitationResolutionCaller
{
	/** Names the silo selected by the authenticated server session. */
	readonly siloId: string;
	/** Names the current principal whose product authorization is recorded. */
	readonly principalId: string;
	/** Names the user actor bound to the authenticated browser session. */
	readonly actorId: string;
}

/** Carries the only browser-selectable facts for resolving one outstanding elicitation. */
export interface ConversationComputerElicitationResolutionCommand
{
	/** Carries the trusted current caller rather than browser-selected authority coordinates. */
	readonly caller: ConversationComputerElicitationResolutionCaller;
	/** Names the conversation that contains the addressed request. */
	readonly conversationId: string;
	/** Names the immutable request entry that the participant intends to resolve. */
	readonly requestEntryId: string;
	/** Supplies the UUID idempotency key and KurrentDB event identifier for this resolution. */
	readonly resolutionId: string;
	/** Carries a typed answer, or null when the participant explicitly declines. */
	readonly response: JsonValue | null;
}

/** Resolves the active conversation participant for an already authenticated browser caller. */
export interface ConversationComputerElicitationResolutionParticipantResolver
{
	/** Returns the sole active participant bound to this caller in the requested conversation. */
	resolve(command: { readonly caller: ConversationComputerElicitationResolutionCaller; readonly conversationId: string }): Promise<{ readonly participantId: string }>;
}

/** Holds the digest-checked, request-schema-valid response before it is committed to protected storage. */
export interface PreparedConversationComputerElicitationResponse
{
	/** Binds the validated response value that the payload authority will store. */
	readonly responseDigest: `sha256:${string}`;
	/** Keeps the validated response opaque to the conversation history authority. */
	readonly payload: JsonValue;
}

/** Keeps request and response payload contents out of immutable conversation history. */
export interface ConversationComputerElicitationPayloadAuthority
{
	/** Validates an answer against the addressed request after digest-checking that request payload. */
	prepareResponse(command: { readonly siloId: string; readonly conversationId: string; readonly participantId: string; readonly request: ElicitationRequestEntry; readonly response: JsonValue }): Promise<PreparedConversationComputerElicitationResponse>;
	/** Stores the prepared response under server-derived ownership and returns the first exact `(request, resolutionId, digest)` winner on retry; changed reuse fails closed. */
	storeResponse(command: { readonly siloId: string; readonly conversationId: string; readonly participantId: string; readonly request: ElicitationRequestEntry; readonly resolutionId: string; readonly response: PreparedConversationComputerElicitationResponse }): Promise<{ readonly responsePayloadRef: string; readonly responsePayloadDigest: `sha256:${string}` }>;
}

/** Owns the current server time used for expiry and authorization decisions. */
export interface ConversationComputerElicitationResolutionClock
{
	/** Returns the server time used to choose the only terminal outcome this command may append. */
	now(): Date;
}

/** Returns the durable terminal resolution or exact response-lost retry receipt. */
export interface ConversationComputerElicitationResolutionResult
{
	/** Identifies the persisted terminal event, including the first winner on an exact retry. */
	readonly receipt: HistoryAppendReceipt;
	/** States whether the server accepted an answer, decline, or deadline expiry. */
	readonly state: "answered" | "declined" | "expired";
}
