import { ArtifactKind, ArtifactRevisionState, ArtifactUploadLeaseState, ConversationAssetProvenance, ConversationAssetState, WorkloadAssignmentState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaConversationAssetOutputRepository } from "../prisma-conversation-asset-output-repository.js";
import { PrismaConversationAssetOutputUnitOfWork } from "../prisma-conversation-asset-output-unit-of-work.js";

const _IDENTITY = { namespace: "runtime-ns", serviceAccountName: "agent-runtime-default", podUid: "pod-1" } as const;
const _ADDRESS = `sha256:${"a".repeat(64)}`;
const _COMMAND = { runId: "run-1", runAttempt: 2, messageId: "message-1", idempotencyKey: "output-1", displayName: "report.pdf", mediaType: "application/pdf", byteLength: 5, contentAddress: _ADDRESS } as const;
const _NOW = new Date("2026-08-11T10:00:00.000Z");

/** Exact live assignment selected by the output authority. */
function _Assignment()
{
	return { runId: "run-1", attempt: 2, siloId: "silo-1", subjectId: "user-1", agentServiceId: "service-1", agentRevisionId: "revision-1", namespace: _IDENTITY.namespace, serviceAccountName: _IDENTITY.serviceAccountName, podUid: _IDENTITY.podUid, state: WorkloadAssignmentState.Registered, expiresAt: new Date(Date.now() + 60_000), run: { id: "run-1", attempt: 2, conversationId: "conversation-1" } };
}

/** Complete generated asset fixture returned by mocked Prisma writes. */
function _Asset(overrides: Record<string, unknown> = {})
{
	return { id: "asset-1", siloId: "silo-1", conversationId: "conversation-1", messageId: null, runId: "run-1", runAttempt: 2, runEventSequence: 7, runMessageId: "message-1", artifactId: "artifact-1", revisionId: null, uploadLeaseId: "lease-1", outputTicketId: "ticket-1", idempotencyKey: "output-1", provenance: ConversationAssetProvenance.AgentOutput, state: ConversationAssetState.Uploading, displayName: "report.pdf", mediaType: "application/pdf", byteLength: 5n, failureCode: null, createdByUserId: null, createdAt: _NOW, ...overrides };
}

/** Exact assistant message-start event used as the public message coordinate. */
function _MessageEvent()
{
	return { conversationId: "conversation-1", runId: "run-1", sequence: 7, type: "message.started", messageId: "message-1", payload: { messageId: "message-1", role: "assistant" } };
}

describe("PrismaConversationAssetOutputRepository", function _Suite()
{
	it("atomically reserves one generated artifact behind the exact active attempt and message event", async function _Reserves()
	{
		const transaction = {
			workloadAssignment: { findFirst: vi.fn().mockResolvedValue(_Assignment()) },
			conversationRunEvent: { findFirst: vi.fn().mockResolvedValue(_MessageEvent()) },
			conversationAssetOutputTicket: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
			artifact: { create: vi.fn() }, artifactUploadLease: { create: vi.fn() },
			conversationAsset: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockImplementation(async function _Create({ data }: { readonly data: Record<string, unknown> }) { return _Asset(data); }) }
		};
		const result = await new PrismaConversationAssetOutputRepository(transaction as never).reserve(_IDENTITY, _COMMAND);

		expect(result).toEqual({ outcome: "issued", ticketId: expect.any(String) });
		expect(transaction.workloadAssignment.findFirst).toHaveBeenCalledWith({ where: { runId: "run-1", attempt: 2, namespace: "runtime-ns", serviceAccountName: "agent-runtime-default", podUid: "pod-1", state: WorkloadAssignmentState.Registered, expiresAt: { gt: expect.any(Date) }, run: { attempt: 2 } }, include: { run: true } });
		expect(transaction.conversationRunEvent.findFirst).toHaveBeenCalledWith({ where: { conversationId: "conversation-1", runId: "run-1", type: "message.started", messageId: "message-1" }, select: { sequence: true, payload: true } });
		expect(transaction.artifact.create).toHaveBeenCalledWith({ data: expect.objectContaining({ siloId: "silo-1", ownerPrincipalId: "user-1", kind: ArtifactKind.Generated }) });
		expect(transaction.artifactUploadLease.create).toHaveBeenCalledWith({ data: expect.objectContaining({ expectedContentAddress: _ADDRESS, expectedByteLength: 5n, mediaType: "application/pdf" }) });
		expect(transaction.conversationAsset.create).toHaveBeenCalledWith({ data: expect.objectContaining({ runId: "run-1", runAttempt: 2, runEventSequence: 7, runMessageId: "message-1", provenance: ConversationAssetProvenance.AgentOutput, state: ConversationAssetState.Uploading }) });
	});

	it("enforces the approved 200 MiB total across all outputs for one message", async function _LimitsMessageTotal()
	{
		const transaction = {
			workloadAssignment: { findFirst: vi.fn().mockResolvedValue(_Assignment()) },
			conversationRunEvent: { findFirst: vi.fn().mockResolvedValue(_MessageEvent()) },
			conversationAssetOutputTicket: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
			conversationAsset: { findMany: vi.fn().mockResolvedValue([{ mediaType: "application/pdf", byteLength: 200n * 1_024n * 1_024n }]), create: vi.fn() },
			artifact: { create: vi.fn() }, artifactUploadLease: { create: vi.fn() },
		};
		const result = await new PrismaConversationAssetOutputRepository(transaction as never).reserve(_IDENTITY, _COMMAND);

		expect(result).toEqual({ outcome: "denied", reason: "invalid_request" });
		expect(transaction.conversationAsset.findMany).toHaveBeenCalledWith({ where: { conversationId: "conversation-1", runId: "run-1", runAttempt: 2, runMessageId: "message-1", provenance: ConversationAssetProvenance.AgentOutput }, select: { mediaType: true, byteLength: true } });
		expect(transaction.conversationAssetOutputTicket.create).not.toHaveBeenCalled();
		expect(transaction.artifact.create).not.toHaveBeenCalled();
	});

	it("returns the same ticket only when every retry coordinate still matches", async function _Idempotent()
	{
		const existing = { id: "ticket-1", runEventSequence: 7, outputMessageId: "message-1", asset: { ..._Asset(), uploadLease: { expectedContentAddress: _ADDRESS } } };
		const transaction = { workloadAssignment: { findFirst: vi.fn().mockResolvedValue(_Assignment()) }, conversationRunEvent: { findFirst: vi.fn().mockResolvedValue(_MessageEvent()) }, conversationAssetOutputTicket: { findUnique: vi.fn().mockResolvedValue(existing) } };
		const repository = new PrismaConversationAssetOutputRepository(transaction as never);

		expect(await repository.reserve(_IDENTITY, _COMMAND)).toEqual({ outcome: "idempotent", ticketId: "ticket-1" });
		expect(await repository.reserve(_IDENTITY, { ..._COMMAND, contentAddress: `sha256:${"b".repeat(64)}` })).toEqual({ outcome: "denied", reason: "output_conflict" });
	});

	it("finalizes verified bytes with immutable run provenance and one pending scan", async function _Finalizes()
	{
		const asset = _Asset();
		const ticket = { id: "ticket-1", runId: "run-1", runAttempt: 2, runEventSequence: 7, outputMessageId: "message-1", expiresAt: new Date(Date.now() + 60_000), finalizedAt: null, asset };
		const transaction = {
			conversationAssetOutputTicket: { findUnique: vi.fn().mockResolvedValue(ticket), update: vi.fn() },
			workloadAssignment: { findFirst: vi.fn().mockResolvedValue(_Assignment()) },
			artifactUploadLease: { findUnique: vi.fn().mockResolvedValue({ id: "lease-1", state: ArtifactUploadLeaseState.Active, expiresAt: new Date(Date.now() + 60_000), expectedContentAddress: _ADDRESS, expectedByteLength: 5n, mediaType: "application/pdf" }), update: vi.fn() },
			artifactRevision: { create: vi.fn() }, artifactScanJob: { create: vi.fn() },
			conversationAsset: { update: vi.fn().mockResolvedValue(_Asset({ revisionId: "revision-new", state: ConversationAssetState.Processing })) },
			conversation: { findUnique: vi.fn().mockResolvedValue({ lifecycle: "Open" }) },
			conversationTimelineEntry: { create: vi.fn() },
		};
		const promotion = { leaseId: "lease-1", contentAddress: _ADDRESS, byteLength: 5, mediaType: "application/pdf", issuedAtEpochSeconds: 1 };
		const result = await new PrismaConversationAssetOutputRepository(transaction as never).finalize(_IDENTITY, "ticket-1", promotion, `sha256:${"c".repeat(64)}`);

		expect(result).toEqual({ outcome: "accepted" });
		expect(transaction.artifactRevision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ state: ArtifactRevisionState.Quarantined, sourceRunId: "run-1", sourceMessageId: "message-1", provenance: expect.objectContaining({ kind: "conversation_agent_output", outputTicketId: "ticket-1", runEventSequence: 7 }), createdBy: "user-1" }) });
		expect(transaction.artifactScanJob.create).toHaveBeenCalledWith({ data: { artifactRevisionId: expect.any(String) } });
		expect(transaction.conversationAssetOutputTicket.update).toHaveBeenCalledWith({ where: { id: "ticket-1" }, data: { finalizedContentAddress: _ADDRESS, finalizedReceiptDigest: `sha256:${"c".repeat(64)}`, finalizedAt: expect.any(Date) } });
		expect(transaction.conversationAsset.update).toHaveBeenCalledWith({ where: { id: "asset-1" }, data: { revisionId: expect.any(String), state: ConversationAssetState.Processing } });
		expect(transaction.conversationTimelineEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ conversationId: "conversation-1", systemEventId: "conversation-asset:asset-1:processing", payload: { eventType: "conversation.assets.changed" } }) });
	});

	it("does not finalize when the runtime assignment is revoked during promotion", async function _Revoked()
	{
		const asset = _Asset();
		const targetTransaction = {
			conversationAssetOutputTicket: { findUnique: vi.fn().mockResolvedValue({ id: "ticket-1", runId: "run-1", runAttempt: 2, expiresAt: new Date(Date.now() + 60_000), finalizedAt: null, asset: { ...asset, uploadLease: { id: "lease-1", siloId: "silo-1", artifactId: "artifact-1", state: ArtifactUploadLeaseState.Active, expiresAt: new Date(Date.now() + 60_000), expectedContentAddress: _ADDRESS, expectedByteLength: 5n, mediaType: "application/pdf" } } }) },
			workloadAssignment: { findFirst: vi.fn().mockResolvedValue(_Assignment()) }
		};
		const finalizeTransaction = { conversationAssetOutputTicket: { findUnique: vi.fn().mockResolvedValue({ id: "ticket-1", runId: "run-1", runAttempt: 2, expiresAt: new Date(Date.now() + 60_000), finalizedAt: null, asset }) }, workloadAssignment: { findFirst: vi.fn().mockResolvedValue(null) }, artifactRevision: { create: vi.fn() }, artifactScanJob: { create: vi.fn() } };
		const prisma = { $transaction: vi.fn().mockImplementationOnce(async function _Read(work: (value: unknown) => unknown) { return work(targetTransaction); }).mockImplementationOnce(async function _Finalize(work: (value: unknown) => unknown) { return work(finalizeTransaction); }) };
		const service = { promote: vi.fn().mockResolvedValue({ receipt: "receipt" }) };
		const crypto = { signLease: vi.fn().mockReturnValue("signed"), verifyReceipt: vi.fn().mockReturnValue({ leaseId: "lease-1", contentAddress: _ADDRESS, byteLength: 5, mediaType: "application/pdf", issuedAtEpochSeconds: 1 }), digestReceipt: vi.fn().mockReturnValue("digest") };

		const result = await new PrismaConversationAssetOutputUnitOfWork(prisma as never, service, crypto).publish(_IDENTITY, "ticket-1", (async function* _Bytes() { yield new Uint8Array([1]); })());

		expect(service.promote).toHaveBeenCalledOnce();
		expect(result).toEqual({ outcome: "denied", reason: "runtime_unavailable" });
		expect(finalizeTransaction.artifactRevision.create).not.toHaveBeenCalled();
		expect(finalizeTransaction.artifactScanJob.create).not.toHaveBeenCalled();
	});
});
