import type { Prisma, PrismaClient } from "@prisma/client";

import { AGENT_RUNTIME_CONTINUATION_MAX_BYTES, RuntimeCommandKinds, type RuntimeAttemptContinuation, type RuntimeCommandEnvelope, type RuntimeContinuationSaveRequest, type RuntimeStreamOpen } from "@opencrane/contracts";
import type { RuntimeContinuationCipher } from "@opencrane/backend/server/infra/agent-runtime-continuation";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import type { Logger } from "@opencrane/backend/observability";

import { PrismaRuntimeContinuationRepository } from "./prisma-runtime-continuation-repository";
import type { RuntimeDispatchAuthorityConfig, RuntimeStreamWorkloadIdentity } from "./prisma-runtime-dispatch-authority.types";
import { __ParseRuntimeContinuation } from "./runtime-continuation";
import { RuntimeContinuationSaveOutcomes, type RuntimeContinuationAuthority, type RuntimeContinuationCheckpointRow, type RuntimeContinuationSaveResult } from "./runtime-continuation.types";

/**
 * Saves encrypted continuations and restores them only for the current warm Pod and command stream.
 *
 * The runtime transport uses this class for save and resume requests. The AgentRun replacement
 * transaction also uses it to prove that a waiting attempt can move to a new Pod without replaying
 * an active model call.
 */
export class PrismaRuntimeContinuationAuthorityUnitOfWork implements RuntimeContinuationAuthority
{
	/** Main product database client. */
	private readonly prisma: PrismaClient;
	/** Configured runtime namespaces and command policy. */
	private readonly config: RuntimeDispatchAuthorityConfig;
	/** Server-only authenticated encryption adapter. */
	private readonly cipher: RuntimeContinuationCipher;
	/** Structured server logger for safe continuation failures. */
	private readonly logger: Logger;

	/** Create one continuation authority over Postgres and a server-held cipher. */
	constructor(prisma: PrismaClient, config: RuntimeDispatchAuthorityConfig, cipher: RuntimeContinuationCipher, logger: Logger)
	{
		this.prisma = prisma;
		this.config = config;
		this.cipher = cipher;
		this.logger = logger;
	}

	/** Checks runtime and pending-call authority, then encrypts and stores a newer revision. */
	async save(identity: RuntimeStreamWorkloadIdentity, request: RuntimeContinuationSaveRequest): Promise<RuntimeContinuationSaveResult>
	{
		const parsed = __ParseRuntimeContinuation(request.continuation);
		if (parsed === null || parsed.plaintext.length > AGENT_RUNTIME_CONTINUATION_MAX_BYTES)
			return { outcome: RuntimeContinuationSaveOutcomes.Denied, reason: "invalid_continuation" };
		if (request.continuation.runId !== request.runId || request.continuation.attempt !== request.attempt || request.continuation.inputGeneration !== request.inputGeneration)
			return { outcome: RuntimeContinuationSaveOutcomes.Denied, reason: "continuation_coordinates_mismatch" };
		if (request.continuation.pendingToolCalls.length === 0 && request.continuation.pendingElicitations.length === 0)
			return { outcome: RuntimeContinuationSaveOutcomes.Denied, reason: "continuation_has_no_pending_work" };
		const authority = this;
		return this._Run(async function _Save(repository): Promise<RuntimeContinuationSaveResult>
		{
			const current = await repository.loadSaveAuthority(authority.config, identity, request);
			if (current === null || current.runtimeInstanceId !== request.runtimeInstanceId || current.fence !== request.fence || current.inputGeneration !== request.inputGeneration || current.commandSequence !== request.continuation.appliedCommandSequence)
				return { outcome: RuntimeContinuationSaveOutcomes.Denied, reason: "stale_continuation_authority" };
			if (!await repository.pendingCorrelationsAreDurable(request.runId, request.attempt, request.continuation))
				return { outcome: RuntimeContinuationSaveOutcomes.Denied, reason: "pending_correlation_mismatch" };
			await repository.deleteOtherGenerations(request.runId, request.attempt, request.inputGeneration);
			const existing = await repository.load(request.runId, request.attempt, request.inputGeneration);
			if (existing !== null && existing.revision === request.continuation.revision && existing.digest === request.continuation.digest)
				return { outcome: RuntimeContinuationSaveOutcomes.Idempotent };
			if (existing !== null && (existing.appliedCommandSequence > request.continuation.appliedCommandSequence || existing.revision >= request.continuation.revision))
				return { outcome: RuntimeContinuationSaveOutcomes.Denied, reason: "continuation_revision_conflict" };
			const associatedData = _AssociatedData(request.continuation);
			const sealed = await authority.cipher.seal(parsed.plaintext, associatedData);
			const data = { runId: request.runId, attempt: request.attempt, inputGeneration: request.inputGeneration, formatVersion: request.continuation.version, revision: request.continuation.revision, digest: request.continuation.digest, appliedCommandSequence: request.continuation.appliedCommandSequence, sourceRuntimeInstanceId: request.runtimeInstanceId, sourceCommandId: request.commandId, sourceFence: request.fence, keyId: sealed.keyId, ciphertext: Buffer.from(sealed.ciphertext), nonce: Buffer.from(sealed.nonce), authenticationTag: Buffer.from(sealed.authenticationTag), plaintextBytes: parsed.plaintext.length };
			const persisted = existing === null ? await repository.create(data) : await repository.update(request.runId, request.attempt, request.inputGeneration, existing.revision, data);
			if (persisted.count !== 1)
				throw new Error("runtime continuation lost its monotonic revision fence");
			return { outcome: RuntimeContinuationSaveOutcomes.Accepted };
		});
	}

	/** Attaches the directly preceding continuation to a resume, or returns null until it is available. */
	async attachToResume(identity: RuntimeStreamWorkloadIdentity, open: RuntimeStreamOpen, command: RuntimeCommandEnvelope): Promise<RuntimeCommandEnvelope | null>
	{
		if (command.kind !== RuntimeCommandKinds.ResumeAttempt)
			return command;
		const authority = this;
		const loaded = await this._Run(async function _Load(repository)
		{
			const request = { protocolVersion: command.protocolVersion, runtimeInstanceId: open.runtimeInstanceId, commandId: command.commandId, runId: command.assignment.runId, attempt: command.assignment.attempt, fence: command.fence, inputGeneration: command.payload.inputGeneration, continuation: {} as RuntimeAttemptContinuation };
			const current = await repository.loadSaveAuthority(authority.config, identity, request);
			if (current === null || current.runtimeInstanceId !== open.runtimeInstanceId || current.fence !== command.fence || current.inputGeneration !== command.payload.inputGeneration || current.commandSequence !== command.sequence)
				return null;
			const checkpoint = await repository.load(command.assignment.runId, command.assignment.attempt, command.payload.inputGeneration);
			return checkpoint?.appliedCommandSequence === command.sequence - 1 ? checkpoint : null;
		});
		if (loaded === null)
			return null;
		const continuation = await this._Open(command.assignment.runId, command.assignment.attempt, command.payload.inputGeneration, loaded);
		if (continuation === null)
			return null;
		return { ...command, payload: { ...command.payload, continuation } };
	}

	/** Checks the latest waiting continuation and advances its stream fence in the caller's transaction. */
	async prepareReplacementInTransaction(transaction: unknown, runId: string, attempt: number): Promise<true | null>
	{
		const recoveryTransaction = transaction as Prisma.TransactionClient;
		const recovery = await PrismaRuntimeContinuationRepository.loadWaitingRecoveryInTransaction(recoveryTransaction, runId, attempt);
		if (recovery === null)
			return null;
		const continuation = await this._Open(runId, attempt, recovery.inputGeneration, recovery.checkpoint);
		if (continuation === null || !await PrismaRuntimeContinuationRepository.pendingCorrelationsAreDurableInTransaction(recoveryTransaction, runId, attempt, continuation))
			return null;
		if (recovery.fence === recovery.checkpoint.sourceFence + 1)
			return true;
		if (recovery.fence !== recovery.checkpoint.sourceFence)
			return null;
		const advanced = await PrismaRuntimeContinuationRepository.advanceFenceInTransaction(recoveryTransaction, runId, attempt, recovery.inputGeneration, recovery.fence);
		if (advanced.count !== 1)
			throw new Error("runtime continuation recovery lost its stream fence");
		return true;
	}

	/** Run one continuation operation with a single transaction-bound repository. */
	private _Run<TResult>(operation: (repository: PrismaRuntimeContinuationRepository) => Promise<TResult>): Promise<TResult>
	{
		return ___RunInPrismaUnitOfWork(this.prisma, async function _Run(transaction): Promise<TResult>
		{
			return operation(new PrismaRuntimeContinuationRepository(transaction));
		}, { isolationLevel: "Serializable", operation: "runtime continuation" });
	}

	/** Decrypt and revalidate one stored plaintext document. */
	private async _Open(runId: string, attempt: number, inputGeneration: number, checkpoint: RuntimeContinuationCheckpointRow): Promise<RuntimeAttemptContinuation | null>
	{
		if (checkpoint.plaintextBytes < 1 || checkpoint.plaintextBytes > AGENT_RUNTIME_CONTINUATION_MAX_BYTES)
		{
			this._WarnOpenFailure("plaintext_size_out_of_bounds", runId, attempt, inputGeneration, checkpoint);
			return null;
		}
		try
		{
			const plaintext = await this.cipher.open({ keyId: checkpoint.keyId, ciphertext: checkpoint.ciphertext, nonce: checkpoint.nonce, authenticationTag: checkpoint.authenticationTag }, { formatVersion: checkpoint.formatVersion, runId, attempt, inputGeneration, revision: checkpoint.revision });
			if (plaintext.length !== checkpoint.plaintextBytes)
			{
				this._WarnOpenFailure("plaintext_size_mismatch", runId, attempt, inputGeneration, checkpoint);
				return null;
			}
			const parsed = __ParseRuntimeContinuation(JSON.parse(Buffer.from(plaintext).toString("utf8")));
			if (parsed === null || parsed.continuation.digest !== checkpoint.digest || parsed.continuation.revision !== checkpoint.revision || parsed.continuation.runId !== runId || parsed.continuation.attempt !== attempt || parsed.continuation.inputGeneration !== inputGeneration || parsed.continuation.appliedCommandSequence !== checkpoint.appliedCommandSequence)
			{
				this._WarnOpenFailure("checkpoint_content_mismatch", runId, attempt, inputGeneration, checkpoint);
				return null;
			}
			return parsed.continuation;
		}
		catch (error)
		{
			this._WarnOpenFailure("decrypt_or_decode_failed", runId, attempt, inputGeneration, checkpoint, error);
			return null;
		}
	}

	/** Records why an encrypted checkpoint failed closed without exposing its contents. */
	private _WarnOpenFailure(reason: string, runId: string, attempt: number, inputGeneration: number, checkpoint: RuntimeContinuationCheckpointRow, error?: unknown): void
	{
		this.logger.warn({ err: { type: _OpenErrorType(error) }, operation: "runtime_continuation.open", reason, runId, attempt, inputGeneration, keyId: checkpoint.keyId }, "Runtime continuation could not be opened");
	}
}

/** Names a safe failure class without serializing the rejected checkpoint or cipher error. */
function _OpenErrorType(error: unknown): string
{
	if (error instanceof Error)
		return error.name;
	return error === undefined ? "CheckpointValidationError" : "UnknownError";
}

/** Bind AES-GCM associated data to exact immutable checkpoint coordinates. */
function _AssociatedData(continuation: RuntimeAttemptContinuation)
{
	return { formatVersion: continuation.version, runId: continuation.runId, attempt: continuation.attempt, inputGeneration: continuation.inputGeneration, revision: continuation.revision };
}
