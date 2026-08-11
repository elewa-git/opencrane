import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { PersonalRunAdmissionDenialReasons, PersonalRunAdmissionOutcomes, type PersonalRunAdmissionPort } from "@opencrane/backend/agents/execution/admission";
import { RunAdmissionConcurrencyDenialReasons, RunAdmissionDenialReasons, type RunAdmissionBuild, type RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { __DecideConversationCommand, ConversationCommandActions, ConversationCommandDenialReasons, ConversationCommandKinds, type MessageContentBlock } from "@opencrane/models/conversations";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { ConversationAuthorityOutcomes, ConversationWriteDenialReasons } from "./conversation-authority.types.js";
import type { ConversationCaller, ConversationDetail, ConversationMessageView, ConversationSummary, ConversationUnitOfWork, ConversationWriteDenial, CreateConversationRequest, CreateConversationResult, MutateConversationResult, SubmitConversationMessageRequest, SubmitConversationMessageResult } from "./conversation-authority.types.js";
import { PrismaConversationMutationRepository } from "./prisma-conversation-mutation-repository.js";
import type { ConversationMutationRepository, ConversationMutationRepositoryFactory } from "./prisma-conversation-mutation-repository.types.js";
import { PrismaConversationQueryRepository } from "./prisma-conversation-query-repository.js";
import type { ConversationCommandContext, ConversationQueryRepository } from "./prisma-conversation-query-repository.types.js";

/** Prisma-backed durable authority for immutable-mode conversations and participant messages. */
export class PrismaConversationUnitOfWork implements ConversationUnitOfWork
{
	private readonly prisma: PrismaClient;
	private readonly runAdmission: PersonalRunAdmissionPort;
	private readonly createMutationRepository: ConversationMutationRepositoryFactory;

	/** Creates the authority over the canonical product database and internal run-admission port. */
	constructor(prisma: PrismaClient, runAdmission: PersonalRunAdmissionPort, createMutationRepository: ConversationMutationRepositoryFactory)
	{
		this.prisma = prisma;
		this.runAdmission = runAdmission;
		this.createMutationRepository = createMutationRepository;
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

	/** Creates one immutable-mode aggregate and its initial participant membership events atomically. */
	async create(caller: ConversationCaller, request: CreateConversationRequest): Promise<CreateConversationResult>
	{
		return ___DoWithTrace("conversation.create", { siloId: caller.siloId, mode: request.mode }, async () =>
		{
			const conversationId = randomUUID();
			return this._mutate(function _Create(repository) { return repository.create(caller, conversationId, request); });
		});
	}

	/** Routes participant input through the persisted immutable-mode strategy. */
	async submitMessage(caller: ConversationCaller, conversationId: string, request: SubmitConversationMessageRequest): Promise<SubmitConversationMessageResult>
	{
		return ___DoWithTrace("conversation.message.submit", { siloId: caller.siloId, conversationId }, async () =>
		{
			const preflight = await this._readSubmissionPreflight(caller, conversationId, request.idempotencyKey);
			if (preflight.duplicate !== null) return _duplicateResult(preflight.duplicate, request);
			if (preflight.context === null) return { outcome: ConversationAuthorityOutcomes.Denied, reason: ConversationWriteDenialReasons.ConversationUnavailable };
			const decision = __DecideConversationCommand({ ...preflight.context, command: { kind: ConversationCommandKinds.SubmitMessage } });
			if (!decision.allowed) return { outcome: ConversationAuthorityOutcomes.Denied, reason: decision.reason === ConversationCommandDenialReasons.ConversationClosed ? ConversationWriteDenialReasons.ConversationClosed : ConversationWriteDenialReasons.CommandNotSupported };
			if (decision.action === ConversationCommandActions.AdmitOrdinaryMessage) return this._admitOrdinaryMessage(caller, conversationId, request);
			if (decision.action !== ConversationCommandActions.AdmitAgentRun) return { outcome: ConversationAuthorityOutcomes.Denied, reason: ConversationWriteDenialReasons.CommandNotSupported };
			if (preflight.context.activeRunId !== null) return { outcome: ConversationAuthorityOutcomes.Denied, reason: ConversationWriteDenialReasons.ActiveRun };
			return this._admitAgentMessage(caller, conversationId, request);
		});
	}

	/** Applies participant-local archive visibility without changing conversation lifecycle. */
	async setArchived(caller: ConversationCaller, conversationId: string, archived: boolean): Promise<MutateConversationResult>
	{
		return ___DoWithTrace("conversation.archive", { siloId: caller.siloId, conversationId, archived }, async () => this._mutate(function _Archive(repository) { return repository.setArchived(caller, conversationId, archived); }));
	}

	/** Permanently closes one caller-owned conversation after the database rechecks active-run state. */
	async close(caller: ConversationCaller, conversationId: string): Promise<MutateConversationResult>
	{
		return ___DoWithTrace("conversation.close", { siloId: caller.siloId, conversationId }, async () => this._mutate(function _Close(repository) { return repository.close(caller, conversationId); }));
	}

	/** Reads duplicate and mode-strategy facts from one participant-scoped snapshot. */
	private async _readSubmissionPreflight(caller: ConversationCaller, conversationId: string, idempotencyKey: string): Promise<{ readonly duplicate: ConversationMessageView | null; readonly context: ConversationCommandContext | null }>
	{
		return this._read(async function _ReadSubmission(query)
		{
			const duplicate = await query.findOwnMessage(caller, conversationId, idempotencyKey);
			return { duplicate, context: duplicate === null ? await query.loadCommandContext(caller, conversationId) : null };
		});
	}

	/** Persists one ordinary direct/group message without manufacturing a run. */
	private async _admitOrdinaryMessage(caller: ConversationCaller, conversationId: string, request: SubmitConversationMessageRequest): Promise<SubmitConversationMessageResult>
	{
		const messageId = randomUUID();
		try
		{
			const admitted = await this._mutate(function _Admit(repository) { return repository.admitOrdinaryMessage(caller, conversationId, messageId, request); });
			if (admitted.outcome === ConversationAuthorityOutcomes.Denied) return admitted;
			const message = await this._findOwnMessage(caller, conversationId, request.idempotencyKey);
			return message === null ? { outcome: ConversationAuthorityOutcomes.Denied, reason: ConversationWriteDenialReasons.PersistenceUnavailable } : { outcome: ConversationAuthorityOutcomes.Accepted, message };
		}
		catch (error)
		{
			const conflict = await this._readIdempotencyConflict(caller, conversationId, request.idempotencyKey);
			if (conflict.duplicate !== null) return _duplicateResult(conflict.duplicate, request);
			if (conflict.exists) return { outcome: ConversationAuthorityOutcomes.Denied, reason: ConversationWriteDenialReasons.IdempotencyConflict };
			throw error;
		}
	}

	/** Commits a user message inside the run repository's sole final transaction. */
	private async _admitAgentMessage(caller: ConversationCaller, conversationId: string, request: SubmitConversationMessageRequest): Promise<SubmitConversationMessageResult>
	{
		const messageId = randomUUID();
		const createRepository = this.createMutationRepository;
		const result = await this.runAdmission.admitPersonalRun({ siloId: caller.siloId, executionSubjectId: caller.subjectId, conversationId, requestIdempotencyKey: request.idempotencyKey, inputMessageId: messageId, inputMessageBlocks: request.blocks }, async function _PersistMessage(transaction: RunAdmissionTransaction, value: RunAdmissionBuild)
		{
			await createRepository(transaction).persistAgentMessage(caller, conversationId, messageId, value.snapshot.runId, request);
		});
		if (result.outcome === PersonalRunAdmissionOutcomes.Denied) return { outcome: ConversationAuthorityOutcomes.Denied, reason: _runAdmissionDenial(result.reason) };
		const message = await this._findOwnMessage(caller, conversationId, request.idempotencyKey);
		if (message === null) return { outcome: ConversationAuthorityOutcomes.Denied, reason: ConversationWriteDenialReasons.PersistenceUnavailable };
		return result.outcome === PersonalRunAdmissionOutcomes.Idempotent ? _duplicateResult(message, request) : { outcome: ConversationAuthorityOutcomes.Accepted, message };
	}

	/** Reads one exact caller-owned message through a short transaction. */
	private async _findOwnMessage(caller: ConversationCaller, conversationId: string, idempotencyKey: string): Promise<ConversationMessageView | null>
	{
		return this._read(function _FindMessage(query) { return query.findOwnMessage(caller, conversationId, idempotencyKey); });
	}

	/** Resolves a unique-key failure without returning another participant's message. */
	private async _readIdempotencyConflict(caller: ConversationCaller, conversationId: string, idempotencyKey: string): Promise<{ readonly duplicate: ConversationMessageView | null; readonly exists: boolean }>
	{
		return this._read(async function _ReadConflict(query)
		{
			const duplicate = await query.findOwnMessage(caller, conversationId, idempotencyKey);
			return { duplicate, exists: duplicate !== null || await query.hasMessageIdempotencyKey(caller, conversationId, idempotencyKey) };
		});
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

/** Maps an internal run-admission refusal without misreporting it as an active foreground run. */
function _runAdmissionDenial(reason: string): ConversationWriteDenial
{
	if (reason === PersonalRunAdmissionDenialReasons.ConversationUnavailable) return ConversationWriteDenialReasons.ConversationUnavailable;
	if (reason === PersonalRunAdmissionDenialReasons.AuthorityConflict) return ConversationWriteDenialReasons.IdempotencyConflict;
	if (reason === RunAdmissionConcurrencyDenialReasons.AdmissionConcurrencyLimited) return ConversationWriteDenialReasons.CapacityLimited;
	if (reason === RunAdmissionDenialReasons.ActiveRun) return ConversationWriteDenialReasons.ActiveRun;
	if (reason === "run_not_admittable" || reason === "revision_unavailable" || reason === "persona_unavailable") return ConversationWriteDenialReasons.AgentServiceUnavailable;
	return ConversationWriteDenialReasons.PersistenceUnavailable;
}

/** Verifies a retry body against its durable canonical message. */
function _duplicateResult(message: ConversationMessageView, request: SubmitConversationMessageRequest): SubmitConversationMessageResult
{
	return _blocksDigest(message.blocks) === _blocksDigest(request.blocks) ? { outcome: ConversationAuthorityOutcomes.Idempotent, message } : { outcome: ConversationAuthorityOutcomes.Denied, reason: ConversationWriteDenialReasons.IdempotencyConflict };
}

/** Canonical block digest used only to reject changed-body idempotency reuse. */
function _blocksDigest(blocks: readonly MessageContentBlock[]): string
{
	return ___DigestCanonicalJson(blocks as unknown as JsonValue);
}
