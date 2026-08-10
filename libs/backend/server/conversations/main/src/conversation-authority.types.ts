import type { MessageContentBlock } from "@opencrane/models/conversations";

/** Browser-session identity derived by the server before conversation authority is consulted. */
export interface ConversationCaller
{
	/** Silo selected from the authenticated request host. */
	readonly siloId: string;
	/** Verified OIDC subject from the authenticated session. */
	readonly subjectId: string;
}

/** Immutable-mode conversation creation request after transport validation. */
export type CreateConversationRequest =
	| { readonly mode: "agent_session"; readonly agentServiceId: string; readonly participantUserIds?: never }
	| { readonly mode: "direct" | "group"; readonly participantUserIds: readonly string[]; readonly agentServiceId?: never };

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
	readonly mode: "agent_session" | "direct" | "group";
	readonly lifecycle: "open" | "closed";
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
	readonly role: "user" | "assistant" | "tool" | "system";
	readonly state: "pending" | "streaming" | "completed" | "failed" | "cancelled";
	readonly source: "user_input" | "model_output" | "tool_result" | "platform";
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

/** Stable fail-closed write denials returned without exposing foreign authority facts. */
export type ConversationWriteDenial = "conversation_unavailable" | "conversation_closed" | "command_not_supported" | "active_run" | "idempotency_conflict" | "participant_unavailable" | "agent_service_unavailable" | "persistence_unavailable";

/** Result from creating a conversation. */
export type CreateConversationResult = { readonly outcome: "created"; readonly conversation: ConversationDetail } | { readonly outcome: "denied"; readonly reason: ConversationWriteDenial };

/** Result from admitting or deduplicating a participant message. */
export type SubmitConversationMessageResult = { readonly outcome: "accepted" | "idempotent"; readonly message: ConversationMessageView } | { readonly outcome: "denied"; readonly reason: ConversationWriteDenial };

/** Result from one participant-owned conversation mutation. */
export type MutateConversationResult = { readonly outcome: "changed"; readonly conversation: ConversationDetail } | { readonly outcome: "denied"; readonly reason: ConversationWriteDenial };

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
