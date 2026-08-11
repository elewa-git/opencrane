import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { PersonalRunAdmissionDenialReasons, PersonalRunAdmissionOutcomes, type PersonalRunAdmissionPort } from "@opencrane/backend/agents/execution/admission";
import { RunAdmissionConcurrencyDenialReasons, RunAdmissionDenialReasons, type RunAdmissionBuild, type RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { __DecideConversationCommand, ConversationCommandActions, ConversationCommandDenialReasons, ConversationCommandKinds, type MessageContentBlock } from "@opencrane/models/conversations";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { ConversationAuthorityOutcomes, ConversationWriteDenialReasons } from "./conversation-authority.types.js";
import type { ConversationCaller, ConversationMessageView, ConversationWriteDenial, SubmitConversationMessageRequest, SubmitConversationMessageResult } from "./conversation-authority.types.js";
import type { ConversationMessageAdmissionUnitOfWork, ConversationMessageIdempotencyConflict, ConversationMessageSubmissionPreflight } from "./conversation-message-admission.types.js";
import { PrismaConversationMutationRepository } from "./prisma-conversation-mutation-repository.js";
import type { ConversationMutationRepository, ConversationMutationRepositoryFactory } from "./prisma-conversation-mutation-repository.types.js";
import { PrismaConversationQueryRepository } from "./prisma-conversation-query-repository.js";
import type { ConversationQueryRepository } from "./prisma-conversation-query-repository.types.js";

/** Prisma-backed participant-message admission, retry, and run handoff authority. */
export class PrismaConversationMessageAdmissionUnitOfWork implements ConversationMessageAdmissionUnitOfWork
{
	private readonly prisma: PrismaClient;
	private readonly runAdmission: PersonalRunAdmissionPort;
	private readonly createMutationRepository: ConversationMutationRepositoryFactory;

	/** Creates message admission over the conversation database and internal run-admission port. */
	constructor(prisma: PrismaClient, runAdmission: PersonalRunAdmissionPort, createMutationRepository: ConversationMutationRepositoryFactory)
	{
		this.prisma = prisma;
		this.runAdmission = runAdmission;
		this.createMutationRepository = createMutationRepository;
	}

	/** Routes participant input through the persisted immutable-mode strategy. */
	async submit(caller: ConversationCaller, conversationId: string, request: SubmitConversationMessageRequest): Promise<SubmitConversationMessageResult>
	{
		return ___DoWithTrace("conversation.message.submit", { siloId: caller.siloId, conversationId }, async () =>
		{
			const preflight = await this._readSubmissionPreflight(caller, conversationId, request.idempotencyKey);
			if (preflight.duplicate !== null) return _duplicateResult(preflight.duplicate, request);
			if (preflight.context === null) return _denied(ConversationWriteDenialReasons.ConversationUnavailable);

			const decision = __DecideConversationCommand({ ...preflight.context, command: { kind: ConversationCommandKinds.SubmitMessage } });
			if (!decision.allowed) return _denied(_writeDenial(decision.reason));

			switch (decision.action)
			{
				case ConversationCommandActions.AdmitOrdinaryMessage:
					return this._admitOrdinaryMessage(caller, conversationId, request);
				case ConversationCommandActions.AdmitAgentRun:
					return this._admitAgentMessage(caller, conversationId, request);
				default:
					return _denied(ConversationWriteDenialReasons.CommandNotSupported);
			}
		});
	}

	/** Reads duplicate and mode-strategy facts from one participant-scoped snapshot. */
	private async _readSubmissionPreflight(caller: ConversationCaller, conversationId: string, idempotencyKey: string): Promise<ConversationMessageSubmissionPreflight>
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
			return this._readAdmittedMessage(caller, conversationId, request);
		}
		catch (error)
		{
			return this._resolveIdempotencyConflict(error, caller, conversationId, request);
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
		if (result.outcome === PersonalRunAdmissionOutcomes.Denied) return _denied(_runAdmissionDenial(result.reason));
		const message = await this._findOwnMessage(caller, conversationId, request.idempotencyKey);
		if (message === null) return _denied(ConversationWriteDenialReasons.PersistenceUnavailable);
		return result.outcome === PersonalRunAdmissionOutcomes.Idempotent ? _duplicateResult(message, request) : _accepted(message);
	}

	/** Reads a newly admitted ordinary message from the canonical participant projection. */
	private async _readAdmittedMessage(caller: ConversationCaller, conversationId: string, request: SubmitConversationMessageRequest): Promise<SubmitConversationMessageResult>
	{
		const message = await this._findOwnMessage(caller, conversationId, request.idempotencyKey);
		return message === null ? _denied(ConversationWriteDenialReasons.PersistenceUnavailable) : _accepted(message);
	}

	/** Converts an insert collision into a safe retry result or rethrows unrelated persistence failures. */
	private async _resolveIdempotencyConflict(error: unknown, caller: ConversationCaller, conversationId: string, request: SubmitConversationMessageRequest): Promise<SubmitConversationMessageResult>
	{
		const conflict = await this._readIdempotencyConflict(caller, conversationId, request.idempotencyKey);
		if (conflict.duplicate !== null) return _duplicateResult(conflict.duplicate, request);
		if (conflict.exists) return _denied(ConversationWriteDenialReasons.IdempotencyConflict);
		throw error;
	}

	/** Reads one exact caller-owned message through a short transaction. */
	private async _findOwnMessage(caller: ConversationCaller, conversationId: string, idempotencyKey: string): Promise<ConversationMessageView | null>
	{
		return this._read(function _FindMessage(query) { return query.findOwnMessage(caller, conversationId, idempotencyKey); });
	}

	/** Resolves a unique-key failure without returning another participant's message. */
	private async _readIdempotencyConflict(caller: ConversationCaller, conversationId: string, idempotencyKey: string): Promise<ConversationMessageIdempotencyConflict>
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

	/** Runs one ordinary-message write against an exact serializable mutation repository. */
	private async _mutate<T>(operation: (repository: ConversationMutationRepository) => Promise<T>): Promise<T>
	{
		return this.prisma.$transaction(async function _Mutate(transaction)
		{
			return operation(new PrismaConversationMutationRepository(transaction));
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}

/** Maps an internal run-admission refusal into the participant API vocabulary. */
function _runAdmissionDenial(reason: string): ConversationWriteDenial
{
	if (reason === PersonalRunAdmissionDenialReasons.ConversationUnavailable) return ConversationWriteDenialReasons.ConversationUnavailable;
	if (reason === PersonalRunAdmissionDenialReasons.AuthorityConflict) return ConversationWriteDenialReasons.IdempotencyConflict;
	if (reason === RunAdmissionConcurrencyDenialReasons.AdmissionConcurrencyLimited) return ConversationWriteDenialReasons.CapacityLimited;
	if (reason === RunAdmissionDenialReasons.ActiveRun) return ConversationWriteDenialReasons.ActiveRun;
	if (reason === "run_not_admittable" || reason === "revision_unavailable" || reason === "persona_unavailable") return ConversationWriteDenialReasons.AgentServiceUnavailable;
	return ConversationWriteDenialReasons.PersistenceUnavailable;
}

/** Maps a rejected message command into the stable participant API vocabulary. */
function _writeDenial(reason: ConversationCommandDenialReasons): ConversationWriteDenial
{
	return reason === ConversationCommandDenialReasons.ConversationClosed ? ConversationWriteDenialReasons.ConversationClosed : ConversationWriteDenialReasons.CommandNotSupported;
}

/** Verifies a retry body against its durable canonical message. */
function _duplicateResult(message: ConversationMessageView, request: SubmitConversationMessageRequest): SubmitConversationMessageResult
{
	return _blocksDigest(message.blocks) === _blocksDigest(request.blocks) ? { outcome: ConversationAuthorityOutcomes.Idempotent, message } : _denied(ConversationWriteDenialReasons.IdempotencyConflict);
}

/** Returns a successful canonical participant-message result. */
function _accepted(message: ConversationMessageView): SubmitConversationMessageResult
{
	return { outcome: ConversationAuthorityOutcomes.Accepted, message };
}

/** Returns one stable fail-closed participant-message result. */
function _denied(reason: ConversationWriteDenial): SubmitConversationMessageResult
{
	return { outcome: ConversationAuthorityOutcomes.Denied, reason };
}

/** Canonical block digest used only to reject changed-body idempotency reuse. */
function _blocksDigest(blocks: readonly MessageContentBlock[]): string
{
	return ___DigestCanonicalJson(blocks as unknown as JsonValue);
}
