import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { ArtifactKind, ArtifactRevisionState, ArtifactScanJobState, ArtifactState, ArtifactUploadLeaseState, ConversationAssetProvenance, ConversationAssetState, type Prisma } from "@prisma/client";
import { ArtifactQuarantineOutcomes } from "@opencrane/backend/server/agents/artifacts";
import type { ConversationPrivatePayloadCipher, ConversationPrivatePayloadCoordinates, EncryptedConversationPrivatePayload } from "@opencrane/backend/server/conversations/history";
import type { ConversationToolDispatchAdmission } from "@opencrane/backend/server/conversations";
import { ToolInvocationStates, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import type { IWorkflowEngine, IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import { GENERATED_CSV_MEDIA_TYPE } from "@opencrane/models/conversation-assets";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { __SealGeneratedFile } from "../../../custody/file-custody";
import { GeneratedFileQuarantineOutcomes, GeneratedFileWorkflowStates, type GeneratedFilePromotionReceipt } from "../../../workflow/generated-file-workflow.types";
import type { GeneratedFilePromotionAuthorityCommand } from "../../../promotion/generated-file-promotion.types";
import { CONVERSATION_GENERATED_FILE_TASK } from "../../conversation-generated-file-task";
import { CONVERSATION_GENERATED_FILE_SYSTEM_ACTOR, GeneratedFileWorkflowFailureCodes, type GeneratedFileWorkflowPersistenceDependencies } from "../generated-file-workflow-persistence.types";
import { PrismaConversationGeneratedFileWorkflowRepository } from "../prisma-conversation-generated-file-workflow-repository";

const _NOW = new Date("2026-09-13T12:00:00.000Z");
const _CONTENT = Buffer.from("County,Total\r\nNairobi,42\r\n", "utf8");
const _TASK: IWorkflowTaskReceipt = { taskId: "generated-task-1", taskName: CONVERSATION_GENERATED_FILE_TASK.taskName, idempotencyKey: "generated-key-1" };
const _RECEIPT: GeneratedFilePromotionReceipt = { leaseId: "upload-lease-1", contentAddress: _Digest(_CONTENT), byteLength: _CONTENT.byteLength, mediaType: GENERATED_CSV_MEDIA_TYPE, receiptDigest: `sha256:${"f".repeat(64)}` };

/** Reversible cipher that retains the custody codec's authenticated coordinate checks. */
function _Cipher(): ConversationPrivatePayloadCipher
{
	return {
		encrypt(plaintext: string, _coordinates: ConversationPrivatePayloadCoordinates): EncryptedConversationPrivatePayload
		{
			const ciphertext = Buffer.from(plaintext, "utf8");
			return { keyId: "key-1", nonce: Buffer.alloc(12, 1), authTag: Buffer.alloc(16, 2), ciphertext, ciphertextDigest: _Digest(ciphertext) };
		},
		decrypt(payload: EncryptedConversationPrivatePayload, _coordinates: ConversationPrivatePayloadCoordinates): string
		{
			return Buffer.from(payload.ciphertext).toString("utf8");
		},
	};
}

/** Build current proxied execution evidence shaped by the conversations owner. */
function _Admission(): ConversationToolDispatchAdmission
{
	return {
		conversationId: "conversation-1", requesterSubjectId: "subject-1", notAfterEpochMs: _NOW.getTime() + 300_000,
		identity: { id: "agent-identity-1", kind: "proxied", proxiedPrincipalId: "principal-1" },
		subject: {
			siloId: "silo-1", agentIdentityId: "agent-identity-1", requester: { requesterPrincipalId: "principal-1" },
			runScope: { runId: "run-1", attempt: 2 }, computerScope: { computerId: "computer-1", leaseId: "computer-lease-1", leaseGeneration: 3 },
		},
	} as unknown as ConversationToolDispatchAdmission;
}

/** Authorization-owned completed invocation matched to the immutable capture operation. */
function _Invocation(): ToolInvocationRecord
{
	return { id: "invocation-row-1", siloId: "silo-1", runId: "run-1", attempt: 2, toolInvocationId: "tool-call-1", toolRevisionId: "tool-revision-1", state: ToolInvocationStates.Succeeded } as ToolInvocationRecord;
}

/** Mutable Prisma-shaped transaction used to prove ordering and durable recovery semantics. */
function _Harness()
{
	const cipher = _Cipher();
	const sealed = __SealGeneratedFile(cipher, { siloId: "silo-1", conversationId: "conversation-1", agentIdentityId: "agent-identity-1", requesterPrincipalId: "principal-1", requesterSubjectId: "subject-1", operationId: "operation-1", bytes: _CONTENT });
	const artifact = { id: "artifact-1", siloId: "silo-1", ownerPrincipalId: "principal-1", kind: ArtifactKind.Generated, state: ArtifactState.Active, currentRevisionId: null as string | null, retentionPolicy: "until_authorized_deletion", createdAt: _NOW, updatedAt: _NOW, deletedAt: null };
	const lease = { id: "upload-lease-1", artifactId: "artifact-1", siloId: "silo-1", capabilityJti: "capability-1", expectedContentAddress: sealed.manifest.contentAddress, expectedByteLength: BigInt(_CONTENT.byteLength), mediaType: GENERATED_CSV_MEDIA_TYPE, state: ArtifactUploadLeaseState.Active as ArtifactUploadLeaseState, expiresAt: new Date(_NOW.getTime() + 240_000), promotionReceiptDigest: null as string | null, promotedContentAddress: null as string | null, promotedByteLength: null as bigint | null, promotedAt: null as Date | null, finalizedAt: null as Date | null, createdAt: _NOW };
	const asset = { id: "asset-1", siloId: "silo-1", conversationId: "conversation-1", messageId: null as string | null, artifactId: "artifact-1", revisionId: null as string | null, uploadLeaseId: lease.id, idempotencyKey: "operation-1", provenance: ConversationAssetProvenance.AgentOutput, state: ConversationAssetState.Uploading as ConversationAssetState, displayName: "county-totals.csv", mediaType: GENERATED_CSV_MEDIA_TYPE, byteLength: BigInt(_CONTENT.byteLength), failureCode: null as string | null, createdByUserId: "subject-1", createdAt: _NOW, updatedAt: _NOW, removedAt: null };
	let revision: Record<string, unknown> | null = null;
	const operation = { id: "operation-1", siloId: "silo-1", conversationId: "conversation-1", runId: "run-1", attempt: 2, bootstrapId: "bootstrap-1", computerId: "computer-1", leaseId: "computer-lease-1", leaseGeneration: 3, agentIdentityId: "agent-identity-1", requesterPrincipalId: "principal-1", requesterSubject: "subject-1", toolInvocationRowId: "invocation-row-1", toolInvocationId: "tool-call-1", toolRevisionId: "tool-revision-1", serverRevisionId: "server-revision-1", rawResultDigest: `sha256:${"e".repeat(64)}`, custodyManifestVersion: sealed.manifest.version, ciphertextManifestDigest: sealed.manifest.ciphertextManifestDigest, assetId: asset.id, artifactId: artifact.id, revisionId: "artifact-revision-1", uploadLeaseId: lease.id, contentAddress: sealed.manifest.contentAddress, byteLength: BigInt(_CONTENT.byteLength), chunkCount: sealed.manifest.chunkCount, displayName: asset.displayName, mediaType: asset.mediaType, workflowTaskId: _TASK.taskId, workflowTaskName: _TASK.taskName, workflowTaskKey: _TASK.idempotencyKey, createdAt: _NOW };
	const payloads = new Map(sealed.chunks.map(function _Payload(chunk)
	{
		return [chunk.payloadRef, { id: chunk.payloadRef, siloId: chunk.coordinates.siloId, conversationId: chunk.coordinates.conversationId, authorSubject: chunk.coordinates.authorSubject, idempotencyKey: chunk.idempotencyKey, keyId: chunk.payload.keyId, nonce: Buffer.from(chunk.payload.nonce), authTag: Buffer.from(chunk.payload.authTag), ciphertext: Buffer.from(chunk.payload.ciphertext), ciphertextDigest: chunk.payload.ciphertextDigest }];
	}));
	const events: string[] = [];
	const transaction = {
		conversationGeneratedFile: { findFirst: vi.fn(async function _Find() { return { ...operation, asset: { ...asset, artifact: { ...artifact }, uploadLease: { ...lease } }, chunks: sealed.manifest.chunks }; }) },
		artifactRevision: { findUnique: vi.fn(async function _Find() { return revision; }) },
		conversationPrivatePayload: { findMany: vi.fn(async function _Find() { return [...payloads.values()]; }) },
		conversationAsset: { updateMany: vi.fn(async function _Update(input: { readonly where: { readonly state: unknown }; readonly data: { readonly state: ConversationAssetState; readonly revisionId?: string; readonly failureCode?: string } })
		{
			const expected = input.where.state;
			const allowed = typeof expected === "object" && expected !== null && "in" in expected ? (expected as { readonly in: readonly ConversationAssetState[] }).in : [expected];
			if (!allowed.includes(asset.state))
				return { count: 0 };
			asset.state = input.data.state;
			if (input.data.revisionId !== undefined)
				asset.revisionId = input.data.revisionId;
			if (input.data.failureCode !== undefined)
				asset.failureCode = input.data.failureCode;
			events.push(`asset:${input.data.state}`);
			return { count: 1 };
		}) },
	};
	const invocation = { findById: vi.fn(async function _Find() { return _Invocation(); }) };
	let admission: ConversationToolDispatchAdmission | null = _Admission();
	const admitSystem = vi.fn(async function _Admit() { return admission; });
	const emitGenerated = vi.fn(async function _Emit() { events.push("generated-event"); return { task: _TASK, eventName: "generated" }; });
	const emitParent = vi.fn(async function _Emit() { events.push("parent-event"); });
	const quarantine = vi.fn(async function _Finalize()
	{
		lease.state = ArtifactUploadLeaseState.Finalized;
		lease.promotionReceiptDigest = _RECEIPT.receiptDigest;
		lease.promotedContentAddress = _RECEIPT.contentAddress;
		lease.promotedByteLength = BigInt(_RECEIPT.byteLength);
		lease.promotedAt = _NOW;
		lease.finalizedAt = _NOW;
		revision = { id: operation.revisionId, artifactId: artifact.id, revision: 1, state: ArtifactRevisionState.Quarantined, contentAddress: operation.contentAddress, byteLength: operation.byteLength, mediaType: operation.mediaType, provenance: { kind: "conversation_generated_file", operationId: operation.id }, sourceRunId: null, sourceMessageId: null, indexState: "pending", cogneeExternalId: null, createdBy: operation.requesterSubject, createdAt: _NOW, deletionRequestedAt: null, purgedAt: null, scanJob: { state: ArtifactScanJobState.Pending } };
		events.push("quarantine");
		return ArtifactQuarantineOutcomes.Accepted;
	});
	const dependencies: GeneratedFileWorkflowPersistenceDependencies = {
		artifactQuarantine: function _Artifacts() { return { finalize: quarantine }; },
		conversationAdmission: function _Conversations() { return { admitSystem }; },
		custodyCipher: cipher,
		toolInvocations: { __ForTransaction: function _InvocationParticipant() { return invocation as never; } },
		turnEvents: function _Turns() { return { emit: emitParent }; },
		workflows: { emitEventInTransaction: emitGenerated } as unknown as Pick<IWorkflowEngine, "emitEventInTransaction">,
	};
	const repository = new PrismaConversationGeneratedFileWorkflowRepository(transaction as unknown as Prisma.TransactionClient, dependencies);
	return { admitSystem, asset, dependencies, emitGenerated, emitParent, events, invocation, lease, operation, quarantine, repository, setAdmission(value: ConversationToolDispatchAdmission | null) { admission = value; }, setAuthorityEndedScan(revisionState: ArtifactRevisionState, scanState: ArtifactScanJobState)
	{
		lease.state = ArtifactUploadLeaseState.Finalized;
		lease.promotionReceiptDigest = _RECEIPT.receiptDigest;
		lease.promotedContentAddress = _RECEIPT.contentAddress;
		lease.promotedByteLength = BigInt(_RECEIPT.byteLength);
		lease.promotedAt = _NOW;
		lease.finalizedAt = _NOW;
		asset.state = ConversationAssetState.Failed;
		asset.revisionId = operation.revisionId;
		asset.failureCode = GeneratedFileWorkflowFailureCodes.AuthorityEnded;
		revision = { id: operation.revisionId, artifactId: artifact.id, revision: 1, state: revisionState, contentAddress: operation.contentAddress, byteLength: operation.byteLength, mediaType: operation.mediaType, provenance: { kind: "conversation_generated_file", operationId: operation.id }, createdBy: operation.requesterSubject, scanJob: { state: scanState } };
	}, setReady()
	{
		lease.state = ArtifactUploadLeaseState.Finalized;
		lease.promotionReceiptDigest = _RECEIPT.receiptDigest;
		lease.promotedContentAddress = _RECEIPT.contentAddress;
		lease.promotedByteLength = BigInt(_RECEIPT.byteLength);
		lease.promotedAt = _NOW;
		lease.finalizedAt = _NOW;
		asset.state = ConversationAssetState.Ready;
		asset.revisionId = operation.revisionId;
		artifact.currentRevisionId = operation.revisionId;
		revision = { id: operation.revisionId, artifactId: artifact.id, revision: 1, state: ArtifactRevisionState.Published, contentAddress: operation.contentAddress, byteLength: operation.byteLength, mediaType: operation.mediaType, provenance: { kind: "conversation_generated_file", operationId: operation.id }, createdBy: operation.requesterSubject, scanJob: { state: ArtifactScanJobState.Clean } };
	} };
}

describe("PrismaConversationGeneratedFileWorkflowRepository", function _Suite()
{
	beforeEach(function _Clock()
	{
		vi.useFakeTimers();
		vi.setSystemTime(_NOW);
	});

	it("loads one promotion snapshot through the IAM invocation and server workload authorities", async function _LoadsCurrent()
	{
		const harness = _Harness();
		const snapshot = await harness.repository.loadCurrent({ siloId: "silo-1", operationId: "operation-1" }, _TASK, _NOW);

		expect(snapshot).toEqual(expect.objectContaining({ state: GeneratedFileWorkflowStates.PromotionRequired, operationId: "operation-1", notAfterEpochMs: _NOW.getTime() + 240_000 }));
		expect(harness.invocation.findById).toHaveBeenCalledExactlyOnceWith("invocation-row-1");
		expect(harness.admitSystem).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ state: ToolInvocationStates.Succeeded }), _NOW, CONVERSATION_GENERATED_FILE_SYSTEM_ACTOR);
	});

	it("durably fails unfinished work and emits both wakes when current execution authority ended", async function _FailsEndedAuthority()
	{
		const harness = _Harness();
		harness.setAdmission(null);

		await expect(harness.repository.loadCurrent({ siloId: "silo-1", operationId: "operation-1" }, _TASK, _NOW)).resolves.toBeNull();
		expect(harness.asset).toEqual(expect.objectContaining({ state: ConversationAssetState.Failed, failureCode: GeneratedFileWorkflowFailureCodes.AuthorityEnded }));
		expect(harness.events).toEqual(["asset:Failed", "generated-event", "parent-event"]);
		expect(harness.emitGenerated).toHaveBeenCalledWith(expect.objectContaining({ client: expect.anything() }), _TASK, expect.objectContaining({ payload: { operationId: "operation-1", state: GeneratedFileWorkflowStates.Failed } }));
		expect(harness.emitParent).toHaveBeenCalledWith("run-1", 2, expect.objectContaining({ payload: { operationId: "operation-1", state: GeneratedFileWorkflowStates.Failed } }));
		await expect(harness.repository.loadCurrent({ siloId: "silo-1", operationId: "operation-1" }, _TASK, _NOW)).resolves.toEqual(expect.objectContaining({ state: GeneratedFileWorkflowStates.Failed }));
		expect(harness.admitSystem).toHaveBeenCalledOnce();
	});

	it("opens exact encrypted custody only after task and current-authority checks", async function _OpensCustody()
	{
		const harness = _Harness();
		const snapshot = await harness.repository.loadCurrent({ siloId: "silo-1", operationId: "operation-1" }, _TASK, _NOW);
		if (snapshot === null)
			throw new Error("expected a current generated file");

		await expect(harness.repository.openVerifiedBytes(snapshot, _TASK, _NOW)).resolves.toEqual(new Uint8Array(_CONTENT));
		await expect(harness.repository.openVerifiedBytes(snapshot, { ..._TASK, taskId: "foreign-task" }, _NOW)).rejects.toThrow("task receipt conflicted");
	});

	it("orders quarantine before the asset transition and accepts an exact recovered receipt", async function _FinalizesQuarantine()
	{
		const harness = _Harness();
		const snapshot = await harness.repository.loadCurrent({ siloId: "silo-1", operationId: "operation-1" }, _TASK, _NOW);
		if (snapshot === null)
			throw new Error("expected a current generated file");

		await expect(harness.repository.finalizeQuarantine(snapshot, _TASK, _RECEIPT, _NOW)).resolves.toBe(GeneratedFileQuarantineOutcomes.Advanced);
		expect(harness.events).toEqual(["quarantine", "asset:Processing"]);
		expect(harness.asset).toEqual(expect.objectContaining({ state: ConversationAssetState.Processing, revisionId: "artifact-revision-1" }));
		await expect(harness.repository.finalizeQuarantine(snapshot, _TASK, _RECEIPT, _NOW)).resolves.toBe(GeneratedFileQuarantineOutcomes.Idempotent);
		expect(harness.quarantine).toHaveBeenCalledOnce();
	});

	it("fails a quarantined asset and wakes both tasks when authority ends before scanning", async function _FailsPendingScan()
	{
		const harness = _Harness();
		const snapshot = await harness.repository.loadCurrent({ siloId: "silo-1", operationId: "operation-1" }, _TASK, _NOW);
		if (snapshot === null)
			throw new Error("expected a current generated file");
		await harness.repository.finalizeQuarantine(snapshot, _TASK, _RECEIPT, _NOW);
		harness.setAdmission({ ..._Admission(), requesterSubjectId: "foreign-subject" });

		await expect(harness.repository.loadCurrent({ siloId: "silo-1", operationId: "operation-1" }, _TASK, _NOW)).resolves.toBeNull();
		expect(harness.asset).toEqual(expect.objectContaining({ state: ConversationAssetState.Failed, failureCode: GeneratedFileWorkflowFailureCodes.AuthorityEnded, revisionId: "artifact-revision-1" }));
		expect(harness.events).toEqual(["quarantine", "asset:Processing", "asset:Failed", "generated-event", "parent-event"]);
	});

	it("returns the exact fixed lease and wakes both tasks for a scanner-owned terminal state", async function _PromotionAndTerminal()
	{
		const harness = _Harness();
		const snapshot = await harness.repository.loadCurrent({ siloId: "silo-1", operationId: "operation-1" }, _TASK, _NOW);
		if (snapshot === null)
			throw new Error("expected a current generated file");
		const command: GeneratedFilePromotionAuthorityCommand = {
			siloId: snapshot.siloId, operationId: snapshot.operationId, artifactId: snapshot.artifactId,
			artifactRevisionId: snapshot.artifactRevisionId, uploadLeaseId: snapshot.uploadLeaseId,
			contentAddress: snapshot.contentAddress, byteLength: snapshot.byteLength, mediaType: snapshot.mediaType,
			notAfterEpochMs: snapshot.notAfterEpochMs,
		};

		await expect(harness.repository.admitCurrent(command, _NOW)).resolves.toEqual({ lease: expect.objectContaining({ leaseId: "upload-lease-1", action: "artifact.write", expectedByteLength: _CONTENT.byteLength }), notAfterEpochMs: snapshot.notAfterEpochMs });
		harness.setReady();
		await harness.repository.emitTerminal("operation-1");
		expect(harness.events).toEqual(["generated-event", "parent-event"]);
	});

	it("keeps a Ready workflow valid after its exact conversation message link", async function _LinkedReady()
	{
		const harness = _Harness();
		harness.setReady();
		harness.asset.messageId = "11111111-1111-4111-8111-111111111111";

		await expect(harness.repository.loadCurrent({ siloId: "silo-1", operationId: "operation-1" }, _TASK, _NOW)).resolves.toEqual(expect.objectContaining({ state: GeneratedFileWorkflowStates.Ready }));
		expect(harness.admitSystem).not.toHaveBeenCalled();
	});

	it("rejects a message link before the generated file is Ready", async function _EarlyLink()
	{
		const harness = _Harness();
		harness.asset.messageId = "11111111-1111-4111-8111-111111111111";

		await expect(harness.repository.loadCurrent({ siloId: "silo-1", operationId: "operation-1" }, _TASK, _NOW)).rejects.toThrow("Uploading state is invalid");
	});

	it.each([
		[ArtifactRevisionState.Quarantined, ArtifactScanJobState.Clean],
		[ArtifactRevisionState.Rejected, ArtifactScanJobState.Rejected],
	])("recovers the first authority-ended failure after scanner settlement %#", async function _AuthorityEndedScan(revisionState, scanState)
	{
		const harness = _Harness();
		harness.setAuthorityEndedScan(revisionState, scanState);

		await expect(harness.repository.loadCurrent({ siloId: "silo-1", operationId: "operation-1" }, _TASK, _NOW)).resolves.toEqual(expect.objectContaining({ state: GeneratedFileWorkflowStates.Failed }));
		expect(harness.admitSystem).not.toHaveBeenCalled();
	});

	it("rejects a published revision behind an authority-ended failure", async function _RejectsPublishedAuthorityFailure()
	{
		const harness = _Harness();
		harness.setAuthorityEndedScan(ArtifactRevisionState.Published, ArtifactScanJobState.Clean);

		await expect(harness.repository.loadCurrent({ siloId: "silo-1", operationId: "operation-1" }, _TASK, _NOW)).rejects.toThrow("Generated file Failed state is invalid");
	});
});

/** Compute the lowercase SHA-256 address used by custody and Artifact receipts. */
function _Digest(value: Uint8Array): string
{
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
