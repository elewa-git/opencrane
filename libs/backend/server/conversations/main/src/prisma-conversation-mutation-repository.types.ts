import type { RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

import type { ConversationCaller, ConversationWriteDenial, CreateConversationRequest, SubmitConversationMessageRequest } from "./conversation-authority.types.js";

/** Mutation outcomes that do not expose persistence implementation details. */
export type ConversationMutationStatus = "changed" | "unavailable" | "active_run";

/** Transaction-scoped durable conversation mutations. */
export interface ConversationMutationRepository
{
	create(caller: ConversationCaller, conversationId: string, request: CreateConversationRequest): Promise<{ readonly outcome: "created" } | { readonly outcome: "denied"; readonly reason: ConversationWriteDenial }>;
	setArchived(caller: ConversationCaller, conversationId: string, archived: boolean): Promise<ConversationMutationStatus>;
	close(caller: ConversationCaller, conversationId: string): Promise<ConversationMutationStatus>;
	admitOrdinaryMessage(caller: ConversationCaller, conversationId: string, messageId: string, request: SubmitConversationMessageRequest): Promise<{ readonly outcome: "accepted" } | { readonly outcome: "denied"; readonly reason: ConversationWriteDenial }>;
	persistAgentMessage(caller: ConversationCaller, conversationId: string, messageId: string, runId: string, request: SubmitConversationMessageRequest): Promise<void>;
}

/** Creates a mutation repository over run admission's exact final transaction. */
export interface ConversationMutationRepositoryFactory
{
	(transaction: RunAdmissionTransaction): ConversationMutationRepository;
}
