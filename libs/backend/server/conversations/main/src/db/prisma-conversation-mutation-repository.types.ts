import type { RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import type { AgentThreadOrigin } from "@opencrane/backend/conversations/agent-threads";

import { ConversationAuthorityOutcomes, type ConversationWriteDenial, type CreateConversationResult, type MarkAgentThreadReadResult, type MutateConversationResult } from "../types/conversation-authority-result.types.js";
import type { ConversationCaller } from "../types/conversation-caller.types.js";
import type { CreateConversationRequest, SubmitConversationMessageRequest } from "../types/conversation-request.types.js";
import type { ConversationAttachmentAdmissionPort } from "../conversation-message-admission.types.js";

/** Transaction-scoped durable conversation mutations. */
export interface ConversationMutationRepository
{
	create(caller: ConversationCaller, conversationId: string, request: CreateConversationRequest): Promise<CreateConversationResult>;
	setArchived(caller: ConversationCaller, conversationId: string, archived: boolean): Promise<MutateConversationResult>;
	close(caller: ConversationCaller, conversationId: string): Promise<MutateConversationResult>;
	markAgentThreadRead(caller: ConversationCaller, parentConversationId: string, childConversationId: string, observedPosition: bigint): Promise<MarkAgentThreadReadResult>;
	admitOrdinaryMessage(caller: ConversationCaller, conversationId: string, messageId: string, request: SubmitConversationMessageRequest, attachments: ConversationAttachmentAdmissionPort): Promise<{ readonly outcome: ConversationAuthorityOutcomes.Accepted } | { readonly outcome: ConversationAuthorityOutcomes.Denied; readonly reason: ConversationWriteDenial }>;
	persistAgentMessage(caller: ConversationCaller, conversationId: string, messageId: string, runId: string, request: SubmitConversationMessageRequest, attachments: ConversationAttachmentAdmissionPort): Promise<void>;
	prepareAgentThread(caller: ConversationCaller, parentConversationId: string, parentMessageId: string, childConversationId: string, request: SubmitConversationMessageRequest, attachments: ConversationAttachmentAdmissionPort): Promise<{ readonly personaProfileId: string; readonly personaRevisionId: string }>;
	persistAgentThread(caller: ConversationCaller, origin: AgentThreadOrigin, personaProfileId: string, childMessageId: string, parentRequest: SubmitConversationMessageRequest, childRequest: SubmitConversationMessageRequest, attachments: ConversationAttachmentAdmissionPort): Promise<void>;
}

/**
 * Makes a {@link ConversationMutationRepository} bound to a transaction that run admission
 * owns.
 *
 * This exists so the conversation package can write the user's message inside admission's
 * transaction without ever holding a client of its own. Admission calls the factory with its
 * live transaction at the moment the run is being committed, which is what makes "message and
 * run commit together" true rather than merely intended.
 *
 * Called by: `PrismaConversationUnitOfWork._admitAgentMessage`
 * (prisma-conversation-unit-of-work.ts). Supplied by `_CreateSelfConversationsRouter`
 * (prisma-self-conversations.router.ts).
 */
export interface ConversationMutationRepositoryFactory
{
	(transaction: RunAdmissionTransaction): ConversationMutationRepository;
}
