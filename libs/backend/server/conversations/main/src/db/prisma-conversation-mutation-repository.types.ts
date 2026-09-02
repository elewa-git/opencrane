import type { RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import type { AgentThreadOrigin } from "@opencrane/backend/conversations/agent-threads";

import { ConversationAuthorityOutcomes, type ConversationWriteDenial, type CreateConversationResult, type MarkAgentThreadReadResult, type MutateConversationResult } from "../types/conversation-authority-result.types";
import type { ConversationCaller } from "../types/conversation-caller.types";
import type { CreateConversationRequest, SubmitConversationMessageRequest } from "../types/conversation-request.types";
import type { ConversationAttachmentAdmissionPort } from "../conversation-message-admission.types";

/** Transaction-scoped durable conversation mutations. */
export interface ConversationMutationRepository
{
	create(caller: ConversationCaller, conversationId: string, request: CreateConversationRequest): Promise<CreateConversationResult>;
	setArchived(caller: ConversationCaller, conversationId: string, archived: boolean): Promise<MutateConversationResult>;
	close(caller: ConversationCaller, conversationId: string): Promise<MutateConversationResult>;
	markAgentThreadRead(caller: ConversationCaller, parentConversationId: string, childConversationId: string, observedPosition: bigint): Promise<MarkAgentThreadReadResult>;
	admitOrdinaryMessage(caller: ConversationCaller, conversationId: string, messageId: string, request: SubmitConversationMessageRequest, attachments: ConversationAttachmentAdmissionPort): Promise<{ readonly outcome: ConversationAuthorityOutcomes.Accepted } | { readonly outcome: ConversationAuthorityOutcomes.Denied; readonly reason: ConversationWriteDenial }>;
	prepareAgentThread(caller: ConversationCaller, parentConversationId: string, parentMessageId: string, childConversationId: string, request: SubmitConversationMessageRequest, attachments: ConversationAttachmentAdmissionPort): Promise<{ readonly personaProfileId: string; readonly personaRevisionId: string }>;
	persistAgentThread(caller: ConversationCaller, origin: AgentThreadOrigin, personaProfileId: string, childMessageId: string, parentRequest: SubmitConversationMessageRequest, childRequest: SubmitConversationMessageRequest, attachments: ConversationAttachmentAdmissionPort): Promise<void>;
}

/**
 * Makes a {@link ConversationMutationRepository} bound to the agent-thread run transaction.
 *
 * Group Agent-thread creation uses this factory while it prepares the child conversation and
 * commits its first run. The factory never serves AgentSession participant input, which belongs to
 * immutable ConversationComputer history.
 *
 * Called by: `PrismaConversationMessageAdmissionUnitOfWork._admitAgentThreadMessage`.
 * Supplied by `_CreateSelfConversationsRouter` (prisma-self-conversations.router.ts).
 */
export interface ConversationMutationRepositoryFactory
{
	(transaction: RunAdmissionTransaction): ConversationMutationRepository;
}
