import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { ___DoWithTrace } from "@opencrane/backend/observability";
import type { RunRetryAuthority } from "@opencrane/backend/agents/execution/runs";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import type { AgentThreadSnapshotView } from "../types/agent-thread-view.types";
import type { CreateConversationResult, MarkAgentThreadReadResult, MutateConversationResult, RetryConversationRunResult, SubmitConversationMessageResult } from "../types/conversation-authority-result.types";
import type { ConversationCaller } from "../types/conversation-caller.types";
import type { ConversationCreationDirectory } from "../types/conversation-directory.types";
import type { CreateConversationRequest, RetryConversationRunRequest, SubmitConversationMessageRequest } from "../types/conversation-request.types";
import type { ConversationUnitOfWork } from "../types/conversation-unit-of-work.types";
import type { ConversationDetail, ConversationSummary } from "../types/conversation-view.types";
import type { ConversationMessageAdmissionUnitOfWork } from "../conversation-message-admission.types";
import { PrismaConversationMutationRepository } from "./prisma-conversation-mutation-repository";
import type { ConversationMutationRepository } from "./prisma-conversation-mutation-repository.types";
import { PrismaConversationQueryRepository } from "./prisma-conversation-query-repository";
import type { ConversationQueryRepository } from "./prisma-conversation-query-repository.types";

/**
 * Owns the transactions for everything a signed-in user does with their own conversations.
 *
 * It is one of the few declared UnitOfWork adapters allowed to open transactions at all — through
 * the shared unit-of-work envelope — which is why the repositories it builds take a transaction
 * client and never a `PrismaClient`; the Prisma boundary checker enforces that split from
 * docs/agents/prisma-boundary-policy.json. Two isolation levels are used on purpose. Reads run
 * through `_read` at repeatable read, so a method that makes
 * several queries — membership, then participant rows, then messages — cannot see the picture change
 * halfway. Writes run through `_mutate` at serializable, so a check made inside the transaction still
 * holds when the write commits; closing a conversation while a run is starting is the case that needs
 * it.
 *
 * Two methods do not follow that pattern. `submitMessage` hands over to the message-admission
 * authority, which has to open an agent run and write the message in one transaction of its own, and
 * {@link PrismaConversationUnitOfWork.retryRun} hands over to the runs package. Both are noted where
 * they are defined.
 *
 * Every method takes the session-derived caller and re-checks membership below it, so this class
 * holds no per-user state and one instance serves every request.
 *
 * Called by: `_CreateSelfConversationsRouter` in prisma-self-conversations.router.ts, which passes it
 * to the router as `dependencies.authority`.
 *
 * @see ConversationUnitOfWork for the port this implements.
 */
export class PrismaConversationUnitOfWork implements ConversationUnitOfWork
{
	private readonly prisma: PrismaClient;
	private readonly messageAdmission: ConversationMessageAdmissionUnitOfWork;
	/** Run-owned authority that validates and persists participant retry requests. */
	private readonly runRetry: RunRetryAuthority;

	/** Creates the aggregate authority with its message-admission and run-retry collaborators. */
	constructor(prisma: PrismaClient, messageAdmission: ConversationMessageAdmissionUnitOfWork, runRetry: RunRetryAuthority)
	{
		this.prisma = prisma;
		this.messageAdmission = messageAdmission;
		this.runRetry = runRetry;
	}

	/**
	 * Lists the members and personal Agent this caller may start a conversation with.
	 *
	 * @param caller - Session-derived silo and subject.
	 * @returns Opaque participant references and a personal-Agent status; no login subject or email
	 *   ever appears in it.
	 * @throws Error when the caller's organisation membership is not active, which the route reports
	 *   as 503.
	 * @see PrismaConversationQueryRepository.directory for the checks behind each status.
	 */
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

	/**
	 * Asks the runs package to start a fresh attempt of a run that already finished badly.
	 *
	 * Retrying raises the attempt counter on the same run row instead of creating a second run, and
	 * that increment is a compare-and-swap on the attempt the caller says they saw, so two people
	 * retrying the same failed attempt cannot both start one. The injected run authority owns that
	 * decision and its own atomic write, which is why this method neither opens a transaction nor uses
	 * `_read`/`_mutate` — the run authority is not this package's aggregate to write. The caller's silo
	 * and conversation are passed in so the run authority can refuse a run belonging to anyone else.
	 *
	 * `acceptedAt` is stamped here, at the moment the request is accepted, rather than taken from the
	 * client.
	 *
	 * @param caller - Session-derived participant facts. Its input compiler, not this caller,
	 *   supplies the execution subject and current authority evidence inside the retry transaction.
	 * @param conversationId - Conversation the run must belong to; a mismatch denies with
	 *   `unauthorized`.
	 * @param runId - The run to retry, not a new identifier.
	 * @param request - The attempt the caller observed.
	 * @returns `started` for a new attempt, `idempotent` when an earlier request already started it,
	 *   or `denied` with a reason; `_runRetryDenialStatus` in self-conversations.router.ts turns each
	 *   reason into a status.
	 * @see RunRetryAuthority in `@opencrane/backend/agents/execution/runs`.
	 */
	async retryRun(caller: ConversationCaller, conversationId: string, runId: string, request: RetryConversationRunRequest): Promise<RetryConversationRunResult>
	{
		const acceptedAt = new Date().toISOString();
		return ___DoWithTrace("conversation.run.retry", { siloId: caller.siloId, conversationId, runId, expectedAttempt: request.expectedAttempt }, async () =>
		{
			return this.runRetry.retry({ runId, expectedAttempt: request.expectedAttempt, siloId: caller.siloId, conversationId, requestedBy: caller.subjectId, requestedByPrincipalId: caller.principalId, acceptedAt });
		});
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

	/**
	 * Hands a new participant message to the authority that owns message admission.
	 *
	 * No transaction and no trace are opened here: posting a message may have to start an agent run in
	 * the same transaction as the message, so `PrismaConversationMessageAdmissionUnitOfWork` owns both
	 * the transaction and its own tracing.
	 *
	 * @returns `Accepted` for a new message, `Idempotent` when the same key was already used by this
	 *   caller, or `Denied`.
	 */
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
		return ___RunInPrismaUnitOfWork(this.prisma, async function _Read(transaction): Promise<T>
		{
			return operation(new PrismaConversationQueryRepository(transaction));
		}, { isolationLevel: "RepeatableRead", operation: "conversation read" });
	}

	/** Runs one write operation against an exact serializable mutation repository. */
	private async _mutate<T>(operation: (repository: ConversationMutationRepository) => Promise<T>): Promise<T>
	{
		return ___RunInPrismaUnitOfWork(this.prisma, async function _Mutate(transaction): Promise<T>
		{
			return operation(new PrismaConversationMutationRepository(transaction));
		}, { isolationLevel: "Serializable", operation: "conversation mutation" });
	}
}
