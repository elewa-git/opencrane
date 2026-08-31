import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { RuntimeContinuationCipher } from "@opencrane/backend/server/infra/agent-runtime-continuation";
import type { Logger } from "@opencrane/backend/observability";
import { AGENT_RUNTIME_CONTINUATION_VERSION, AGENT_RUNTIME_PROTOCOL_VERSION, RuntimeCommandKinds, type RuntimeAttemptContinuation, type RuntimeCommandEnvelope, type RuntimeContinuationSaveRequest } from "@opencrane/contracts";

import { PrismaRuntimeContinuationAuthorityUnitOfWork } from "../prisma-runtime-continuation-authority";
import type { RuntimeStreamWorkloadIdentity } from "../prisma-runtime-dispatch-authority.types";
import { __DigestRuntimeContinuation } from "../runtime-continuation";

const _identity: RuntimeStreamWorkloadIdentity = { subject: "system:serviceaccount:personal-runtime:warm-runtime", namespace: "personal-runtime", serviceAccountName: "warm-runtime", podUid: "pod-1" };

/** Build one valid waiting checkpoint with one pending external action. */
function _Continuation(): RuntimeAttemptContinuation
{
	const covered = { version: AGENT_RUNTIME_CONTINUATION_VERSION, revision: 4, runId: "run-1", attempt: 1, inputGeneration: 3, appliedCommandSequence: 2, compiledInput: { runId: "run-1" }, modelMessages: [{ role: "assistant", content: "waiting" }], pendingToolCalls: [{ toolInvocationId: "tool-1", frameworkCallId: "call-1" }], pendingElicitations: [] } as unknown as Omit<RuntimeAttemptContinuation, "digest">;
	return { ...covered, digest: __DigestRuntimeContinuation(covered) };
}

/** Build one valid governed-pause continuation with a durable tool correlation. */
function _PendingContinuation(): RuntimeAttemptContinuation
{
	return _Continuation();
}

/** Build an invalid checkpoint that claims no governed pause. */
function _EmptyContinuation(): RuntimeAttemptContinuation
{
	const { digest: _digest, ...valid } = _Continuation();
	const covered = { ...valid, pendingToolCalls: [] } as Omit<RuntimeAttemptContinuation, "digest">;
	return { ...covered, digest: __DigestRuntimeContinuation(covered) };
}

/** Build the exact save request used by authority-denial tests. */
function _SaveRequest(continuation = _PendingContinuation()): RuntimeContinuationSaveRequest
{
	return { protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION, runtimeInstanceId: "runtime-1", commandId: "command-2", runId: "run-1", attempt: 1, fence: 8, inputGeneration: 3, continuation };
}

/** Build a transaction-shaped fake with current generation-two authority. */
function _SaveTransaction(overrides: { readonly assignmentState?: string; readonly assignmentRevokedAt?: Date | null; readonly assignmentDeadline?: Date; readonly workloadKind?: string; readonly commandSequence?: number; readonly nextCommandSequence?: number; readonly podUid?: string; readonly reservationState?: string; readonly reservationDeadline?: Date; readonly durableTool?: boolean; readonly checkpoint?: unknown } = {})
{
	return {
		workloadAssignment: { findUnique: vi.fn().mockResolvedValue({ namespace: "personal-runtime", serviceAccountName: "warm-runtime", bindingGeneration: 2, state: overrides.assignmentState ?? "Registered", revokedAt: overrides.assignmentRevokedAt ?? null, expiresAt: overrides.assignmentDeadline ?? new Date("2099-01-01T00:00:00.000Z"), workloadKind: overrides.workloadKind ?? "Deployment" }) },
		warmRuntimeReservation: { findUnique: vi.fn().mockResolvedValue({ state: overrides.reservationState ?? "Claimed", podUid: overrides.podUid ?? "pod-1", namespace: "personal-runtime", serviceAccountName: "warm-runtime", idleDeadline: overrides.reservationDeadline ?? new Date("2099-01-01T00:00:00.000Z") }) },
		runtimeCommandStream: { findUnique: vi.fn().mockResolvedValue({ inputGeneration: 3, fence: 8, runtimeInstanceId: "runtime-1", nextCommandSequence: overrides.nextCommandSequence ?? 3 }) },
		runtimeDispatchedCommand: { findUnique: vi.fn().mockResolvedValue({ runId: "run-1", attempt: 1, kind: "ResumeAttempt", sequence: overrides.commandSequence ?? 2, fence: 8 }) },
		toolInvocation: { findMany: vi.fn().mockResolvedValue(overrides.durableTool === false ? [] : [{ toolInvocationId: "tool-1" }]) },
		elicitationRequest: { findMany: vi.fn().mockResolvedValue([]) },
		runtimeContinuationCheckpoint: {
			findUnique: vi.fn().mockResolvedValue(overrides.checkpoint ?? null),
			deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
			createMany: vi.fn().mockResolvedValue({ count: 1 }),
			updateMany: vi.fn().mockResolvedValue({ count: 1 }),
		},
	};
}

/** Build the production authority over one transaction-shaped fake. */
function _Authority(transaction: ReturnType<typeof _SaveTransaction>, cipher: RuntimeContinuationCipher, logger = { warn: vi.fn() } as unknown as Logger)
{
	const prisma = { $transaction: vi.fn(async function _Transaction(run: (value: typeof transaction) => Promise<unknown>) { return await run(transaction); }) } as unknown as PrismaClient;
	return new PrismaRuntimeContinuationAuthorityUnitOfWork(prisma, { personalRuntimeNamespace: "personal-runtime", managedRuntimeNamespace: "managed-runtime", commandTtlMilliseconds: 60_000 }, cipher, logger);
}

describe("PrismaRuntimeContinuationAuthorityUnitOfWork", function _Suite()
{
	it("advances a waiting stream fence once across a crash retry", async function _IdempotentReplacementFence()
	{
		const continuation = _Continuation();
		const plaintext = Buffer.from(JSON.stringify(continuation), "utf8");
		const stream = { inputGeneration: 3, fence: 7, nextCommandSequence: 3 };
		const checkpoint = { formatVersion: continuation.version, revision: continuation.revision, digest: continuation.digest, appliedCommandSequence: continuation.appliedCommandSequence, sourceRuntimeInstanceId: "runtime-1", sourceCommandId: "command-2", sourceFence: 7, keyId: "key-1", ciphertext: Buffer.from("ciphertext"), nonce: Buffer.alloc(12), authenticationTag: Buffer.alloc(16), plaintextBytes: plaintext.length };
		const updateMany = vi.fn(async function _Advance(args: { where: { fence: number }; data: { fence: number } })
		{
			if (stream.fence !== args.where.fence)
				return { count: 0 };
			stream.fence = args.data.fence;
			return { count: 1 };
		});
		const transaction = {
			agentRun: { findUnique: vi.fn().mockResolvedValue({ attempt: 1, state: "WaitingForInput" }) },
			runtimeCommandStream: { findUnique: vi.fn(async function _ReadStream() { return { ...stream }; }), updateMany },
			runtimeContinuationCheckpoint: { findUnique: vi.fn().mockResolvedValue(checkpoint) },
			toolInvocation: { findMany: vi.fn().mockResolvedValue([{ toolInvocationId: "tool-1" }]) },
			elicitationRequest: { findMany: vi.fn() },
		};
		const prisma = { $transaction: vi.fn(async function _Transaction(run: (value: typeof transaction) => Promise<unknown>) { return await run(transaction); }) } as unknown as PrismaClient;
		const cipher = { seal: vi.fn(), open: vi.fn().mockResolvedValue(plaintext) } as unknown as RuntimeContinuationCipher;
		const authority = new PrismaRuntimeContinuationAuthorityUnitOfWork(prisma, { personalRuntimeNamespace: "personal-runtime", managedRuntimeNamespace: "managed-runtime", commandTtlMilliseconds: 60_000 }, cipher, { warn: vi.fn() } as unknown as Logger);

		await expect(authority.prepareReplacementInTransaction(transaction, "run-1", 1)).resolves.toBe(true);
		await expect(authority.prepareReplacementInTransaction(transaction, "run-1", 1)).resolves.toBe(true);
		expect(updateMany).toHaveBeenCalledTimes(1);
	});

	it("refuses replacement when the dead runtime did not save its latest waiting state", async function _StaleReplacementCheckpoint()
	{
		const continuation = _Continuation();
		const staleCovered = { ...continuation, appliedCommandSequence: 1 };
		const { digest: _digest, ...staleWithoutDigest } = staleCovered;
		const stale = { ...staleWithoutDigest, digest: __DigestRuntimeContinuation(staleWithoutDigest) };
		const plaintext = Buffer.from(JSON.stringify(stale), "utf8");
		const checkpoint = { formatVersion: stale.version, revision: stale.revision, digest: stale.digest, appliedCommandSequence: stale.appliedCommandSequence, sourceRuntimeInstanceId: "runtime-1", sourceCommandId: "command-1", sourceFence: 7, keyId: "key-1", ciphertext: Buffer.from("ciphertext"), nonce: Buffer.alloc(12), authenticationTag: Buffer.alloc(16), plaintextBytes: plaintext.length };
		const transaction = {
			agentRun: { findUnique: vi.fn().mockResolvedValue({ attempt: 1, state: "WaitingForInput" }) },
			runtimeCommandStream: { findUnique: vi.fn().mockResolvedValue({ inputGeneration: 3, fence: 7, nextCommandSequence: 3 }), updateMany: vi.fn() },
			runtimeContinuationCheckpoint: { findUnique: vi.fn().mockResolvedValue(checkpoint) },
			toolInvocation: { findMany: vi.fn() },
			elicitationRequest: { findMany: vi.fn() },
		};
		const prisma = { $transaction: vi.fn(async function _Transaction(run: (value: typeof transaction) => Promise<unknown>) { return await run(transaction); }) } as unknown as PrismaClient;
		const cipher = { seal: vi.fn(), open: vi.fn().mockResolvedValue(plaintext) } as unknown as RuntimeContinuationCipher;
		const authority = new PrismaRuntimeContinuationAuthorityUnitOfWork(prisma, { personalRuntimeNamespace: "personal-runtime", managedRuntimeNamespace: "managed-runtime", commandTtlMilliseconds: 60_000 }, cipher, { warn: vi.fn() } as unknown as Logger);

		await expect(authority.prepareReplacementInTransaction(transaction, "run-1", 1)).resolves.toBeNull();
		expect(transaction.runtimeCommandStream.updateMany).not.toHaveBeenCalled();
		expect(cipher.open).not.toHaveBeenCalled();
	});

	it("accepts the source continuation after its resume command wins the dispatch race", async function _RacingResumeCommand()
	{
		const transaction = _SaveTransaction({ commandSequence: 2, nextCommandSequence: 4 });
		const cipher = { seal: vi.fn().mockResolvedValue({ keyId: "key-1", ciphertext: Buffer.from("ciphertext"), nonce: Buffer.alloc(12), authenticationTag: Buffer.alloc(16) }), open: vi.fn() } as unknown as RuntimeContinuationCipher;

		await expect(_Authority(transaction, cipher).save(_identity, _SaveRequest())).resolves.toEqual({ outcome: "accepted" });
		expect(cipher.seal).toHaveBeenCalledOnce();
	});

	it("denies a continuation whose source is more than one command behind", async function _HistoricalCommand()
	{
		const transaction = _SaveTransaction({ commandSequence: 2, nextCommandSequence: 5 });
		const cipher = { seal: vi.fn(), open: vi.fn() } as unknown as RuntimeContinuationCipher;

		await expect(_Authority(transaction, cipher).save(_identity, _SaveRequest())).resolves.toEqual(expect.objectContaining({ reason: "stale_continuation_authority" }));
		expect(cipher.seal).not.toHaveBeenCalled();
	});

	it("does not let a late source checkpoint replace a newer applied command", async function _MonotonicAppliedCommand()
	{
		const newer = { ..._Continuation(), revision: 5, appliedCommandSequence: 3 };
		const transaction = _SaveTransaction({ commandSequence: 2, nextCommandSequence: 4, checkpoint: { ...newer, formatVersion: newer.version, sourceRuntimeInstanceId: "runtime-1", sourceCommandId: "command-3", sourceFence: 8, keyId: "key-1", ciphertext: Buffer.from("ciphertext"), nonce: Buffer.alloc(12), authenticationTag: Buffer.alloc(16), plaintextBytes: 100 } });
		const cipher = { seal: vi.fn(), open: vi.fn() } as unknown as RuntimeContinuationCipher;

		await expect(_Authority(transaction, cipher).save(_identity, _SaveRequest())).resolves.toEqual(expect.objectContaining({ reason: "continuation_revision_conflict" }));
		expect(cipher.seal).not.toHaveBeenCalled();
	});

	it("denies a continuation from a replaced Pod", async function _ReplacedPod()
	{
		const transaction = _SaveTransaction({ podUid: "pod-2" });
		const cipher = { seal: vi.fn(), open: vi.fn() } as unknown as RuntimeContinuationCipher;

		await expect(_Authority(transaction, cipher).save(_identity, _SaveRequest())).resolves.toEqual(expect.objectContaining({ reason: "stale_continuation_authority" }));
		expect(cipher.seal).not.toHaveBeenCalled();
	});

	it("denies a continuation after its reservation leaves the claimed lease", async function _InactiveReservation()
	{
		for (const transaction of [_SaveTransaction({ reservationState: "DeleteRequested" }), _SaveTransaction({ reservationDeadline: new Date("2000-01-01T00:00:00.000Z") })])
		{
			const cipher = { seal: vi.fn(), open: vi.fn() } as unknown as RuntimeContinuationCipher;
			await expect(_Authority(transaction, cipher).save(_identity, _SaveRequest())).resolves.toEqual(expect.objectContaining({ reason: "stale_continuation_authority" }));
			expect(cipher.seal).not.toHaveBeenCalled();
		}
	});

	it("denies a continuation after its workload assignment loses active warm authority", async function _InactiveAssignment()
	{
		const assignments = [
			_SaveTransaction({ assignmentState: "PendingPod" }),
			_SaveTransaction({ assignmentRevokedAt: new Date("2026-08-29T00:00:00.000Z") }),
			_SaveTransaction({ assignmentDeadline: new Date("2000-01-01T00:00:00.000Z") }),
			_SaveTransaction({ workloadKind: "Job" }),
		];
		for (const transaction of assignments)
		{
			const cipher = { seal: vi.fn(), open: vi.fn() } as unknown as RuntimeContinuationCipher;
			await expect(_Authority(transaction, cipher).save(_identity, _SaveRequest())).resolves.toEqual(expect.objectContaining({ reason: "stale_continuation_authority" }));
			expect(transaction.warmRuntimeReservation.findUnique).not.toHaveBeenCalled();
			expect(cipher.seal).not.toHaveBeenCalled();
		}
	});

	it("denies a continuation from the wrong namespace or ServiceAccount", async function _WrongWorkloadPlane()
	{
		for (const identity of [{ ..._identity, namespace: "other-runtime" }, { ..._identity, serviceAccountName: "other-account" }])
		{
			const transaction = _SaveTransaction();
			const cipher = { seal: vi.fn(), open: vi.fn() } as unknown as RuntimeContinuationCipher;
			await expect(_Authority(transaction, cipher).save(identity, _SaveRequest())).resolves.toEqual(expect.objectContaining({ reason: "stale_continuation_authority" }));
			expect(cipher.seal).not.toHaveBeenCalled();
		}
	});

	it("denies stale runtime, fence, and input-generation coordinates", async function _StaleCoordinates()
	{
		const requests: RuntimeContinuationSaveRequest[] = [
			{ ..._SaveRequest(), runtimeInstanceId: "runtime-old" },
			{ ..._SaveRequest(), fence: 7 },
			{ ..._SaveRequest(), inputGeneration: 2 },
		];
		for (const request of requests)
		{
			const transaction = _SaveTransaction();
			const cipher = { seal: vi.fn(), open: vi.fn() } as unknown as RuntimeContinuationCipher;
			await expect(_Authority(transaction, cipher).save(_identity, request)).resolves.toEqual(expect.objectContaining({ reason: expect.stringMatching(/stale_continuation_authority|continuation_coordinates_mismatch/) }));
			expect(cipher.seal).not.toHaveBeenCalled();
		}
	});

	it("denies an empty checkpoint outside a governed pause", async function _EmptyCheckpoint()
	{
		const transaction = _SaveTransaction();
		const cipher = { seal: vi.fn(), open: vi.fn() } as unknown as RuntimeContinuationCipher;

		await expect(_Authority(transaction, cipher).save(_identity, _SaveRequest(_EmptyContinuation()))).resolves.toEqual(expect.objectContaining({ reason: "invalid_continuation" }));
		expect(transaction.workloadAssignment.findUnique).not.toHaveBeenCalled();
	});

	it("denies pending identifiers that are not durable", async function _UnknownPendingWork()
	{
		const transaction = _SaveTransaction({ durableTool: false });
		const cipher = { seal: vi.fn(), open: vi.fn() } as unknown as RuntimeContinuationCipher;

		await expect(_Authority(transaction, cipher).save(_identity, _SaveRequest())).resolves.toEqual(expect.objectContaining({ reason: "pending_correlation_mismatch" }));
		expect(cipher.seal).not.toHaveBeenCalled();
	});

	it("refuses a resume when the current generation has no continuation", async function _MissingResumeCheckpoint()
	{
		const transaction = _SaveTransaction({ commandSequence: 3, nextCommandSequence: 4 });
		const cipher = { seal: vi.fn(), open: vi.fn() } as unknown as RuntimeContinuationCipher;
		const command = { protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION, runtimeInstanceId: "runtime-1", commandId: "command-3", sequence: 3, fence: 8, issuedAt: "2026-08-29T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", assignment: { runId: "run-1", attempt: 1 }, kind: RuntimeCommandKinds.ResumeAttempt, payload: { inputGeneration: 3, toolResults: [], elicitationResults: [] } } as unknown as RuntimeCommandEnvelope;

		await expect(_Authority(transaction, cipher).attachToResume(_identity, { protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION, runtimeInstanceId: "runtime-1", podUid: "pod-1" }, command)).resolves.toBeNull();
		expect(cipher.open).not.toHaveBeenCalled();
	});

	it("waits for the directly preceding checkpoint before attaching a chained resume", async function _WaitsForPrecedingCheckpoint()
	{
		const current = _PendingContinuation();
		const currentPlaintext = Buffer.from(JSON.stringify(current), "utf8");
		const staleCovered = { ...current, appliedCommandSequence: 1 };
		const { digest: _digest, ...staleWithoutDigest } = staleCovered;
		const stale = { ...staleWithoutDigest, digest: __DigestRuntimeContinuation(staleWithoutDigest) };
		const staleCheckpoint = { formatVersion: stale.version, revision: stale.revision, digest: stale.digest, appliedCommandSequence: stale.appliedCommandSequence, sourceRuntimeInstanceId: "runtime-1", sourceCommandId: "command-1", sourceFence: 8, keyId: "key-1", ciphertext: Buffer.from("ciphertext"), nonce: Buffer.alloc(12), authenticationTag: Buffer.alloc(16), plaintextBytes: Buffer.byteLength(JSON.stringify(stale)) };
		const currentCheckpoint = { ...staleCheckpoint, digest: current.digest, appliedCommandSequence: current.appliedCommandSequence, sourceCommandId: "command-2", plaintextBytes: currentPlaintext.length };
		const command = { protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION, runtimeInstanceId: "runtime-1", commandId: "command-3", sequence: 3, fence: 8, issuedAt: "2026-08-29T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", assignment: { runId: "run-1", attempt: 1 }, kind: RuntimeCommandKinds.ResumeAttempt, payload: { inputGeneration: 3, toolResults: [], elicitationResults: [] } } as unknown as RuntimeCommandEnvelope;
		const staleCipher = { seal: vi.fn(), open: vi.fn() } as unknown as RuntimeContinuationCipher;
		const currentCipher = { seal: vi.fn(), open: vi.fn().mockResolvedValue(currentPlaintext) } as unknown as RuntimeContinuationCipher;

		await expect(_Authority(_SaveTransaction({ commandSequence: 3, nextCommandSequence: 4, checkpoint: staleCheckpoint }), staleCipher).attachToResume(_identity, { protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION, runtimeInstanceId: "runtime-1", podUid: "pod-1" }, command)).resolves.toBeNull();
		expect(staleCipher.open).not.toHaveBeenCalled();
		await expect(_Authority(_SaveTransaction({ commandSequence: 3, nextCommandSequence: 4, checkpoint: currentCheckpoint }), currentCipher).attachToResume(_identity, { protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION, runtimeInstanceId: "runtime-1", podUid: "pod-1" }, command)).resolves.toEqual(expect.objectContaining({ payload: expect.objectContaining({ continuation: current }) }));
	});

	it("fails closed when saved ciphertext cannot be authenticated", async function _CorruptCiphertext()
	{
		const continuation = _PendingContinuation();
		const checkpoint = { formatVersion: continuation.version, revision: continuation.revision, digest: continuation.digest, appliedCommandSequence: continuation.appliedCommandSequence, sourceRuntimeInstanceId: "runtime-1", sourceCommandId: "command-2", sourceFence: 8, keyId: "key-1", ciphertext: Buffer.from("corrupt"), nonce: Buffer.alloc(12), authenticationTag: Buffer.alloc(16), plaintextBytes: 100 };
		const transaction = _SaveTransaction({ commandSequence: 3, nextCommandSequence: 4, checkpoint });
		const cipher = { seal: vi.fn(), open: vi.fn().mockRejectedValue(new Error("authentication failed")) } as unknown as RuntimeContinuationCipher;
		const command = { protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION, runtimeInstanceId: "runtime-1", commandId: "command-3", sequence: 3, fence: 8, issuedAt: "2026-08-29T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", assignment: { runId: "run-1", attempt: 1 }, kind: RuntimeCommandKinds.ResumeAttempt, payload: { inputGeneration: 3, toolResults: [], elicitationResults: [] } } as unknown as RuntimeCommandEnvelope;
		const logger = { warn: vi.fn() } as unknown as Logger;

		await expect(_Authority(transaction, cipher, logger).attachToResume(_identity, { protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION, runtimeInstanceId: "runtime-1", podUid: "pod-1" }, command)).resolves.toBeNull();
		expect(logger.warn).toHaveBeenCalledWith({ err: { type: "Error" }, operation: "runtime_continuation.open", reason: "decrypt_or_decode_failed", runId: "run-1", attempt: 1, inputGeneration: 3, keyId: "key-1" }, "Runtime continuation could not be opened");
	});

	it("logs a safe reason when stored checkpoint metadata is inconsistent", async function _InvalidStoredSize()
	{
		const continuation = _PendingContinuation();
		const checkpoint = { formatVersion: continuation.version, revision: continuation.revision, digest: continuation.digest, appliedCommandSequence: continuation.appliedCommandSequence, sourceRuntimeInstanceId: "runtime-1", sourceCommandId: "command-2", sourceFence: 8, keyId: "key-1", ciphertext: Buffer.from("ciphertext"), nonce: Buffer.alloc(12), authenticationTag: Buffer.alloc(16), plaintextBytes: 0 };
		const transaction = _SaveTransaction({ commandSequence: 3, nextCommandSequence: 4, checkpoint });
		const cipher = { seal: vi.fn(), open: vi.fn() } as unknown as RuntimeContinuationCipher;
		const command = { protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION, runtimeInstanceId: "runtime-1", commandId: "command-3", sequence: 3, fence: 8, issuedAt: "2026-08-29T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", assignment: { runId: "run-1", attempt: 1 }, kind: RuntimeCommandKinds.ResumeAttempt, payload: { inputGeneration: 3, toolResults: [], elicitationResults: [] } } as unknown as RuntimeCommandEnvelope;
		const logger = { warn: vi.fn() } as unknown as Logger;

		await expect(_Authority(transaction, cipher, logger).attachToResume(_identity, { protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION, runtimeInstanceId: "runtime-1", podUid: "pod-1" }, command)).resolves.toBeNull();
		expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ reason: "plaintext_size_out_of_bounds", keyId: "key-1" }), "Runtime continuation could not be opened");
		expect(cipher.open).not.toHaveBeenCalled();
	});
});
