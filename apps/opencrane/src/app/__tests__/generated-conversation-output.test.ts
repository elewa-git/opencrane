import { ArtifactRevisionState, ArtifactScanJobState, ArtifactUploadLeaseState, ConversationAssetProvenance, ConversationAssetState, ConversationLifecycle, WorkloadAssignmentState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaArtifactScanUnitOfWork } from "@opencrane/backend/server/agents/artifacts";
import { PrismaConversationAssetOutputRepository, PrismaConversationAssetOutputUnitOfWork } from "@opencrane/backend/server/conversation-assets";
import { ArtifactScannerVerdict } from "@opencrane/contracts";

const _NOW = new Date("2026-08-11T10:00:00.000Z");
const _CONTENT = new Uint8Array([137, 80, 78, 71]);
const _CONTENT_ADDRESS = `sha256:${"a".repeat(64)}`;
const _IDENTITY = { namespace: "runtime-ns", serviceAccountName: "agent-runtime-default", podUid: "pod-1" } as const;

/** Mutable in-memory rows shared by the production output and scanner units of work. */
function _Database()
{
	const journey: string[] = [];
	let ticket: Record<string, unknown> | null = null;
	let lease: Record<string, unknown> | null = null;
	let asset: Record<string, unknown> | null = null;
	let revision: Record<string, unknown> | null = null;
	let scanJob: Record<string, unknown> | null = null;
	const assignment = { runId: "run-1", attempt: 2, siloId: "silo-1", subjectId: "user-1", namespace: _IDENTITY.namespace, serviceAccountName: _IDENTITY.serviceAccountName, podUid: _IDENTITY.podUid, state: WorkloadAssignmentState.Registered, expiresAt: new Date("2030-01-01T00:00:00.000Z"), run: { id: "run-1", attempt: 2, conversationId: "conversation-1" } };

	function _TicketWithAsset(): Record<string, unknown> | null
	{
		return ticket === null || asset === null ? null : { ...ticket, asset: { ...asset, uploadLease: lease } };
	}

	const transaction = {
		artifactAuthorityClock: { findUnique: vi.fn().mockImplementation(async function _Clock() { return { now: _NOW }; }) },
		principal: { findMany: vi.fn().mockResolvedValue([{ id: "principal-1" }]) },
		workloadAssignment: { findFirst: vi.fn().mockResolvedValue(assignment) },
		conversationRunEvent: { findFirst: vi.fn().mockResolvedValue({ sequence: 7, payload: { messageId: "assistant:command-1", role: "assistant" } }) },
		conversationAssetOutputTicket: {
			findUnique: vi.fn().mockImplementation(async function _FindTicket(args: { readonly where: Record<string, unknown> }) { return Object.hasOwn(args.where, "id") ? _TicketWithAsset() : null; }),
			create: vi.fn().mockImplementation(async function _CreateTicket(args: { readonly data: Record<string, unknown> }) { ticket = { ...args.data, finalizedAt: null }; journey.push("reserve"); return ticket; }),
			update: vi.fn().mockImplementation(async function _FinalizeTicket(args: { readonly data: Record<string, unknown> }) { ticket = { ...ticket, ...args.data }; return ticket; }),
		},
		artifact: {
			create: vi.fn(),
			update: vi.fn().mockImplementation(async function _PublishArtifact(args: { readonly data: Record<string, unknown> }) { journey.push("scan"); return args.data; }),
		},
		artifactUploadLease: {
			create: vi.fn().mockImplementation(async function _CreateLease(args: { readonly data: Record<string, unknown> }) { lease = { ...args.data, state: ArtifactUploadLeaseState.Active }; return lease; }),
			findUnique: vi.fn().mockImplementation(async function _FindLease() { return lease; }),
			update: vi.fn().mockImplementation(async function _FinalizeLease(args: { readonly data: Record<string, unknown> }) { lease = { ...lease, ...args.data }; return lease; }),
		},
		conversationAsset: {
			findMany: vi.fn().mockResolvedValue([]),
			create: vi.fn().mockImplementation(async function _CreateAsset(args: { readonly data: Record<string, unknown> }) { asset = { ...args.data, createdAt: _NOW, failureCode: null }; return asset; }),
			findFirst: vi.fn().mockImplementation(async function _FindAsset() { return asset?.["state"] === ConversationAssetState.Processing ? { id: asset["id"], conversationId: asset["conversationId"] } : null; }),
			update: vi.fn().mockImplementation(async function _UpdateAsset(args: { readonly data: Record<string, unknown> }) { asset = { ...asset, ...args.data }; return asset; }),
			updateMany: vi.fn().mockImplementation(async function _ReadyAsset(args: { readonly data: Record<string, unknown> }) { if (asset?.["state"] !== ConversationAssetState.Processing) return { count: 0 }; asset = { ...asset, ...args.data }; journey.push("ready"); return { count: 1 }; }),
		},
		artifactRevision: {
			create: vi.fn().mockImplementation(async function _CreateRevision(args: { readonly data: Record<string, unknown> }) { revision = { ...args.data }; journey.push("quarantine"); return revision; }),
			update: vi.fn().mockImplementation(async function _PublishRevision(args: { readonly data: Record<string, unknown> }) { revision = { ...revision, ...args.data }; return revision; }),
		},
		artifactScanJob: {
			create: vi.fn().mockImplementation(async function _CreateScanJob(args: { readonly data: Record<string, unknown> }) { scanJob = { id: "scan-job-1", ...args.data, state: ArtifactScanJobState.Pending, attempt: 0, createdAt: _NOW }; return scanJob; }),
			findFirst: vi.fn().mockImplementation(async function _FindPendingJob() { return scanJob === null || revision === null ? null : { ...scanJob, artifactRevision: revision }; }),
			findUnique: vi.fn().mockImplementation(async function _FindClaimedJob() { return scanJob === null || revision === null ? null : { ...scanJob, artifactRevision: revision }; }),
			updateMany: vi.fn().mockImplementation(async function _ClaimJob(args: { readonly data: Record<string, unknown> }) { scanJob = { ...scanJob, ...args.data }; return { count: 1 }; }),
			update: vi.fn().mockImplementation(async function _CompleteJob(args: { readonly data: Record<string, unknown> }) { scanJob = { ...scanJob, ...args.data }; return scanJob; }),
		},
		conversation: { findUnique: vi.fn().mockResolvedValue({ lifecycle: ConversationLifecycle.Open }) },
		conversationTimelineEntry: { create: vi.fn() },
		artifactOutboxEvent: { create: vi.fn() },
		artifactPreprocessJob: { create: vi.fn() },
	};
	const prisma = { $transaction: vi.fn().mockImplementation(async function _Transaction(work: (value: unknown) => unknown) { return work(transaction); }) };
	return { journey, prisma, state: function _State() { return { asset, revision, scanJob }; } };
}

describe("generated conversation output journey", function _Suite()
{
	it("takes exact runtime bytes through reserve, promotion, quarantine, clean scan, and Ready", async function _GeneratedOutputJourney()
	{
		const database = _Database();
		const service = { promote: vi.fn().mockImplementation(async function _Put(_lease: string, bytes: AsyncIterable<Uint8Array>) { const received: number[] = []; for await (const chunk of bytes) received.push(...chunk); expect(received).toEqual([..._CONTENT]); database.journey.push("put"); return { receipt: "signed-receipt" }; }) };
		let leaseId = "";
		const crypto = { signLease: vi.fn().mockImplementation(function _SignLease(lease: { readonly leaseId: string }) { leaseId = lease.leaseId; return "signed-write-lease"; }), verifyReceipt: vi.fn().mockImplementation(function _VerifyReceipt() { return { leaseId, contentAddress: _CONTENT_ADDRESS, byteLength: _CONTENT.byteLength, mediaType: "image/png", issuedAtEpochSeconds: 1 }; }), digestReceipt: vi.fn().mockReturnValue("sha256:receipt") };
		const outputs = new PrismaConversationAssetOutputUnitOfWork(database.prisma as never, service, crypto);

		const reservation = await outputs.reserve(_IDENTITY, { runId: "run-1", runAttempt: 2, messageId: "assistant:command-1", idempotencyKey: "model-file:0:digest", displayName: "generated-1.png", mediaType: "image/png", byteLength: _CONTENT.byteLength, contentAddress: _CONTENT_ADDRESS });
		expect(reservation).toEqual({ outcome: "issued", ticketId: expect.any(String) });
		if (reservation.outcome === "denied") throw new Error("test reservation was denied");
		await expect(outputs.publish(_IDENTITY, reservation.ticketId, (async function* _Bytes() { yield _CONTENT; })())).resolves.toEqual({ outcome: "accepted" });

		const scanner = new PrismaArtifactScanUnitOfWork(database.prisma as never, 300_000, function _ConversationAssets(transaction) { return new PrismaConversationAssetOutputRepository(transaction); });
		const claim = await scanner.claim();
		expect(claim).not.toBeNull();
		await expect(scanner.complete({ jobId: claim!.lease.jobId, attempt: claim!.lease.attempt, claimFence: claim!.lease.claimFence, verdict: ArtifactScannerVerdict.Clean, scannerVersion: "clamav-pinned" })).resolves.toBe("completed");

		expect(database.journey).toEqual(["reserve", "put", "quarantine", "scan", "ready"]);
		expect(database.state().asset).toMatchObject({ provenance: ConversationAssetProvenance.AgentOutput, state: ConversationAssetState.Ready, revisionId: expect.any(String), failureCode: null });
		expect(database.state().revision).toMatchObject({ state: ArtifactRevisionState.Published, sourceRunId: "run-1", sourceMessageId: "assistant:command-1" });
	});
});
