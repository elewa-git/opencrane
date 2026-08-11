import { ConversationLifecycles, ConversationModes, MessageRoles, MessageSources, MessageStates, type ConversationCreationRequest, type MessageContentBlock } from "@opencrane/models/conversations";

/** Browser-session identity derived by the server before conversation authority is consulted. */
export interface ConversationCaller
{
	/** Silo selected from the authenticated request host. */
	readonly siloId: string;
	/** Verified OIDC subject from the authenticated session. */
	readonly subjectId: string;
}

/** Immutable-mode conversation creation request after model-owned transport validation. */
export type CreateConversationRequest = ConversationCreationRequest;

/** Participant-authored message request after bounded block validation. */
export interface SubmitConversationMessageRequest
{
	/** Caller key scoped to one conversation and canonical body. */
	readonly idempotencyKey: string;
	/** Ordered validated render blocks. */
	readonly blocks: readonly MessageContentBlock[];
}

/** Participant-local conversation list row. */
export interface ConversationSummary
{
	readonly id: string;
	readonly mode: ConversationModes;
	readonly lifecycle: ConversationLifecycles;
	readonly agentServiceId: string | null;
	readonly participantUserIds: readonly string[];
	readonly archivedAt: string | null;
	readonly readThroughPosition: string;
	readonly updatedAt: string;
}

/** Canonical participant-visible message ordered by its timeline position. */
export interface ConversationMessageView
{
	readonly id: string;
	readonly position: string;
	readonly role: MessageRoles;
	readonly state: MessageStates;
	readonly source: MessageSources;
	readonly blocks: readonly MessageContentBlock[];
	readonly runId: string | null;
	readonly userId: string | null;
	readonly createdAt: string;
	readonly completedAt: string | null;
}

/** Participant-visible conversation detail and bounded canonical message history. */
export interface ConversationDetail extends ConversationSummary
{
	readonly visibleFromPosition: string;
	readonly accessEndedPosition: string | null;
	readonly messages: readonly ConversationMessageView[];
}

/** Stable fail-closed denials whose string values are preserved on the participant API wire. */
export enum ConversationWriteDenialReasons
{
	/** The selected conversation or current caller authority is unavailable. */
	ConversationUnavailable = "conversation_unavailable",
	/** The monotonic lifecycle already prevents future writes. */
	ConversationClosed = "conversation_closed",
	/** The immutable mode does not own the requested command. */
	CommandNotSupported = "command_not_supported",
	/** A foreground run already owns the agent-session write lane. */
	ActiveRun = "active_run",
	/** A durable idempotency key was reused with different authority or content. */
	IdempotencyConflict = "idempotency_conflict",
	/** One or more requested participants lack active silo membership. */
	ParticipantUnavailable = "participant_unavailable",
	/** The requested personal agent service is unavailable for admission. */
	AgentServiceUnavailable = "agent_service_unavailable",
	/** The bounded admission lane is full and the caller may retry later. */
	CapacityLimited = "capacity_limited",
	/** The canonical persistence authority could not complete the operation. */
	PersistenceUnavailable = "persistence_unavailable",
}

/** Stable fail-closed write denial returned without exposing foreign authority facts. */
export type ConversationWriteDenial = ConversationWriteDenialReasons;

/** Stable result discriminants whose readable values are preserved on the participant API wire. */
export enum ConversationAuthorityOutcomes
{
	/** A new immutable conversation was committed. */
	Created = "created",
	/** A fail-closed authority decision prevented the operation. */
	Denied = "denied",
	/** A new canonical message was committed. */
	Accepted = "accepted",
	/** An exact retry returned its existing canonical message. */
	Idempotent = "idempotent",
	/** An existing conversation or participant coordinate changed. */
	Changed = "changed",
}

/** Result from creating a conversation. */
export type CreateConversationResult = { readonly outcome: ConversationAuthorityOutcomes.Created; readonly conversation: ConversationDetail } | { readonly outcome: ConversationAuthorityOutcomes.Denied; readonly reason: ConversationWriteDenial };

/** Result from admitting or deduplicating a participant message. */
export type SubmitConversationMessageResult = { readonly outcome: ConversationAuthorityOutcomes.Accepted | ConversationAuthorityOutcomes.Idempotent; readonly message: ConversationMessageView } | { readonly outcome: ConversationAuthorityOutcomes.Denied; readonly reason: ConversationWriteDenial };

/** Result from one participant-owned conversation mutation. */
export type MutateConversationResult = { readonly outcome: ConversationAuthorityOutcomes.Changed; readonly conversation: ConversationDetail } | { readonly outcome: ConversationAuthorityOutcomes.Denied; readonly reason: ConversationWriteDenial };

/** Participant-bound application authority consumed by the self-service router. */
export interface ConversationUnitOfWork
{
	list(caller: ConversationCaller, includeArchived: boolean): Promise<readonly ConversationSummary[]>;
	open(caller: ConversationCaller, conversationId: string): Promise<ConversationDetail | null>;
	create(caller: ConversationCaller, request: CreateConversationRequest): Promise<CreateConversationResult>;
	submitMessage(caller: ConversationCaller, conversationId: string, request: SubmitConversationMessageRequest): Promise<SubmitConversationMessageResult>;
	setArchived(caller: ConversationCaller, conversationId: string, archived: boolean): Promise<MutateConversationResult>;
	close(caller: ConversationCaller, conversationId: string): Promise<MutateConversationResult>;
}
