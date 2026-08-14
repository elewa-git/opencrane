import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { PersonalRunAdmissionDenialReasons, PersonalRunAdmissionOutcomes, type PersonalRunAdmissionPort } from "@opencrane/backend/agents/execution/admission";
import { RunAdmissionConcurrencyDenialReasons, RunAdmissionDenialReasons, type RunAdmissionBuild, type RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import type { AgentThreadOrigin } from "@opencrane/backend/conversations/agent-threads";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { __DecideConversationCommand, ConversationCommandActions, ConversationCommandDenialReasons, ConversationCommandKinds, type MessageContentBlock } from "@opencrane/models/conversations";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { ConversationAuthorityOutcomes, ConversationWriteDenialReasons, type ConversationWriteDenial, type SubmitConversationMessageResult } from "../types/conversation-authority-result.types";
import type { ConversationCaller } from "../types/conversation-caller.types";
import type { SubmitConversationMessageRequest } from "../types/conversation-request.types";
import type { ConversationMessageView } from "../types/conversation-view.types";
import type { ConversationAttachmentAdmissionFactory, ConversationAttachmentAdmissionPort, ConversationMessageAdmissionUnitOfWork, ConversationMessageIdempotencyConflict, ConversationMessageSubmissionPreflight } from "../conversation-message-admission.types";
import { PrismaConversationMutationRepository } from "./prisma-conversation-mutation-repository";
import type { ConversationMutationRepository, ConversationMutationRepositoryFactory } from "./prisma-conversation-mutation-repository.types";
import { PrismaConversationQueryRepository } from "./prisma-conversation-query-repository";
import type { ConversationQueryRepository } from "./prisma-conversation-query-repository.types";

/** Prisma-backed participant-message admission, retry, and run handoff authority. */
export class PrismaConversationMessageAdmissionUnitOfWork implements ConversationMessageAdmissionUnitOfWork
{
	private readonly prisma: PrismaClient;
	private readonly runAdmission: PersonalRunAdmissionPort;
	private readonly createAttachmentAdmission: ConversationAttachmentAdmissionFactory;
	private readonly createMutationRepository: ConversationMutationRepositoryFactory;

	/** Creates message admission over the conversation database and internal run-admission port. */
	constructor(prisma: PrismaClient, runAdmission: PersonalRunAdmissionPort, createMutationRepository: ConversationMutationRepositoryFactory, createAttachmentAdmission: ConversationAttachmentAdmissionFactory)
	{
		this.prisma = prisma;
		this.runAdmission = runAdmission;
		this.createAttachmentAdmission = createAttachmentAdmission;
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
			if (request.agentTarget !== undefined) return decision.action === ConversationCommandActions.AdmitOrdinaryMessage
				? this._admitAgentThreadMessage(caller, conversationId, request)
				: _denied(ConversationWriteDenialReasons.CommandNotSupported);

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
			const admitted = await this._mutate(function _Admit(repository, attachments) { return repository.admitOrdinaryMessage(caller, conversationId, messageId, request, attachments); });
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
		const createAttachmentAdmission = this.createAttachmentAdmission;
		const createMutationRepository = this.createMutationRepository;
		const result = await this.runAdmission.admitPersonalRun({ siloId: caller.siloId, executionSubjectId: caller.subjectId, conversationId, requestIdempotencyKey: request.idempotencyKey, inputMessageId: messageId, inputMessageBlocks: request.blocks }, async function _PersistMessage(transaction: RunAdmissionTransaction, value: RunAdmissionBuild)
		{
			await createMutationRepository(transaction).persistAgentMessage(caller, conversationId, messageId, value.snapshot.runId, request, createAttachmentAdmission(transaction));
		});
		if (result.outcome === PersonalRunAdmissionOutcomes.Denied) return _denied(_runAdmissionDenial(result.reason));
		const message = await this._findOwnMessage(caller, conversationId, request.idempotencyKey);
		if (message === null) return _denied(ConversationWriteDenialReasons.PersistenceUnavailable);
		return result.outcome === PersonalRunAdmissionOutcomes.Idempotent ? _duplicateResult(message, request) : _accepted(message);
	}

	/** Atomically creates the parent root message, child session, first run, and immutable origin. */
	private async _admitAgentThreadMessage(caller: ConversationCaller, parentConversationId: string, request: SubmitConversationMessageRequest): Promise<SubmitConversationMessageResult>
	{
		if (request.agentTarget === undefined) return _denied(ConversationWriteDenialReasons.CommandNotSupported);
		const parentMessageId = randomUUID();
		const childConversationId = randomUUID();
		const childMessageId = randomUUID();
		const childRequest = _childRequest(request);
		const createRepository = this.createMutationRepository;
		const createAttachments = this.createAttachmentAdmission;
		let prepared: { readonly personaProfileId: string; readonly personaRevisionId: string } | null = null;
		const result = await this.runAdmission.admitFirstAgentThreadRun(
			{ siloId: caller.siloId, executionSubjectId: caller.subjectId, conversationId: childConversationId, requestIdempotencyKey: request.idempotencyKey, inputMessageId: childMessageId, inputMessageBlocks: childRequest.blocks },
			request.agentTarget.agentServiceId,
			async function _Prepare(transaction): Promise<void>
			{
				prepared = await createRepository(transaction).prepareAgentThread(caller, parentConversationId, parentMessageId, childConversationId, request, createAttachments(transaction));
			},
			async function _Commit(transaction: RunAdmissionTransaction, value: RunAdmissionBuild): Promise<void>
			{
				if (prepared === null || value.snapshot.personaRevisionId !== prepared.personaRevisionId) throw new Error("Agent-thread persona authority changed");
				const origin: AgentThreadOrigin = { childConversationId, parentConversationId, rootConversationId: parentConversationId, parentMessageId, initiatorUserId: caller.subjectId, agentServiceId: request.agentTarget!.agentServiceId, personaRevisionId: prepared.personaRevisionId, firstRunId: value.snapshot.runId };
				await createRepository(transaction).persistAgentThread(caller, origin, prepared.personaProfileId, childMessageId, request, childRequest, createAttachments(transaction));
			},
		);
		if (result.outcome === PersonalRunAdmissionOutcomes.Denied) return _denied(_runAdmissionDenial(result.reason));
		const message = await this._findOwnMessage(caller, parentConversationId, request.idempotencyKey);
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
	private async _mutate<T>(operation: (repository: ConversationMutationRepository, attachments: ConversationAttachmentAdmissionPort) => Promise<T>): Promise<T>
	{
		const createAttachmentAdmission = this.createAttachmentAdmission;
		return this.prisma.$transaction(async function _Mutate(transaction)
		{
			return operation(new PrismaConversationMutationRepository(transaction), createAttachmentAdmission({ prisma: transaction }));
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}

/** Maps an internal run-admission refusal onto one of the reasons the participant API returns. */
function _runAdmissionDenial(reason: string): ConversationWriteDenial
{
	if (reason === PersonalRunAdmissionDenialReasons.ConversationUnavailable) return ConversationWriteDenialReasons.ConversationUnavailable;
	if (reason === PersonalRunAdmissionDenialReasons.AuthorityConflict) return ConversationWriteDenialReasons.IdempotencyConflict;
	if (reason === RunAdmissionConcurrencyDenialReasons.AdmissionConcurrencyLimited) return ConversationWriteDenialReasons.CapacityLimited;
	if (reason === RunAdmissionDenialReasons.ActiveRun) return ConversationWriteDenialReasons.ActiveRun;
	if (reason === "run_not_admittable" || reason === "revision_unavailable" || reason === "persona_unavailable") return ConversationWriteDenialReasons.AgentServiceUnavailable;
	return ConversationWriteDenialReasons.PersistenceUnavailable;
}

/** Maps a rejected message command onto one of the reasons the participant API returns. */
function _writeDenial(reason: ConversationCommandDenialReasons): ConversationWriteDenial
{
	return reason === ConversationCommandDenialReasons.ConversationClosed ? ConversationWriteDenialReasons.ConversationClosed : ConversationWriteDenialReasons.CommandNotSupported;
}

/** Verifies a retry body against its durable canonical message. */
function _duplicateResult(message: ConversationMessageView, request: SubmitConversationMessageRequest): SubmitConversationMessageResult
{
	const targetMatches = message.agentThread?.agentServiceId === (request.agentTarget?.agentServiceId ?? undefined)
		|| (message.agentThread === null && request.agentTarget === undefined);
	return _blocksDigest(message.blocks) === _blocksDigest(request.blocks) && targetMatches ? { outcome: ConversationAuthorityOutcomes.Idempotent, message, agentThread: message.agentThread } : _denied(ConversationWriteDenialReasons.IdempotencyConflict);
}

/** Returns a successful canonical participant-message result. */
function _accepted(message: ConversationMessageView): SubmitConversationMessageResult
{
	return { outcome: ConversationAuthorityOutcomes.Accepted, message, agentThread: message.agentThread };
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

/** Gives every child-side asset reference its own conversation-local authority row. */
function _childRequest(request: SubmitConversationMessageRequest): SubmitConversationMessageRequest
{
	return { ...request, blocks: request.blocks.map(function _Block(block): MessageContentBlock { return block.kind === "artifact" ? { ...block, value: randomUUID() } : block; }) };
}
