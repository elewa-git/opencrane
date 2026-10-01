import { ArtifactKind, ArtifactRevisionState, ArtifactScanJobState, ArtifactState, ArtifactUploadLeaseState, ConversationAssetProvenance, ConversationAssetState, type Prisma } from "@prisma/client";

import { ___IsSha256ContentAddress } from "@opencrane/models/artifacts";
import { GENERATED_CSV_LIMITS, GENERATED_CSV_MEDIA_TYPE } from "@opencrane/models/conversation-assets";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { GeneratedFileCustodyManifestVersions, type GeneratedFileCustodyManifest, type SealedGeneratedFileChunk } from "../../custody/file-custody.types";
import { GeneratedFileWorkflowStates, type GeneratedFilePromotionReceipt, type GeneratedFileWorkflowSnapshot } from "../../workflow/generated-file-workflow.types";
import { CONVERSATION_GENERATED_FILE_TASK } from "../conversation-generated-file-task";
import { GeneratedFileWorkflowFailureCodes, type GeneratedFileWorkflowCustody, type GeneratedFileWorkflowRecord, type GeneratedFileWorkflowRecordRepository } from "./generated-file-workflow-persistence.types";

/** Prisma-owned shape for one capture operation and directly related durable evidence. */
type _Operation = Prisma.ConversationGeneratedFileGetPayload<{ include: { asset: { include: { artifact: true; uploadLease: true } }; chunks: { orderBy: { index: "asc" } } } }>;

/** Prisma-owned shape for the reserved first revision and its scanner job. */
type _Revision = Prisma.ArtifactRevisionGetPayload<{ include: { scanJob: true } }>;

/** Loads and validates immutable generated-file rows without granting current execution authority. */
export class PrismaConversationGeneratedFileRecordRepository implements GeneratedFileWorkflowRecordRepository
{
	/** Keep every operation, Artifact and encrypted payload read on the caller's transaction. */
	constructor(private readonly transaction: Prisma.TransactionClient) {}

	/** Load one exact operation and interpret only complete relational lifecycle states. */
	async load(operationId: string, siloId?: string): Promise<GeneratedFileWorkflowRecord>
	{
		if (!_Coordinate(operationId) || (siloId !== undefined && !_Coordinate(siloId)))
			throw new Error("Generated file workflow coordinates are invalid");
		const operation = await this.transaction.conversationGeneratedFile.findFirst({
			where: { id: operationId, ...(siloId === undefined ? {} : { siloId }) },
			include: { asset: { include: { artifact: true, uploadLease: true } }, chunks: { orderBy: { index: "asc" } } },
		});
		if (operation === null)
			throw new Error("Generated file workflow operation was not found");
		const revision = await this.transaction.artifactRevision.findUnique({ where: { id: operation.revisionId }, include: { scanJob: true } });
		const snapshot = _Snapshot(operation, revision);
		const lease = operation.asset.uploadLease!;
		return {
			agentIdentityId: operation.agentIdentityId, assetId: operation.assetId, computerLeaseGeneration: operation.leaseGeneration,
			computerLeaseId: operation.leaseId, computerId: operation.computerId, conversationId: operation.conversationId, snapshot, attempt: operation.attempt,
			failureCode: operation.asset.failureCode, invocationRowId: operation.toolInvocationRowId,
			invocationId: operation.toolInvocationId, toolRevisionId: operation.toolRevisionId,
			requesterPrincipalId: operation.requesterPrincipalId, requesterSubjectId: operation.requesterSubject,
			runId: operation.runId, task: { taskId: operation.workflowTaskId, taskName: operation.workflowTaskName, idempotencyKey: operation.workflowTaskKey },
			uploadLease: { leaseId: lease.id, siloId: lease.siloId, artifactId: lease.artifactId, action: "artifact.write",
				expiresAtEpochSeconds: Math.floor(lease.expiresAt.getTime() / 1_000), expectedContentAddress: lease.expectedContentAddress,
				expectedByteLength: lease.expectedByteLength === null ? null : Number(lease.expectedByteLength), mediaType: lease.mediaType },
			uploadLeaseActive: lease.state === ArtifactUploadLeaseState.Active,
			savedPromotion: _SavedPromotion(lease),
		};
	}

	/** Load exact payload rows and reconstruct the codec's persisted manifest representation. */
	async loadCustody(record: GeneratedFileWorkflowRecord): Promise<GeneratedFileWorkflowCustody>
	{
		const operation = await this.transaction.conversationGeneratedFile.findFirst({ where: { id: record.snapshot.operationId, siloId: record.snapshot.siloId }, include: { chunks: { orderBy: { index: "asc" } } } });
		if (operation === null || operation.custodyManifestVersion !== GeneratedFileCustodyManifestVersions.V1 || operation.contentAddress !== record.snapshot.contentAddress
			|| operation.byteLength !== BigInt(record.snapshot.byteLength) || operation.chunkCount !== operation.chunks.length)
			throw new Error("Generated file custody manifest conflicted");
		const rows = await this.transaction.conversationPrivatePayload.findMany({ where: { id: { in: operation.chunks.map(chunk => chunk.payloadRef) } } });
		const byId = new Map(rows.map(row => [row.id, row]));
		const chunks: SealedGeneratedFileChunk[] = operation.chunks.map(function _Chunk(chunk)
		{
			const row = byId.get(chunk.payloadRef);
			if (row === undefined)
				throw new Error("Generated file custody row was not found");
			return { index: chunk.index, payloadRef: chunk.payloadRef, idempotencyKey: row.idempotencyKey,
				coordinates: { siloId: row.siloId, conversationId: row.conversationId, authorSubject: row.authorSubject, payloadRef: row.id },
				payload: { keyId: row.keyId, nonce: new Uint8Array(row.nonce), authTag: new Uint8Array(row.authTag), ciphertext: new Uint8Array(row.ciphertext), ciphertextDigest: row.ciphertextDigest } };
		});
		if (byId.size !== chunks.length)
			throw new Error("Generated file custody rows were duplicated or substituted");
		const manifest: GeneratedFileCustodyManifest = {
			version: GeneratedFileCustodyManifestVersions.V1, siloId: operation.siloId, conversationId: operation.conversationId,
			agentIdentityId: operation.agentIdentityId, requesterPrincipalId: operation.requesterPrincipalId,
			requesterSubjectId: operation.requesterSubject, operationId: operation.id, byteLength: Number(operation.byteLength),
			chunkCount: operation.chunkCount, chunks: operation.chunks, ciphertextManifestDigest: operation.ciphertextManifestDigest,
			contentAddress: operation.contentAddress,
		};
		return { manifest, chunks };
	}
}

/** Interpret exact operation, custody and Artifact rows as one closed workflow state. */
function _Snapshot(operation: _Operation, revision: _Revision | null): GeneratedFileWorkflowSnapshot
{
	const asset = operation.asset;
	const lease = asset.uploadLease;
	const byteLength = Number(operation.byteLength);
	if (asset.artifact === null || lease === null || !_BaseMatches(operation, byteLength))
		throw new Error("Generated file workflow persistence is invalid");
	const fields = { siloId: operation.siloId, operationId: operation.id, artifactId: operation.artifactId, artifactRevisionId: operation.revisionId, uploadLeaseId: operation.uploadLeaseId, contentAddress: operation.contentAddress, byteLength, mediaType: operation.mediaType, notAfterEpochMs: lease.expiresAt.getTime() };
	switch (asset.state)
	{
		case ConversationAssetState.Uploading:
			if (asset.messageId !== null || asset.revisionId !== null || asset.failureCode !== null || asset.artifact.currentRevisionId !== null || lease.state !== ArtifactUploadLeaseState.Active || revision !== null)
				throw new Error("Generated file Uploading state is invalid");
			return { ...fields, state: GeneratedFileWorkflowStates.PromotionRequired };
		case ConversationAssetState.Processing:
			if (asset.messageId !== null || asset.revisionId !== operation.revisionId || asset.failureCode !== null || asset.artifact.currentRevisionId !== null || lease.state !== ArtifactUploadLeaseState.Finalized
				|| !_FinalizedLeaseMatches(operation) || !_RevisionMatches(operation, revision, ArtifactRevisionState.Quarantined) || !_ScannerPending(revision))
				throw new Error("Generated file Processing state is invalid");
			return { ...fields, state: GeneratedFileWorkflowStates.ScanPending };
		case ConversationAssetState.Ready:
			if (!_MessageId(asset.messageId) || asset.revisionId !== operation.revisionId || asset.failureCode !== null || asset.artifact.currentRevisionId !== operation.revisionId || lease.state !== ArtifactUploadLeaseState.Finalized
				|| !_FinalizedLeaseMatches(operation) || !_RevisionMatches(operation, revision, ArtifactRevisionState.Published) || revision?.scanJob?.state !== ArtifactScanJobState.Clean)
				throw new Error("Generated file Ready state is invalid");
			return { ...fields, state: GeneratedFileWorkflowStates.Ready };
		case ConversationAssetState.Failed:
			if (asset.messageId !== null || !_FailedMatches(operation, revision))
				throw new Error("Generated file Failed state is invalid");
			return { ...fields, state: GeneratedFileWorkflowStates.Failed };
		case ConversationAssetState.Removed:
		default:
			throw new Error("Generated file workflow state is unsupported");
	}
}

/** Check immutable cross-owner coordinates before any lifecycle state is trusted. */
function _BaseMatches(operation: _Operation, byteLength: number): boolean
{
	const asset = operation.asset;
	const artifact = asset.artifact;
	const lease = asset.uploadLease;
	return artifact !== null && lease !== null && [operation.id, operation.siloId, operation.conversationId, operation.runId, operation.bootstrapId, operation.computerId, operation.leaseId, operation.agentIdentityId, operation.requesterPrincipalId, operation.requesterSubject, operation.toolInvocationRowId, operation.toolInvocationId, operation.toolRevisionId, operation.serverRevisionId, operation.assetId, operation.artifactId, operation.revisionId, operation.uploadLeaseId, operation.workflowTaskId, operation.workflowTaskKey, operation.displayName].every(_Coordinate)
		&& operation.attempt > 0 && operation.leaseGeneration > 0 && operation.workflowTaskName === CONVERSATION_GENERATED_FILE_TASK.taskName
		&& ___IsSha256ContentAddress(operation.contentAddress) && ___IsSha256ContentAddress(operation.rawResultDigest)
		&& ___IsSha256ContentAddress(operation.ciphertextManifestDigest) && operation.custodyManifestVersion === GeneratedFileCustodyManifestVersions.V1
		&& Number.isSafeInteger(byteLength) && byteLength > 0 && byteLength <= GENERATED_CSV_LIMITS.generatedBytes
		&& operation.mediaType === GENERATED_CSV_MEDIA_TYPE && operation.chunkCount > 0 && operation.chunks.length === operation.chunkCount
		&& operation.chunks.every(function _Chunk(chunk, index) { return chunk.index === index && _Coordinate(chunk.payloadRef) && ___IsSha256ContentAddress(chunk.ciphertextDigest) && chunk.decodedByteLength > 0; })
		&& asset.id === operation.assetId && asset.siloId === operation.siloId && asset.conversationId === operation.conversationId
		&& asset.artifactId === operation.artifactId && asset.uploadLeaseId === operation.uploadLeaseId && asset.idempotencyKey === operation.id
		&& asset.provenance === ConversationAssetProvenance.AgentOutput && asset.displayName === operation.displayName && asset.mediaType === operation.mediaType
		&& asset.byteLength === operation.byteLength && asset.createdByUserId === operation.requesterSubject && asset.removedAt === null
		&& artifact.id === operation.artifactId && artifact.siloId === operation.siloId && artifact.ownerPrincipalId === operation.requesterPrincipalId
		&& artifact.kind === ArtifactKind.Generated && artifact.state === ArtifactState.Active
		&& lease.id === operation.uploadLeaseId && lease.artifactId === operation.artifactId && lease.siloId === operation.siloId && _Coordinate(lease.capabilityJti)
		&& lease.expectedContentAddress === operation.contentAddress && lease.expectedByteLength === operation.byteLength && lease.mediaType === operation.mediaType
		&& lease.expiresAt instanceof Date && Number.isFinite(lease.expiresAt.getTime());
}

/** Ready may remain unlinked or carry the immutable UUID of its saved conversation message. */
function _MessageId(value: string | null): boolean
{
	return value === null || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

/** Failed accepts authority loss before completion or an exact terminal scanner result. */
function _FailedMatches(operation: _Operation, revision: _Revision | null): boolean
{
	const asset = operation.asset;
	if (!_Coordinate(asset.failureCode) || asset.artifact?.currentRevisionId !== null)
		return false;
	if (asset.revisionId === null)
		return revision === null;
	if (asset.revisionId !== operation.revisionId || asset.uploadLease?.state !== ArtifactUploadLeaseState.Finalized)
		return false;
	if (!_FinalizedLeaseMatches(operation))
		return false;
	if (asset.failureCode === GeneratedFileWorkflowFailureCodes.AuthorityEnded)
	{
		const unfinished = _RevisionMatches(operation, revision, ArtifactRevisionState.Quarantined) && _ScannerNotSuccessful(revision);
		const cleanWithoutPublication = _RevisionMatches(operation, revision, ArtifactRevisionState.Quarantined) && revision?.scanJob?.state === ArtifactScanJobState.Clean;
		const rejectedAfterFailure = _RevisionMatches(operation, revision, ArtifactRevisionState.Rejected) && revision?.scanJob?.state === ArtifactScanJobState.Rejected;
		return unfinished || cleanWithoutPublication || rejectedAfterFailure;
	}
	const unsafe = _RevisionMatches(operation, revision, ArtifactRevisionState.Rejected) && revision?.scanJob?.state === ArtifactScanJobState.Rejected;
	const scanFailed = _RevisionMatches(operation, revision, ArtifactRevisionState.Quarantined) && revision?.scanJob?.state === ArtifactScanJobState.TerminalFailed;
	return unsafe || scanFailed;
}

/** Require the immutable first revision and its content-free generated-file provenance. */
function _RevisionMatches(operation: _Operation, revision: _Revision | null, state: ArtifactRevisionState): boolean
{
	return revision !== null && revision.id === operation.revisionId && revision.artifactId === operation.artifactId && revision.revision === 1 && revision.state === state
		&& revision.contentAddress === operation.contentAddress && revision.byteLength === operation.byteLength && revision.mediaType === operation.mediaType
		&& revision.createdBy === operation.requesterSubject
		&& ___DigestCanonicalJson(revision.provenance as JsonValue) === ___DigestCanonicalJson({ kind: "conversation_generated_file", operationId: operation.id });
}

/** Return exact consumed promotion evidence only after the quarantine owner finalized the lease. */
function _SavedPromotion(lease: _Operation["asset"]["uploadLease"]): GeneratedFilePromotionReceipt | null
{
	if (lease === null || lease.state !== ArtifactUploadLeaseState.Finalized || lease.promotionReceiptDigest === null || lease.promotedContentAddress === null || lease.promotedByteLength === null)
		return null;
	const byteLength = Number(lease.promotedByteLength);
	if (!Number.isSafeInteger(byteLength))
		throw new Error("Generated file saved promotion length is invalid");
	return { leaseId: lease.id, receiptDigest: lease.promotionReceiptDigest, contentAddress: lease.promotedContentAddress, byteLength, mediaType: lease.mediaType };
}

/** Match all receipt-bearing fields written by the Artifact quarantine owner. */
function _FinalizedLeaseMatches(operation: _Operation): boolean
{
	const lease = operation.asset.uploadLease;
	return lease !== null && lease.state === ArtifactUploadLeaseState.Finalized && lease.promotionReceiptDigest !== null
		&& ___IsSha256ContentAddress(lease.promotionReceiptDigest) && lease.promotedContentAddress === operation.contentAddress
		&& lease.promotedByteLength === operation.byteLength && lease.promotedAt instanceof Date && lease.finalizedAt instanceof Date;
}

/** Recognize scanner states in which the exact quarantined revision still awaits a verdict. */
function _ScannerPending(revision: _Revision | null): boolean
{
	return revision?.scanJob?.state === ArtifactScanJobState.Pending || revision?.scanJob?.state === ArtifactScanJobState.Claimed || revision?.scanJob?.state === ArtifactScanJobState.RetryableFailed;
}

/** Authority loss may close any scanner state that did not publish or reject the revision. */
function _ScannerNotSuccessful(revision: _Revision | null): boolean
{
	return revision?.scanJob !== null && revision?.scanJob !== undefined && revision.scanJob.state !== ArtifactScanJobState.Clean && revision.scanJob.state !== ArtifactScanJobState.Rejected;
}

/** Reject empty, normalized, control-bearing or unbounded persistence coordinates. */
function _Coordinate(value: unknown): value is string
{
	return typeof value === "string" && value.length > 0 && value.length <= 512 && value === value.trim() && !/[\p{Cc}]/u.test(value);
}
