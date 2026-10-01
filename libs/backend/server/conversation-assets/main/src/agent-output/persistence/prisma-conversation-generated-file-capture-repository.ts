import { Buffer } from "node:buffer";

import { ArtifactKind, ConversationAssetProvenance, ConversationAssetState, type Prisma } from "@prisma/client";

import type { ConversationPrivatePayloadCipher } from "@opencrane/backend/server/conversations/history";
import type { IWorkflowEngine, IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import { MCP_EXECUTOR_PROJECTED_TOKEN_AUDIENCE } from "@opencrane/contracts";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import type { JsonValue } from "@opencrane/util";

import { PrismaConversationAssetProductAuthorizationRepository } from "../../conversation-asset-product-authorization";
import { __OpenGeneratedFile, __SealGeneratedFile } from "../custody/file-custody";
import { GeneratedFileCustodyManifestVersions, type GeneratedFileCustodyManifest, type SealedGeneratedFileChunk } from "../custody/file-custody.types";
import { _ParseGeneratedFileResource } from "../generated-file-resource";
import { GeneratedFileResourceOutcomes, type GeneratedFileResource } from "../generated-file-resource.types";
import { _ConversationGeneratedFileTask, CONVERSATION_GENERATED_FILE_TASK } from "./conversation-generated-file-task";
import { GeneratedFileCaptureError } from "./generated-file-capture-error";
import { _GeneratedFileCaptureIdentity } from "./generated-file-capture-identity";
import { _GeneratedFileCaptureResult } from "./generated-file-capture-result";
import { GeneratedFileCaptureOutcomes, type CaptureGeneratedFileCommand, type GeneratedFileCaptureIdentity, type GeneratedFileCaptureProof, type GeneratedFileCaptureRepository, type GeneratedFileCaptureResult, type GeneratedFileCurrentExecutionAuthority, type GeneratedFileCurrentExecutionEvidence, type PersistedGeneratedFileReplay } from "./generated-file-capture.types";

/** A generated upload lease never outlives this bounded first promotion window. */
const _UPLOAD_LEASE_MILLISECONDS = 15 * 60 * 1_000;

/** Transaction participant that replaces one eligible MCP resource with encrypted-custody metadata. */
export class PrismaConversationGeneratedFileCaptureRepository implements GeneratedFileCaptureRepository
{
	/** Keep every authorization, artifact, ciphertext and workflow write on the caller's transaction. */
	constructor(
		private readonly transaction: Prisma.TransactionClient,
		private readonly cipher: ConversationPrivatePayloadCipher,
		private readonly workflows: Pick<IWorkflowEngine, "spawn">,
		private readonly currentExecution: GeneratedFileCurrentExecutionAuthority,
	) {}

	/**
	 * Capture a supported personal generated file or leave an ordinary scalar result untouched.
	 * Any eligible-result or authority mismatch throws so the surrounding MCP completion rolls back.
	 */
	async capture(command: CaptureGeneratedFileCommand): Promise<GeneratedFileCaptureResult>
	{
		_ValidateProof(command);
		const evidence = await this.currentExecution.admitCurrent(_Proof(command), new Date());
		if (evidence === null || !_EvidenceMatches(command, evidence))
			throw new GeneratedFileCaptureError("Generated file capture authority ended");
		_RequireCurrent(evidence.notAfterEpochMs);

		const parsed = _ParseGeneratedFileResource(evidence.toolName, evidence.effectiveArguments, command.result);
		if (parsed.outcome === GeneratedFileResourceOutcomes.NotApplicable)
			return { outcome: GeneratedFileCaptureOutcomes.NotApplicable };
		if (parsed.outcome !== GeneratedFileResourceOutcomes.Accepted)
			throw new GeneratedFileCaptureError("Generated file result was rejected");

		const identity = _GeneratedFileCaptureIdentity(evidence);
		const existing = await this.transaction.conversationGeneratedFile.findUnique({ where: { toolInvocationRowId: evidence.toolInvocationRowId }, include: { chunks: { orderBy: { index: "asc" } } } });
		if (existing !== null)
		{
			await this._AssertReplay(existing, evidence, identity, parsed.file);
			return { outcome: GeneratedFileCaptureOutcomes.Captured, result: _GeneratedFileCaptureResult(identity, parsed.file) };
		}

		const authorization = new PrismaConversationAssetProductAuthorizationRepository(this.transaction);
		const authorized = await authorization.admitWorkload(
			{ siloId: evidence.siloId, principalId: evidence.requesterPrincipalId },
			{ workload: evidence.authorizationWorkload, run: evidence.authorizationRun },
			{ kind: ProductAuthorizationResourceKinds.ArtifactCollection, id: evidence.siloId },
			ProductAuthorizationActions.Create,
			_AuthorizationArguments(evidence, identity, parsed.file),
		);
		if (!authorized)
			throw new GeneratedFileCaptureError("Generated file creation was denied");
		_RequireCurrent(evidence.notAfterEpochMs);
		const sealed = __SealGeneratedFile(this.cipher, { siloId: evidence.siloId, conversationId: evidence.conversationId, agentIdentityId: evidence.agentIdentityId, requesterPrincipalId: evidence.requesterPrincipalId, requesterSubjectId: evidence.requesterSubjectId, operationId: identity.operationId, bytes: parsed.file.bytes });
		if (sealed.manifest.contentAddress !== parsed.file.contentAddress)
			throw new GeneratedFileCaptureError("Generated file content identity was rejected");

		const writtenAt = new Date();
		const leaseExpiresAt = new Date(Math.min(evidence.notAfterEpochMs, writtenAt.getTime() + _UPLOAD_LEASE_MILLISECONDS));
		await this.transaction.artifact.create({ data: { id: identity.artifactId, siloId: evidence.siloId, ownerPrincipalId: evidence.requesterPrincipalId, kind: ArtifactKind.Generated } });
		await authorization.reconcileArtifactOwner(evidence.siloId, identity.artifactId, evidence.requesterPrincipalId, writtenAt);
		await this.transaction.artifactUploadLease.create({ data: { id: identity.uploadLeaseId, artifactId: identity.artifactId, siloId: evidence.siloId, capabilityJti: identity.capabilityJti, expectedContentAddress: parsed.file.contentAddress, expectedByteLength: BigInt(parsed.file.bytes.byteLength), mediaType: parsed.file.mediaType, expiresAt: leaseExpiresAt } });
		await this.transaction.conversationAsset.create({ data: { id: identity.assetId, siloId: evidence.siloId, conversationId: evidence.conversationId, messageId: null, artifactId: identity.artifactId, revisionId: null, uploadLeaseId: identity.uploadLeaseId, idempotencyKey: identity.operationId, provenance: ConversationAssetProvenance.AgentOutput, state: ConversationAssetState.Uploading, displayName: parsed.file.displayName, mediaType: parsed.file.mediaType, byteLength: BigInt(parsed.file.bytes.byteLength), failureCode: null, createdByUserId: evidence.requesterSubjectId } });

		_RequireCurrent(evidence.notAfterEpochMs);
		const task = _ConversationGeneratedFileTask({ siloId: evidence.siloId, operationId: identity.operationId }, identity.taskKey);
		const receipt = _Receipt(await this.workflows.spawn({ client: this.transaction }, task), identity.taskKey);
		_RequireCurrent(evidence.notAfterEpochMs);

		await this.transaction.conversationGeneratedFile.create({ data: {
			id: identity.operationId, siloId: evidence.siloId, conversationId: evidence.conversationId,
			runId: evidence.runId, attempt: evidence.attempt, bootstrapId: evidence.bootstrapId,
			computerId: evidence.computerId, leaseId: evidence.leaseId, leaseGeneration: evidence.leaseGeneration,
			agentIdentityId: evidence.agentIdentityId, requesterPrincipalId: evidence.requesterPrincipalId, requesterSubject: evidence.requesterSubjectId,
			toolInvocationRowId: evidence.toolInvocationRowId, toolInvocationId: evidence.toolInvocationId,
			toolRevisionId: evidence.toolRevisionId, serverRevisionId: evidence.serverRevisionId,
			rawResultDigest: parsed.file.rawResultDigest, custodyManifestVersion: sealed.manifest.version,
			ciphertextManifestDigest: sealed.manifest.ciphertextManifestDigest,
			assetId: identity.assetId, artifactId: identity.artifactId, revisionId: identity.revisionId, uploadLeaseId: identity.uploadLeaseId,
			contentAddress: parsed.file.contentAddress, byteLength: BigInt(parsed.file.bytes.byteLength), chunkCount: sealed.manifest.chunkCount,
			displayName: parsed.file.displayName, mediaType: parsed.file.mediaType,
			workflowTaskId: receipt.taskId, workflowTaskName: receipt.taskName, workflowTaskKey: receipt.idempotencyKey,
		} });
		for (const chunk of sealed.chunks)
		{
			_RequireCurrent(evidence.notAfterEpochMs);
			await this.transaction.conversationPrivatePayload.create({ data: { id: chunk.payloadRef, siloId: chunk.coordinates.siloId, conversationId: chunk.coordinates.conversationId, authorSubject: chunk.coordinates.authorSubject, idempotencyKey: chunk.idempotencyKey, keyId: chunk.payload.keyId, nonce: Buffer.from(chunk.payload.nonce), authTag: Buffer.from(chunk.payload.authTag), ciphertext: Buffer.from(chunk.payload.ciphertext), ciphertextDigest: chunk.payload.ciphertextDigest } });
			const manifestChunk = sealed.manifest.chunks[chunk.index]!;
			await this.transaction.conversationGeneratedFileChunk.create({ data: { operationId: identity.operationId, index: chunk.index, payloadRef: chunk.payloadRef, decodedByteLength: manifestChunk.decodedByteLength, ciphertextDigest: manifestChunk.ciphertextDigest } });
		}
		_RequireCurrent(evidence.notAfterEpochMs);
		return { outcome: GeneratedFileCaptureOutcomes.Captured, result: _GeneratedFileCaptureResult(identity, parsed.file) };
	}

	/** Verify the immutable operation and every encrypted byte before returning replay metadata. */
	private async _AssertReplay(existing: PersistedGeneratedFileReplay, evidence: GeneratedFileCurrentExecutionEvidence, identity: GeneratedFileCaptureIdentity, file: GeneratedFileResource): Promise<void>
	{
		const byteLength = Number(existing.byteLength);
		if (!_SameOperation(existing, evidence, identity, file, byteLength))
			throw new GeneratedFileCaptureError("Generated file capture replay conflicted");
		const payloadRows = await this.transaction.conversationPrivatePayload.findMany({ where: { id: { in: existing.chunks.map(chunk => chunk.payloadRef) } } });
		const payloads = new Map(payloadRows.map(row => [row.id, row]));
		if (payloads.size !== existing.chunks.length)
			throw new GeneratedFileCaptureError("Generated file capture replay custody was incomplete");
		const manifest: GeneratedFileCustodyManifest = { version: GeneratedFileCustodyManifestVersions.V1, siloId: existing.siloId, conversationId: existing.conversationId, agentIdentityId: existing.agentIdentityId, requesterPrincipalId: existing.requesterPrincipalId, requesterSubjectId: existing.requesterSubject, operationId: existing.id, byteLength, chunkCount: existing.chunkCount, contentAddress: existing.contentAddress, ciphertextManifestDigest: existing.ciphertextManifestDigest, chunks: existing.chunks };
		const chunks: SealedGeneratedFileChunk[] = existing.chunks.map(chunk =>
		{
			const payload = payloads.get(chunk.payloadRef);
			if (payload === undefined)
				throw new GeneratedFileCaptureError("Generated file capture replay custody was incomplete");
			return { index: chunk.index, payloadRef: chunk.payloadRef, idempotencyKey: payload.idempotencyKey, coordinates: { siloId: payload.siloId, conversationId: payload.conversationId, authorSubject: payload.authorSubject, payloadRef: payload.id }, payload: { keyId: payload.keyId, nonce: new Uint8Array(payload.nonce), authTag: new Uint8Array(payload.authTag), ciphertext: new Uint8Array(payload.ciphertext), ciphertextDigest: payload.ciphertextDigest } };
		});
		const savedBytes = __OpenGeneratedFile(this.cipher, manifest, chunks);
		if (!Buffer.from(savedBytes).equals(Buffer.from(file.bytes)))
			throw new GeneratedFileCaptureError("Generated file capture replay content conflicted");
	}
}

/** Keep product authorization evidence free of generated bytes and admitted arguments. */
function _AuthorizationArguments(evidence: GeneratedFileCurrentExecutionEvidence, identity: GeneratedFileCaptureIdentity, file: GeneratedFileResource): JsonValue
{
	return { operationId: identity.operationId, toolInvocationRowId: evidence.toolInvocationRowId, artifactId: identity.artifactId, contentAddress: file.contentAddress, byteLength: file.bytes.byteLength, mediaType: file.mediaType };
}

/** Accept only a receipt for this operation's declared task and deterministic key. */
function _Receipt(receipt: IWorkflowTaskReceipt, taskKey: string): IWorkflowTaskReceipt
{
	if (!_Coordinate(receipt.taskId) || receipt.taskName !== CONVERSATION_GENERATED_FILE_TASK.taskName || receipt.idempotencyKey !== taskKey)
		throw new GeneratedFileCaptureError("Generated file workflow returned a conflicting task receipt");
	return receipt;
}

/** Compare every immutable operation coordinate before reading encrypted replay content. */
function _SameOperation(existing: PersistedGeneratedFileReplay, evidence: GeneratedFileCurrentExecutionEvidence, identity: GeneratedFileCaptureIdentity, file: GeneratedFileResource, byteLength: number): boolean
{
	return existing.id === identity.operationId && existing.siloId === evidence.siloId && existing.conversationId === evidence.conversationId
		&& existing.runId === evidence.runId && existing.attempt === evidence.attempt && existing.bootstrapId === evidence.bootstrapId
		&& existing.computerId === evidence.computerId && existing.leaseId === evidence.leaseId && existing.leaseGeneration === evidence.leaseGeneration
		&& existing.agentIdentityId === evidence.agentIdentityId && existing.requesterPrincipalId === evidence.requesterPrincipalId && existing.requesterSubject === evidence.requesterSubjectId
		&& existing.toolInvocationRowId === evidence.toolInvocationRowId && existing.toolInvocationId === evidence.toolInvocationId
		&& existing.toolRevisionId === evidence.toolRevisionId && existing.serverRevisionId === evidence.serverRevisionId
		&& existing.rawResultDigest === file.rawResultDigest && existing.custodyManifestVersion === GeneratedFileCustodyManifestVersions.V1
		&& existing.assetId === identity.assetId && existing.artifactId === identity.artifactId && existing.revisionId === identity.revisionId && existing.uploadLeaseId === identity.uploadLeaseId
		&& existing.contentAddress === file.contentAddress && byteLength === file.bytes.byteLength && existing.displayName === file.displayName && existing.mediaType === file.mediaType
		&& existing.workflowTaskName === CONVERSATION_GENERATED_FILE_TASK.taskName && existing.workflowTaskKey === identity.taskKey && _Coordinate(existing.workflowTaskId);
}

/** Keep proof transport coordinates exact and bounded before invoking the authority owner. */
function _ValidateProof(proof: GeneratedFileCaptureProof): void
{
	if (![_Coordinate(proof.executionId), _Coordinate(proof.executionReference), _Coordinate(proof.claimFence), _Coordinate(proof.podUid), _Coordinate(proof.workload.subject), _Coordinate(proof.workload.namespace), _Coordinate(proof.workload.serviceAccountName), _Coordinate(proof.workload.podUid)].every(Boolean)
		|| proof.podUid !== proof.workload.podUid)
		throw new GeneratedFileCaptureError("Generated file capture proof is invalid");
}

/** Compare authority-owned facts with the exact terminal request and reject malformed evidence. */
function _EvidenceMatches(command: GeneratedFileCaptureProof, evidence: GeneratedFileCurrentExecutionEvidence): boolean
{
	const strings = [evidence.siloId, evidence.conversationId, evidence.runId, evidence.bootstrapId, evidence.computerId, evidence.leaseId, evidence.agentIdentityId, evidence.requesterPrincipalId, evidence.requesterSubjectId, evidence.toolInvocationRowId, evidence.toolInvocationId, evidence.toolRevisionId, evidence.serverRevisionId, evidence.toolName, evidence.execution.executionId, evidence.execution.executionReference, evidence.execution.claimFence, evidence.authorizationRun.agentServiceId, evidence.authorizationRun.agentRevisionId, evidence.authorizationWorkload.audience, evidence.authorizationWorkload.namespace, evidence.authorizationWorkload.serviceAccountName, evidence.authorizationWorkload.workloadUid, evidence.authorizationWorkload.podUid];
	return strings.every(_Coordinate) && Number.isSafeInteger(evidence.attempt) && evidence.attempt > 0 && Number.isSafeInteger(evidence.leaseGeneration) && evidence.leaseGeneration > 0
		&& Number.isSafeInteger(evidence.notAfterEpochMs) && evidence.notAfterEpochMs > Date.now()
		&& evidence.execution.executionId === command.executionId && evidence.execution.executionReference === command.executionReference && evidence.execution.claimFence === command.claimFence
		&& evidence.authorizationWorkload.audience === MCP_EXECUTOR_PROJECTED_TOKEN_AUDIENCE && evidence.authorizationWorkload.namespace === command.workload.namespace
		&& evidence.authorizationWorkload.serviceAccountName === command.workload.serviceAccountName && evidence.authorizationWorkload.podUid === command.workload.podUid && evidence.authorizationWorkload.workloadKind === "job"
		&& evidence.authorizationRun.runId === evidence.runId && evidence.authorizationRun.attempt === evidence.attempt;
}

/** Copy only terminal proof fields into the authority call. */
function _Proof(command: CaptureGeneratedFileCommand): GeneratedFileCaptureProof
{
	return { executionId: command.executionId, executionReference: command.executionReference, claimFence: command.claimFence, podUid: command.podUid, workload: command.workload };
}

/** Refuse to continue whenever the saved authority deadline has reached the server clock. */
function _RequireCurrent(notAfterEpochMs: number): void
{
	if (!Number.isSafeInteger(notAfterEpochMs) || notAfterEpochMs <= Date.now())
		throw new GeneratedFileCaptureError("Generated file capture authority ended");
}

/** Validate opaque string coordinates without accepting whitespace or control characters. */
function _Coordinate(value: unknown): value is string
{
	return typeof value === "string" && value.length > 0 && value.length <= 512 && value === value.trim() && !/[\p{Cc}]/u.test(value);
}
