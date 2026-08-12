import type { RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

import { ConversationAuthorityOutcomes, type ConversationCaller, type ConversationWriteDenial, type CreateConversationRequest, type CreateConversationResult, type MutateConversationResult, type SubmitConversationMessageRequest } from "./conversation-authority.types.js";
import type { ConversationAttachmentAdmissionPort } from "./conversation-message-admission.types.js";

/** Transaction-scoped durable conversation mutations. */
export interface ConversationMutationRepository
{
	create(caller: ConversationCaller, conversationId: string, request: CreateConversationRequest): Promise<CreateConversationResult>;
	setArchived(caller: ConversationCaller, conversationId: string, archived: boolean): Promise<MutateConversationResult>;
	close(caller: ConversationCaller, conversationId: string): Promise<MutateConversationResult>;
	admitOrdinaryMessage(caller: ConversationCaller, conversationId: string, messageId: string, request: SubmitConversationMessageRequest, attachments: ConversationAttachmentAdmissionPort): Promise<{ readonly outcome: ConversationAuthorityOutcomes.Accepted } | { readonly outcome: ConversationAuthorityOutcomes.Denied; readonly reason: ConversationWriteDenial }>;
	persistAgentMessage(caller: ConversationCaller, conversationId: string, messageId: string, runId: string, request: SubmitConversationMessageRequest, attachments: ConversationAttachmentAdmissionPort): Promise<void>;
}

/** Creates a mutation repository over run admission's exact final transaction. */
export interface ConversationMutationRepositoryFactory
{
	(transaction: RunAdmissionTransaction): ConversationMutationRepository;
}
