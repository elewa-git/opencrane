import { ConversationAssetScanLifecycleStates } from "@opencrane/backend/server/agents/artifacts";
import { ArtifactKind, ArtifactRevisionState, ArtifactUploadLeaseState, ConversationAssetProvenance, ConversationAssetState, ConversationLifecycle, ConversationTimelineEntryKind, WorkloadAssignmentState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { ExecutionSubject } from "@opencrane/models/agents";
import { PrismaConversationAssetOutputRepository } from "../prisma-conversation-asset-output-repository";
import { PrismaConversationAssetOutputUnitOfWork } from "../prisma-conversation-asset-output-unit-of-work";

vi.mock("@opencrane/backend/server/iam/authorization", function _MockAuthorization()
{
	return {
		PrismaAuthorizationAuthority: class
		{
			async admitPrincipal() { return { outcome: "allow", evidence: { decisionDigest: "digest" } }; }
		},
		PrismaManagedAuthorizationGrantRepository: class
		{
			async reconcileManagedResourceGrants() { return undefined; }
		},
	};
});

const _IDENTITY = { namespace: "runtime-ns", serviceAccountName: "agent-runtime-default", podUid: "pod-1" } as const;
const _ADDRESS = `sha256:${"a".repeat(64)}`;
const _COMMAND = { runId: "run-1", runAttempt: 2, messageId: "message-1", idempotencyKey: "output-1", displayName: "report.pdf", mediaType: "application/pdf", byteLength: 5, contentAddress: _ADDRESS } as const;
const _NOW = new Date("2026-08-11T10:00:00.000Z");

/** Returns the evidence-bound subject persisted with every target workload assignment. */
function _ExecutionSubject(): ExecutionSubject
{
	return { schemaVersion: 1, siloId: "silo-1", agentIdentityId: "identity-1", principalId: "principal-1", identity: { agentIdentityId: "identity-1", principalId: "principal-1", siloId: "silo-1", headRevision: "1", headDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "identity-decision", verifiedAt: "2026-09-01T00:00:00.000Z" }, membership: { principalId: "principal-1", siloId: "silo-1", revision: 1, assertionId: "membership", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-decision", trustedUntil: "2099-01-01T00:00:00.000Z" }, capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: `sha256:${"c".repeat(64)}`, effectiveContractDigest: `sha256:${"d".repeat(64)}`, decisionEvidenceId: "capability-decision", decidedAt: "2026-09-01T00:00:00.000Z" }, runScope: { siloId: "silo-1", runId: "run-1", attempt: 2, agentServiceId: "service-1", agentRevisionId: "revision-1" }, computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 1 }, requester: { siloId: "silo-1", requesterPrincipalId: "requester-1", requestIdempotencyKey: "request-1", authenticatedAt: "2026-09-01T00:00:00.000Z" }, admission: { authorizingPrincipalId: "authorizer-1", decisionEvidenceId: "admission-decision", admittedAt: "2026-09-01T00:00:00.000Z" } };
}

/** Exact live assignment selected by the output authority. */
function _Assignment()
{
	return { runId: "run-1", attempt: 2, siloId: "silo-1", agentIdentityId: "identity-1", principalId: "principal-1", executionSubject: _ExecutionSubject(), agentServiceId: "service-1", agentRevisionId: "revision-1", namespace: _IDENTITY.namespace, serviceAccountName: _IDENTITY.serviceAccountName, bindingGeneration: 2, state: WorkloadAssignmentState.Registered, revokedAt: null, workloadKind: "Deployment", expiresAt: new Date(Date.now() + 60_000), run: { id: "run-1", attempt: 2, conversationId: "conversation-1" } };
}

/** Claimed warm reservation for the assignment's current binding generation. */
function _Reservation(generation = 2)
{
	return { generation, state: "Claimed", namespace: _IDENTITY.namespace, serviceAccountName: _IDENTITY.serviceAccountName, podUid: _IDENTITY.podUid, idleDeadline: new Date(Date.now() + 60_000) };
}

/** Complete generated asset fixture returned by mocked Prisma writes. */
function _Asset(overrides: Record<string, unknown> = {})
{
	return { id: "asset-1", siloId: "silo-1", conversationId: "conversation-1", messageId: null, runId: "run-1", runAttempt: 2, runEventSequence: 7, runMessageId: "message-1", artifactId: "artifact-1", revisionId: null, uploadLeaseId: "lease-1", outputTicketId: "ticket-1", idempotencyKey: "output-1", provenance: ConversationAssetProvenance.AgentOutput, state: ConversationAssetState.Uploading, displayName: "report.pdf", mediaType: "application/pdf", byteLength: 5n, failureCode: null, createdByUserId: null, createdAt: _NOW, ...overrides };
}

/** Exact assistant message-start event used as the public message coordinate. */
function _MessageEvent()
{
	return { conversationId: "conversation-1", runId: "run-1", attempt: 2, sequence: 7, type: "message.started", messageId: "message-1", payload: { messageId: "message-1", role: "assistant" } };
}

describe("PrismaConversationAssetOutputRepository", function _Suite()
{
	it("atomically reserves one generated artifact behind the exact active attempt and message event", async function _Reserves()
	{
		const transaction = {
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(_Assignment()) }, warmRuntimeReservation: { findUnique: vi.fn().mockResolvedValue(_Reservation()) },
			conversationRunEvent: { findFirst: vi.fn().mockResolvedValue(_MessageEvent()) },
			conversationAssetOutputTicket: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
			artifact: { create: vi.fn() }, artifactUploadLease: { create: vi.fn() },
			conversationAsset: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockImplementation(async function _Create({ data }: { readonly data: Record<string, unknown> }) { return _Asset(data); }) }
		};
		const result = await new PrismaConversationAssetOutputRepository(transaction as never).reserve(_IDENTITY, _COMMAND);

		expect(result).toEqual({ outcome: "issued", ticketId: expect.any(String) });
		expect(transaction.workloadAssignment.findUnique).toHaveBeenCalledWith({ where: { runId_attempt: { runId: "run-1", attempt: 2 } }, include: { run: true } });
		expect(transaction.warmRuntimeReservation.findUnique).toHaveBeenCalledWith({ where: { runId_attempt_generation: { runId: "run-1", attempt: 2, generation: 2 } } });
		expect(transaction.conversationRunEvent.findFirst).toHaveBeenCalledWith({ where: { conversationId: "conversation-1", runId: "run-1", attempt: 2, type: "message.started", messageId: "message-1" }, select: { sequence: true, payload: true } });
		expect(transaction.artifact.create).toHaveBeenCalledWith({ data: expect.objectContaining({ siloId: "silo-1", ownerPrincipalId: "principal-1", kind: ArtifactKind.Generated }) });
		expect(transaction.artifactUploadLease.create).toHaveBeenCalledWith({ data: expect.objectContaining({ expectedContentAddress: _ADDRESS, expectedByteLength: 5n, mediaType: "application/pdf" }) });
		expect(transaction.conversationAsset.create).toHaveBeenCalledWith({ data: expect.objectContaining({ runId: "run-1", runAttempt: 2, runEventSequence: 7, runMessageId: "message-1", provenance: ConversationAssetProvenance.AgentOutput, state: ConversationAssetState.Uploading }) });
	});

	it("rejects an output from a Pod reservation older than the assignment generation", async function _RejectsOldPod()
	{
		const transaction = { workloadAssignment: { findUnique: vi.fn().mockResolvedValue(_Assignment()) }, warmRuntimeReservation: { findUnique: vi.fn().mockResolvedValue(_Reservation(1)) }, conversationRunEvent: { findFirst: vi.fn() } };

		await expect(new PrismaConversationAssetOutputRepository(transaction as never).reserve(_IDENTITY, _COMMAND)).resolves.toEqual({ outcome: "denied", reason: "runtime_unavailable" });
		expect(transaction.conversationRunEvent.findFirst).not.toHaveBeenCalled();
	});

	it("does not let an earlier attempt's message event authorize current-attempt output", async function _RejectsEarlierAttemptEvent()
	{
		const findFirst = vi.fn().mockImplementation(async function _FindEvent({ where }: { readonly where: { readonly attempt: number } })
		{
			return where.attempt === 1 ? _MessageEvent() : null;
		});
		const transaction = {
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(_Assignment()) }, warmRuntimeReservation: { findUnique: vi.fn().mockResolvedValue(_Reservation()) },
			conversationRunEvent: { findFirst },
		};

		await expect(new PrismaConversationAssetOutputRepository(transaction as never).reserve(_IDENTITY, _COMMAND)).resolves.toEqual({ outcome: "denied", reason: "runtime_unavailable" });
		expect(findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({ runId: "run-1", attempt: 2, messageId: "message-1" }), select: { sequence: true, payload: true } });
	});

	it("enforces the approved 200 MiB total across all outputs for one message", async function _LimitsMessageTotal()
	{
		const transaction = {
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(_Assignment()) }, warmRuntimeReservation: { findUnique: vi.fn().mockResolvedValue(_Reservation()) },
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
		const transaction = { workloadAssignment: { findUnique: vi.fn().mockResolvedValue(_Assignment()) }, warmRuntimeReservation: { findUnique: vi.fn().mockResolvedValue(_Reservation()) }, conversationRunEvent: { findFirst: vi.fn().mockResolvedValue(_MessageEvent()) }, conversationAssetOutputTicket: { findUnique: vi.fn().mockResolvedValue(existing) } };
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
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(_Assignment()) }, warmRuntimeReservation: { findUnique: vi.fn().mockResolvedValue(_Reservation()) },
			artifactUploadLease: { findUnique: vi.fn().mockResolvedValue({ id: "lease-1", state: ArtifactUploadLeaseState.Active, expiresAt: new Date(Date.now() + 60_000), expectedContentAddress: _ADDRESS, expectedByteLength: 5n, mediaType: "application/pdf" }), update: vi.fn() },
			artifactRevision: { create: vi.fn() }, artifactScanJob: { create: vi.fn() },
			conversationAsset: { update: vi.fn().mockResolvedValue(_Asset({ revisionId: "revision-new", state: ConversationAssetState.Processing })) },
			conversation: { findUnique: vi.fn().mockResolvedValue({ lifecycle: "Open" }) },
			conversationTimelineEntry: { create: vi.fn() },
		};
		const promotion = { leaseId: "lease-1", contentAddress: _ADDRESS, byteLength: 5, mediaType: "application/pdf", issuedAtEpochSeconds: 1 };
		const result = await new PrismaConversationAssetOutputRepository(transaction as never).finalize(_IDENTITY, "ticket-1", promotion, `sha256:${"c".repeat(64)}`);

		expect(result).toEqual({ outcome: "accepted" });
		expect(transaction.artifactRevision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ state: ArtifactRevisionState.Quarantined, sourceRunId: "run-1", sourceMessageId: "message-1", provenance: expect.objectContaining({ kind: "conversation_agent_output", outputTicketId: "ticket-1", runEventSequence: 7 }), createdBy: "principal-1" }) });
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
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(_Assignment()) }, warmRuntimeReservation: { findUnique: vi.fn().mockResolvedValue(_Reservation()) }
		};
		const finalizeTransaction = { conversationAssetOutputTicket: { findUnique: vi.fn().mockResolvedValue({ id: "ticket-1", runId: "run-1", runAttempt: 2, expiresAt: new Date(Date.now() + 60_000), finalizedAt: null, asset }) }, workloadAssignment: { findUnique: vi.fn().mockResolvedValue(null) }, warmRuntimeReservation: { findUnique: vi.fn().mockResolvedValue(null) }, artifactRevision: { create: vi.fn() }, artifactScanJob: { create: vi.fn() } };
		const prisma = { $transaction: vi.fn().mockImplementationOnce(async function _Read(work: (value: unknown) => unknown) { return work(targetTransaction); }).mockImplementationOnce(async function _Finalize(work: (value: unknown) => unknown) { return work(finalizeTransaction); }) };
		const service = { promote: vi.fn().mockResolvedValue({ receipt: "receipt" }) };
		const crypto = { signLease: vi.fn().mockReturnValue("signed"), verifyReceipt: vi.fn().mockReturnValue({ leaseId: "lease-1", contentAddress: _ADDRESS, byteLength: 5, mediaType: "application/pdf", issuedAtEpochSeconds: 1 }), digestReceipt: vi.fn().mockReturnValue("digest") };

		const result = await new PrismaConversationAssetOutputUnitOfWork(prisma as never, service, crypto).publish(_IDENTITY, "ticket-1", (async function* _Bytes() { yield new Uint8Array([1]); })());

		expect(service.promote).toHaveBeenCalledOnce();
		expect(result).toEqual({ outcome: "denied", reason: "runtime_unavailable" });
		expect(finalizeTransaction.artifactRevision.create).not.toHaveBeenCalled();
		expect(finalizeTransaction.artifactScanJob.create).not.toHaveBeenCalled();
	});

	it("moves a processing output to ready and appends one payload-free invalidation", async function _ReportsReady()
	{
		const transaction = {
			conversationAsset: { findFirst: vi.fn().mockResolvedValue({ id: "asset-1", conversationId: "conversation-1" }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			conversation: { findUnique: vi.fn().mockResolvedValue({ lifecycle: ConversationLifecycle.Open }) },
			conversationTimelineEntry: { create: vi.fn() },
		};
		await new PrismaConversationAssetOutputRepository(transaction as never).report({ revisionId: "revision-1", state: ConversationAssetScanLifecycleStates.Ready, failureCode: null });

		expect(transaction.conversationAsset.updateMany).toHaveBeenCalledWith({ where: { id: "asset-1", revisionId: "revision-1", state: ConversationAssetState.Processing }, data: { state: ConversationAssetState.Ready, failureCode: null } });
		expect(transaction.conversationTimelineEntry.create).toHaveBeenCalledWith({ data: { conversationId: "conversation-1", kind: ConversationTimelineEntryKind.System, systemEventId: "conversation-asset:asset-1:ready", payload: { eventType: "conversation.assets.changed" } } });
	});

	it("commits a terminal output after closure without appending a visible position", async function _ReportsClosed()
	{
		const transaction = {
			conversationAsset: { findFirst: vi.fn().mockResolvedValue({ id: "asset-1", conversationId: "conversation-1" }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			conversation: { findUnique: vi.fn().mockResolvedValue({ lifecycle: ConversationLifecycle.Closed }) },
			conversationTimelineEntry: { create: vi.fn() },
		};
		await new PrismaConversationAssetOutputRepository(transaction as never).report({ revisionId: "revision-1", state: ConversationAssetScanLifecycleStates.Failed, failureCode: "unsafe_file" });

		expect(transaction.conversationAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { state: ConversationAssetState.Failed, failureCode: "unsafe_file" } }));
		expect(transaction.conversationTimelineEntry.create).not.toHaveBeenCalled();
	});

	it("refuses generated output work when no scanner can consume quarantine", async function _ScannerUnavailable()
	{
		const prisma = { $transaction: vi.fn() };
		const service = { promote: vi.fn() };
		const authority = new PrismaConversationAssetOutputUnitOfWork(prisma as never, service, {} as never, false);

		await expect(authority.reserve(_IDENTITY, _COMMAND)).resolves.toEqual({ outcome: "denied", reason: "scanner_unavailable" });
		await expect(authority.publish(_IDENTITY, "ticket-1", (async function* _Bytes() { yield new Uint8Array([1]); })())).resolves.toEqual({ outcome: "denied", reason: "scanner_unavailable" });
		expect(prisma.$transaction).not.toHaveBeenCalled();
		expect(service.promote).not.toHaveBeenCalled();
	});
});
