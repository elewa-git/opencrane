import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { ___DoWithTrace } from "@opencrane/backend/observability";
import { __StartNextRunAttempt, PrismaAgentRunAuthorityRepository } from "@opencrane/backend/agents/execution/runs";

import type { AgentThreadSnapshotView, ConversationCaller, ConversationCreationDirectory, ConversationDetail, ConversationSummary, ConversationUnitOfWork, CreateConversationRequest, CreateConversationResult, MarkAgentThreadReadResult, MutateConversationResult, RetryConversationRunRequest, RetryConversationRunResult, SubmitConversationMessageRequest, SubmitConversationMessageResult } from "./conversation-authority.types.js";
import type { ConversationMessageAdmissionUnitOfWork } from "./conversation-message-admission.types.js";
import { PrismaConversationMutationRepository } from "./prisma-conversation-mutation-repository.js";
import type { ConversationMutationRepository } from "./prisma-conversation-mutation-repository.types.js";
import { PrismaConversationQueryRepository } from "./prisma-conversation-query-repository.js";
import type { ConversationQueryRepository } from "./prisma-conversation-query-repository.types.js";

/** Prisma-backed durable authority for conversation reads and aggregate lifecycle writes. */
export class PrismaConversationUnitOfWork implements ConversationUnitOfWork
{
	private readonly prisma: PrismaClient;
	private readonly messageAdmission: ConversationMessageAdmissionUnitOfWork;

	/** Creates the aggregate authority and its dedicated participant-message collaborator. */
	constructor(prisma: PrismaClient, messageAdmission: ConversationMessageAdmissionUnitOfWork)
	{
		this.prisma = prisma;
		this.messageAdmission = messageAdmission;
	}

	/** Returns self-scoped creation choices without exposing login identifiers. */
	async directory(caller: ConversationCaller): Promise<ConversationCreationDirectory>
	{
		return ___DoWithTrace("conversation.directory", { siloId: caller.siloId }, async () => this._read(function _Directory(query) { return query.directory(caller); }));
	}

	/** Lists current participant conversations without treating participant-local archive as lifecycle. */
	async list(caller: ConversationCaller, includeArchived: boolean): Promise<readonly ConversationSummary[]>
	{
		return ___DoWithTrace("conversation.list", { siloId: caller.siloId, includeArchived }, async () => this._read(function _List(query) { return query.list(caller, includeArchived); }));
	}

	/** Opens one conversation only through the caller's persisted participant coordinate. */
	async open(caller: ConversationCaller, conversationId: string): Promise<ConversationDetail | null>
	{
		return ___DoWithTrace("conversation.open", { siloId: caller.siloId, conversationId }, async () => this._read(function _Open(query) { return query.open(caller, conversationId); }));
	}

	/** Opens one child Agent-thread read model only through the exact parent-child route pair. */
	async openAgentThread(caller: ConversationCaller, parentConversationId: string, childConversationId: string): Promise<AgentThreadSnapshotView | null>
	{
		return ___DoWithTrace("conversation.agent_thread.open", { siloId: caller.siloId, parentConversationId, childConversationId }, async () => this._read(function _Open(query) { return query.openAgentThread(caller, parentConversationId, childConversationId); }));
	}

	/** Monotonically advances one participant's read coordinate inside a serializable authority snapshot. */
	async markAgentThreadRead(caller: ConversationCaller, parentConversationId: string, childConversationId: string, observedPosition: string): Promise<MarkAgentThreadReadResult>
	{
		return ___DoWithTrace("conversation.agent_thread.mark_read", { siloId: caller.siloId, parentConversationId, childConversationId }, async () => this._mutate(function _MarkRead(repository) { return repository.markAgentThreadRead(caller, parentConversationId, childConversationId, BigInt(observedPosition)); }));
	}

	/** Starts one new attempt only through the run package's participant-bound authority. */
	async retryRun(caller: ConversationCaller, conversationId: string, runId: string, request: RetryConversationRunRequest): Promise<RetryConversationRunResult>
	{
		return ___DoWithTrace("conversation.run.retry", { siloId: caller.siloId, conversationId, runId, expectedAttempt: request.expectedAttempt }, async () => __StartNextRunAttempt(new PrismaAgentRunAuthorityRepository(this.prisma), { runId, expectedAttempt: request.expectedAttempt, siloId: caller.siloId, conversationId, requestedBy: caller.subjectId, idempotencyKey: request.idempotencyKey, acceptedAt: new Date().toISOString() }));
	}

	/** Writes the conversation and participant rows atomically; the selected mode can never change. */
	async create(caller: ConversationCaller, request: CreateConversationRequest): Promise<CreateConversationResult>
	{
		return ___DoWithTrace("conversation.create", { siloId: caller.siloId, mode: request.mode }, async () =>
		{
			const conversationId = randomUUID();
			return this._mutate(function _Create(repository) { return repository.create(caller, conversationId, request); });
		});
	}

	/** Delegates participant input to the authority that owns message admission and retries. */
	async submitMessage(caller: ConversationCaller, conversationId: string, request: SubmitConversationMessageRequest): Promise<SubmitConversationMessageResult>
	{
		return this.messageAdmission.submit(caller, conversationId, request);
	}

	/** Applies participant-local archive visibility without changing conversation lifecycle. */
	async setArchived(caller: ConversationCaller, conversationId: string, archived: boolean): Promise<MutateConversationResult>
	{
		return ___DoWithTrace("conversation.archive", { siloId: caller.siloId, conversationId, archived }, async () => this._mutate(function _Archive(repository) { return repository.setArchived(caller, conversationId, archived); }));
	}

	/** Closes the conversation for everyone, permanently. The run check happens inside the transaction, so a run starting concurrently still blocks the close rather than being orphaned. */
	async close(caller: ConversationCaller, conversationId: string): Promise<MutateConversationResult>
	{
		return ___DoWithTrace("conversation.close", { siloId: caller.siloId, conversationId }, async () => this._mutate(function _Close(repository) { return repository.close(caller, conversationId); }));
	}

	/** Runs one read operation against an exact transaction-scoped query repository. */
	private async _read<T>(operation: (repository: ConversationQueryRepository) => Promise<T>): Promise<T>
	{
		return this.prisma.$transaction(async function _Read(transaction)
		{
			return operation(new PrismaConversationQueryRepository(transaction));
		}, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
	}

	/** Runs one write operation against an exact serializable mutation repository. */
	private async _mutate<T>(operation: (repository: ConversationMutationRepository) => Promise<T>): Promise<T>
	{
		return this.prisma.$transaction(async function _Mutate(transaction)
		{
			return operation(new PrismaConversationMutationRepository(transaction));
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}
