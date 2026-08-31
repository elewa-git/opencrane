import type { RuntimeAttemptContinuation, RuntimeCommandEnvelope, RuntimeContinuationSaveRequest, RuntimeStreamOpen } from "@opencrane/contracts";

import type { RuntimeDispatchAuthorityConfig, RuntimeStreamWorkloadIdentity } from "./prisma-runtime-dispatch-authority.types";

/**
 * Tells the runtime whether it may report the attempt as waiting after a continuation save.
 *
 * The values cross the private HTTP boundary but are not stored. `Accepted` and `Idempotent` both
 * let the runtime continue after an ambiguous network retry; `Denied` means the supplied state must
 * not be used. Callers must not treat a database or network error as `Denied`, because the save may
 * already have committed.
 */
export enum RuntimeContinuationSaveOutcomes
{
	/** The server encrypted and stored this newer revision, so the attempt may enter its waiting state. */
	Accepted = "accepted",
	/** The same revision and digest were already stored; this retry has the same effect as `Accepted`. */
	Idempotent = "idempotent",
	/** The caller, revision, or pending-call links were not current, so the runtime must fail this command. */
	Denied = "denied",
}

/** Returns a save outcome and, for a refusal, a content-free reason suitable for the private response. */
export interface RuntimeContinuationSaveResult
{
	/** Stable authority result. */
	readonly outcome: RuntimeContinuationSaveOutcomes;
	/** Safe machine-readable refusal reason with no continuation content. */
	readonly reason?: string;
}

/**
 * Owns continuation storage, resume loading, and the stream fence used during Pod replacement.
 *
 * The private runtime transport calls {@link RuntimeContinuationAuthority.save} and
 * {@link RuntimeContinuationAuthority.attachToResume}. The AgentRun lifecycle calls
 * {@link RuntimeContinuationAuthority.prepareReplacementInTransaction} before it changes the Pod
 * generation, so stream fencing and replacement either commit together or both roll back.
 */
export interface RuntimeContinuationAuthority
{
	/** Validates the active Pod, command, revision, and pending-call rows before encrypting the state. */
	save(identity: RuntimeStreamWorkloadIdentity, request: RuntimeContinuationSaveRequest): Promise<RuntimeContinuationSaveResult>;
	/** Returns a resume with its checked state, or null when current state cannot be restored. */
	attachToResume(identity: RuntimeStreamWorkloadIdentity, open: RuntimeStreamOpen, command: RuntimeCommandEnvelope): Promise<RuntimeCommandEnvelope | null>;
	/** Returns true after checking a waiting continuation and fencing its old stream in the caller's transaction; null refuses replacement. */
	prepareReplacementInTransaction(transaction: unknown, runId: string, attempt: number): Promise<true | null>;
}

/** Parsed plaintext with its exact UTF-8 bytes and canonical digest already verified. */
export interface ParsedRuntimeContinuation
{
	/** Safe typed continuation. */
	readonly continuation: RuntimeAttemptContinuation;
	/** Exact JSON bytes encrypted into storage. */
	readonly plaintext: Uint8Array;
}

/** Stored checkpoint fields needed for decryption and authority checks. */
export interface RuntimeContinuationCheckpointRow
{
	readonly formatVersion: string;
	readonly revision: number;
	readonly digest: string;
	readonly appliedCommandSequence: number;
	readonly sourceRuntimeInstanceId: string;
	readonly sourceCommandId: string;
	readonly sourceFence: number;
	readonly keyId: string;
	readonly ciphertext: Uint8Array<ArrayBuffer>;
	readonly nonce: Uint8Array<ArrayBuffer>;
	readonly authenticationTag: Uint8Array<ArrayBuffer>;
	readonly plaintextBytes: number;
}

/** Current server-owned coordinates against which a save request is admitted. */
export interface RuntimeContinuationSaveAuthority
{
	readonly inputGeneration: number;
	readonly fence: number;
	readonly runtimeInstanceId: string;
	readonly commandSequence: number;
}

/** Fields written for one encrypted continuation revision. */
export interface RuntimeContinuationCheckpointWrite
{
	readonly runId: string;
	readonly attempt: number;
	readonly inputGeneration: number;
	readonly formatVersion: string;
	readonly revision: number;
	readonly digest: string;
	readonly appliedCommandSequence: number;
	readonly sourceRuntimeInstanceId: string;
	readonly sourceCommandId: string;
	readonly sourceFence: number;
	readonly keyId: string;
	readonly ciphertext: Uint8Array<ArrayBuffer>;
	readonly nonce: Uint8Array<ArrayBuffer>;
	readonly authenticationTag: Uint8Array<ArrayBuffer>;
	readonly plaintextBytes: number;
}

/**
 * Supplies the database reads and compare-and-set writes used by {@link RuntimeContinuationAuthority}.
 *
 * Implementations run inside the caller's database transaction. A lost insert, revision update, or
 * stream-fence update must remain visible as a non-unit count so the authority can abort instead of
 * accepting an older continuation.
 */
export interface RuntimeContinuationPersistenceRepository
{
	loadSaveAuthority(config: RuntimeDispatchAuthorityConfig, identity: RuntimeStreamWorkloadIdentity, request: RuntimeContinuationSaveRequest): Promise<RuntimeContinuationSaveAuthority | null>;
	pendingCorrelationsAreDurable(runId: string, attempt: number, continuation: RuntimeAttemptContinuation): Promise<boolean>;
	deleteOtherGenerations(runId: string, attempt: number, inputGeneration: number): Promise<{ readonly count: number }>;
	load(runId: string, attempt: number, inputGeneration: number): Promise<RuntimeContinuationCheckpointRow | null>;
	create(data: RuntimeContinuationCheckpointWrite): Promise<{ readonly count: number }>;
	update(runId: string, attempt: number, inputGeneration: number, expectedRevision: number, data: RuntimeContinuationCheckpointWrite): Promise<{ readonly count: number }>;
	loadWaitingRecovery(runId: string, attempt: number): Promise<{ readonly checkpoint: RuntimeContinuationCheckpointRow; readonly inputGeneration: number; readonly fence: number } | null>;
	advanceFence(runId: string, attempt: number, inputGeneration: number, expectedFence: number): Promise<{ readonly count: number }>;
}
