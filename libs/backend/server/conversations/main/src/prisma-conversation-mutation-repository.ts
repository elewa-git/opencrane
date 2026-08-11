import { AgentServiceKind, AgentServiceState, ConversationLifecycle, ConversationMessageRole, ConversationMessageState, ConversationMode, OrgMemberStatus, Prisma } from "@prisma/client";

import { __DecideConversationCommand, ConversationCommandActions, ConversationCommandDenialReasons, ConversationCommandKinds, ConversationLifecycles, ConversationModes, MessageSources } from "@opencrane/models/conversations";

import { ConversationAuthorityOutcomes, ConversationWriteDenialReasons } from "./conversation-authority.types.js";
import type { ConversationCaller, ConversationDetail, ConversationWriteDenial, CreateConversationRequest, CreateConversationResult, MutateConversationResult, SubmitConversationMessageRequest } from "./conversation-authority.types.js";
import type { ConversationMutationRepository } from "./prisma-conversation-mutation-repository.types.js";
import type { ConversationAttachmentAdmissionPort } from "./conversation-message-admission.types.js";
import { PrismaConversationQueryRepository } from "./prisma-conversation-query-repository.js";

/** Exhaustive adapter mapping from model-owned creation modes to Prisma's generated enum. */
const _PERSISTED_MODE_BY_MODE: Readonly<Record<ConversationModes, ConversationMode>> = {
	[ConversationModes.AgentSession]: ConversationMode.AgentSession,
	[ConversationModes.Direct]: ConversationMode.Direct,
	[ConversationModes.Group]: ConversationMode.Group,
};

/** Transaction-scoped writer for immutable-mode conversations and participant messages. */
export class PrismaConversationMutationRepository implements ConversationMutationRepository
{
	private readonly transaction: Prisma.TransactionClient;
	private readonly query: PrismaConversationQueryRepository;

	/** Creates the writer and its query collaborator over the same transaction snapshot. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
		this.query = new PrismaConversationQueryRepository(this.transaction);
	}

	/** Creates one immutable-mode aggregate after checking every initial participant and service. */
	async create(caller: ConversationCaller, conversationId: string, request: CreateConversationRequest): Promise<CreateConversationResult>
	{
		// 1. Derive the exact initial participant set before querying any foreign membership facts.
		const participantUserIds = _participantIds(caller.subjectId, request);
		if (participantUserIds === null) return { outcome: ConversationAuthorityOutcomes.Denied, reason: ConversationWriteDenialReasons.ParticipantUnavailable };

		// 2. Require every participant, including the caller, to have active membership in this write snapshot.
		const membershipCount = await this.transaction.orgMembership.count({ where: { clusterTenant: caller.siloId, subject: { in: [...participantUserIds] }, status: OrgMemberStatus.Active } });
		if (membershipCount !== participantUserIds.length) return { outcome: ConversationAuthorityOutcomes.Denied, reason: ConversationWriteDenialReasons.ParticipantUnavailable };
		if (request.mode === ConversationModes.AgentSession)
		{
			const service = await this.transaction.agentService.findFirst({ where: { id: request.agentServiceId, siloId: caller.siloId, kind: AgentServiceKind.Personal, state: AgentServiceState.Active, activeRevisionId: { not: null } }, select: { id: true } });
			if (service === null) return { outcome: ConversationAuthorityOutcomes.Denied, reason: ConversationWriteDenialReasons.AgentServiceUnavailable };
		}

		// 3. Persist the immutable aggregate and every participant before projecting the committed response.
		await this.transaction.conversation.create({ data: { id: conversationId, siloId: caller.siloId, mode: _prismaMode(request.mode), agentServiceId: request.mode === ConversationModes.AgentSession ? request.agentServiceId : null } });
		for (const userId of participantUserIds) await this.transaction.conversationParticipant.create({ data: { conversationId, userId } });
		const conversation = _requireWrittenConversation(await this.query.open(caller, conversationId));
		return { outcome: ConversationAuthorityOutcomes.Created, conversation };
	}

	/** Changes only the caller's participant-local archived state. */
	async setArchived(caller: ConversationCaller, conversationId: string, archived: boolean): Promise<MutateConversationResult>
	{
		// 1. Revalidate active silo membership inside the serializable archive transaction.
		if (!await this.query.hasActiveCallerMembership(caller)) return { outcome: ConversationAuthorityOutcomes.Denied, reason: ConversationWriteDenialReasons.ConversationUnavailable };

		// 2. Change only the continuing participant's local visibility coordinate.
		const changed = await this.transaction.conversationParticipant.updateMany({ where: { conversationId, userId: caller.subjectId, accessEndedPosition: null, conversation: { siloId: caller.siloId } }, data: { archivedAt: archived ? new Date() : null } });
		if (changed.count !== 1) return { outcome: ConversationAuthorityOutcomes.Denied, reason: ConversationWriteDenialReasons.ConversationUnavailable };

		// 3. Project the response from the same membership-authorised write snapshot.
		const conversation = _requireWrittenConversation(await this.query.open(caller, conversationId));
		return { outcome: ConversationAuthorityOutcomes.Changed, conversation };
	}

	/** Closes only after the same transaction proves participant and foreground-run state. */
	async close(caller: ConversationCaller, conversationId: string): Promise<MutateConversationResult>
	{
		// 1. Load membership, participant, lifecycle, mode, binding, and run facts from this write snapshot.
		const context = await this.query.loadCommandContext(caller, conversationId);
		if (context === null) return { outcome: ConversationAuthorityOutcomes.Denied, reason: ConversationWriteDenialReasons.ConversationUnavailable };

		// 2. Route closure through the same exhaustive State-by-Command decision as every other write.
		const decision = __DecideConversationCommand({ ...context, command: { kind: ConversationCommandKinds.Close } });
		if (!decision.allowed) return { outcome: ConversationAuthorityOutcomes.Denied, reason: _writeDenialForDecision(decision.reason) };
		if (decision.action !== ConversationCommandActions.CloseConversation) return { outcome: ConversationAuthorityOutcomes.Denied, reason: ConversationWriteDenialReasons.CommandNotSupported };
		if (context.activeRunId !== null) return { outcome: ConversationAuthorityOutcomes.Denied, reason: ConversationWriteDenialReasons.ActiveRun };

		// 3. Apply the monotonic transition and project its result before this serializable transaction commits.
		const update = await this.transaction.conversation.updateMany({ where: { id: conversationId, siloId: caller.siloId, lifecycle: ConversationLifecycle.Open }, data: { lifecycle: ConversationLifecycle.Closed, closedAt: new Date() } });
		if (update.count !== 1) return { outcome: ConversationAuthorityOutcomes.Denied, reason: ConversationWriteDenialReasons.ConversationUnavailable };
		const conversation = _requireWrittenConversation(await this.query.open(caller, conversationId));
		return { outcome: ConversationAuthorityOutcomes.Changed, conversation };
	}

	/** Revalidates the mode strategy and persists one ordinary direct/group message. */
	async admitOrdinaryMessage(caller: ConversationCaller, conversationId: string, messageId: string, request: SubmitConversationMessageRequest, attachments: ConversationAttachmentAdmissionPort): Promise<{ readonly outcome: ConversationAuthorityOutcomes.Accepted } | { readonly outcome: ConversationAuthorityOutcomes.Denied; readonly reason: ConversationWriteDenial }>
	{
		const context = await this.query.loadCommandContext(caller, conversationId);
		if (context === null) return { outcome: ConversationAuthorityOutcomes.Denied, reason: ConversationWriteDenialReasons.ConversationUnavailable };
		const decision = __DecideConversationCommand({ ...context, command: { kind: ConversationCommandKinds.SubmitMessage } });
		if (!decision.allowed || decision.action !== ConversationCommandActions.AdmitOrdinaryMessage) return { outcome: ConversationAuthorityOutcomes.Denied, reason: context.lifecycle === ConversationLifecycles.Closed ? ConversationWriteDenialReasons.ConversationClosed : ConversationWriteDenialReasons.CommandNotSupported };
		await this.transaction.conversationMessage.create({ data: _messageData(messageId, conversationId, caller.subjectId, request, null) });
		await attachments.bindReadyAssets(caller, conversationId, messageId, request.blocks);
		return { outcome: ConversationAuthorityOutcomes.Accepted };
	}

	/** Persists a user message inside run admission's sole final transaction. */
	async persistAgentMessage(caller: ConversationCaller, conversationId: string, messageId: string, runId: string, request: SubmitConversationMessageRequest, attachments: ConversationAttachmentAdmissionPort): Promise<void>
	{
		// 1. Revalidate current silo membership and participant access inside run admission's final transaction.
		const context = await this.query.loadCommandContext(caller, conversationId);
		if (context === null) throw new Error("Conversation authority unavailable");

		// 2. Re-dispatch persisted mode and lifecycle through the exhaustive strategy after the run is staged.
		const decision = __DecideConversationCommand({ ...context, command: { kind: ConversationCommandKinds.SubmitMessage } });
		if (!decision.allowed || decision.action !== ConversationCommandActions.AdmitAgentRun) throw new Error("Conversation command unavailable");

		// 3. Persist the message only after every caller and immutable-mode fence remains valid.
		await this.transaction.conversationMessage.create({ data: _messageData(messageId, conversationId, caller.subjectId, request, runId) });
		await attachments.bindReadyAssets(caller, conversationId, messageId, request.blocks);
	}
}

/** Returns the exact initial participant set or null for an invalid mode cardinality. */
function _participantIds(subjectId: string, request: CreateConversationRequest): readonly string[] | null
{
	if (request.mode === ConversationModes.AgentSession) return [subjectId];
	const ids = [...new Set([subjectId, ...request.participantUserIds.map(function _Trim(value): string { return value.trim(); })])].filter(Boolean).sort();
	if (request.mode === ConversationModes.Direct) return ids.length === 2 ? ids : null;
	return ids.length >= 2 && ids.length <= 100 ? ids : null;
}

/** Constructs the one legal completed participant-input message row. */
function _messageData(messageId: string, conversationId: string, userId: string, request: SubmitConversationMessageRequest, runId: string | null): Prisma.ConversationMessageUncheckedCreateInput
{
	return { id: messageId, conversationId, runId, userId, idempotencyKey: request.idempotencyKey, role: ConversationMessageRole.User, state: ConversationMessageState.Completed, source: MessageSources.UserInput, blocks: request.blocks as unknown as Prisma.InputJsonValue, completedAt: new Date() };
}

/** Maps dependency-light mode vocabulary to Prisma's generated enum. */
function _prismaMode(mode: CreateConversationRequest["mode"]): ConversationMode
{
	return _PERSISTED_MODE_BY_MODE[mode];
}

/** Maps the pure strategy's denial into the stable participant API vocabulary. */
function _writeDenialForDecision(reason: ConversationCommandDenialReasons): ConversationWriteDenial
{
	return reason === ConversationCommandDenialReasons.ConversationClosed ? ConversationWriteDenialReasons.ConversationClosed : ConversationWriteDenialReasons.CommandNotSupported;
}

/** Forces the serializable transaction to roll back when an authorised write cannot be projected. */
function _requireWrittenConversation(conversation: ConversationDetail | null): ConversationDetail
{
	if (conversation === null) throw new Error("Written conversation projection unavailable");
	return conversation;
}
