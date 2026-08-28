import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import type { PrismaClient } from "@prisma/client";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import { __SignArtifactWriteLease, __VerifyArtifactPromotionReceipt } from "@opencrane/backend/artifacts/authorization";
import { _CreateArtifactCatalogueRepository, _CreateArtifactPreprocessAuthority, _CreateArtifactUploadAuthority, __CompleteArtifactPreprocessJob, __IssueArtifactPreprocessOutputLease, __IssueArtifactReadLease, __UploadArtifact, IssueArtifactReadLeaseOutcomes, type ArtifactPreprocessOutputBroker, type ArtifactUploadResult, type PublishedArtifactReadTarget, type VerifiedArtifactUploadCommand } from "@opencrane/backend/server/agents/artifacts";
import type { SkillAuthoringArtifactReader } from "@opencrane/backend/agents/skills/execution";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { PrismaConversationAssetOutputUnitOfWork, PrismaConversationAssetUnitOfWork, type ConversationAssetContentBroker, type ConversationAssetReadTarget } from "@opencrane/backend/server/conversation-assets";
import { ___ParseAndValidateJson } from "@opencrane/util";

import { _ReadArtifactMountedPem } from "./artifact-mounted-key.loader";
import { _CreateArtifactReadLeaseSigner } from "./artifact-read-lease-signer.factory";
import { _CreateArtifactServiceReadPort, _InternalArtifactServiceUrl } from "./artifact-service-read-port.factory";

/**
 * Builds the upload gateway that signs storage leases and publishes verified artifact revisions.
 *
 * The workflow engine reaches the publication repository through this factory. For a PDF, the
 * revision, preprocessing record, and saved task receipt therefore use the same database
 * transaction; a task-admission failure also rejects the publication.
 *
 * Called by: `apps/opencrane/src/index.ts`, which installs the gateway on the public application.
 * @param prisma - Product database client used by the artifact repositories.
 * @param workflow - Guarded engine that saves PDF preprocessing tasks in the publication transaction.
 * @param environment - Deployment paths and the private artifact-service address.
 * @returns The application upload port.
 * @throws Error when the service address or mounted signing keys are missing or invalid.
 */
export function _CreateArtifactUploadGateway(prisma: PrismaClient, workflow: Pick<IWorkflowEngine, "spawn">, environment: NodeJS.ProcessEnv = process.env): { upload(command: VerifiedArtifactUploadCommand): Promise<ArtifactUploadResult> }
{
	const serviceUrl = _InternalArtifactServiceUrl(environment.ARTIFACT_SERVICE_URL ?? "");
	const leasePrivateKey = _ReadArtifactMountedPem(environment.ARTIFACT_LEASE_PRIVATE_KEY_PATH, "ARTIFACT_LEASE_PRIVATE_KEY_PATH");
	const receiptPublicKey = _ReadArtifactMountedPem(environment.ARTIFACT_RECEIPT_PUBLIC_KEY_PATH, "ARTIFACT_RECEIPT_PUBLIC_KEY_PATH");
	const repository = _CreateArtifactUploadAuthority(prisma, workflow);
	return {
		upload(command: VerifiedArtifactUploadCommand): Promise<ArtifactUploadResult>
		{
			return __UploadArtifact(repository, _CreateArtifactServicePromotionPort(serviceUrl), {
				signLease(claims) { return __SignArtifactWriteLease(claims, leasePrivateKey, Math.floor(Date.now() / 1_000)); },
				verifyReceipt(compact) { return __VerifyArtifactPromotionReceipt(compact, receiptPublicKey); },
				digestReceipt(compact) { return `sha256:${createHash("sha256").update(compact, "utf8").digest("hex")}`; },
			}, command);
		},
	};
}

/** Build the participant conversation-file authority without exposing its write leases. */
export function _CreateConversationAssetAuthority(prisma: PrismaClient, environment: NodeJS.ProcessEnv = process.env, scannerAvailable = true): PrismaConversationAssetUnitOfWork
{
	const serviceUrl = _InternalArtifactServiceUrl(environment.ARTIFACT_SERVICE_URL ?? "");
	const leasePrivateKey = _ReadArtifactMountedPem(environment.ARTIFACT_LEASE_PRIVATE_KEY_PATH, "ARTIFACT_LEASE_PRIVATE_KEY_PATH");
	const receiptPublicKey = _ReadArtifactMountedPem(environment.ARTIFACT_RECEIPT_PUBLIC_KEY_PATH, "ARTIFACT_RECEIPT_PUBLIC_KEY_PATH");
	return new PrismaConversationAssetUnitOfWork(prisma, _CreateArtifactServicePromotionPort(serviceUrl), {
		signLease(claims) { return __SignArtifactWriteLease(claims, leasePrivateKey, Math.floor(Date.now() / 1_000)); },
		verifyReceipt(compact) { return __VerifyArtifactPromotionReceipt(compact, receiptPublicKey); },
		digestReceipt(compact) { return `sha256:${createHash("sha256").update(compact, "utf8").digest("hex")}`; }
	}, _CreateConversationAssetContentBroker(prisma, environment), scannerAvailable);
}

/** Build the private broker that turns an authorized ready asset into exact published bytes. */
export function _CreateConversationAssetContentBroker(prisma: PrismaClient, environment: NodeJS.ProcessEnv = process.env): ConversationAssetContentBroker
{
	const serviceUrl = _InternalArtifactServiceUrl(environment.ARTIFACT_SERVICE_URL ?? "");
	const repository = _CreateArtifactCatalogueRepository(prisma);
	const signer = { sign: _CreateArtifactReadLeaseSigner(environment) };
	const readPort = _CreateArtifactServiceReadPort(serviceUrl);
	return {
		async open(target: ConversationAssetReadTarget): Promise<AsyncIterable<Uint8Array> | null>
		{
			return ___DoWithTrace("conversation.asset.content-broker", { siloId: target.siloId, artifactId: target.artifactId, artifactRevisionId: target.artifactRevisionId }, async function _ReadContent(): Promise<AsyncIterable<Uint8Array> | null>
			{
				const issued = await __IssueArtifactReadLease(repository, signer, { siloId: target.siloId, artifactId: target.artifactId, artifactRevisionId: target.artifactRevisionId }, Math.floor(Date.now() / 1_000));
				if (issued.outcome !== IssueArtifactReadLeaseOutcomes.Issued) return null;
				if (issued.claims.byteLength !== target.byteLength || issued.claims.mediaType !== target.mediaType) return null;
				const response = await readPort.read(issued.compactLease);
				if (response.headers.get("content-length") !== String(target.byteLength) || response.headers.get("content-type") !== target.mediaType) throw new Error("artifact service read metadata did not match the ready conversation asset");
				if (response.body === null) throw new Error("artifact service returned no conversation asset body");
				return _ResponseBytes(response.body);
			});
		}
	};
}

/** Yield a private HTTP response body and cancel its reader if the browser disconnects early. */
async function* _ResponseBytes(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array>
{
	const reader = body.getReader();
	let complete = false;
	try
	{
		while (true)
		{
			const next = await reader.read();
			if (next.done) { complete = true; return; }
			yield next.value;
		}
	}
	finally
	{
		if (!complete) await reader.cancel().catch(function _IgnoreCancellationFailure(): void {});
		reader.releaseLock();
	}
}

/** Build the runtime-only generated conversation-file authority without exposing storage leases. */
export function _CreateConversationAssetOutputAuthority(prisma: PrismaClient, environment: NodeJS.ProcessEnv = process.env, scannerAvailable = true): PrismaConversationAssetOutputUnitOfWork
{
	const serviceUrl = _InternalArtifactServiceUrl(environment.ARTIFACT_SERVICE_URL ?? "");
	const leasePrivateKey = _ReadArtifactMountedPem(environment.ARTIFACT_LEASE_PRIVATE_KEY_PATH, "ARTIFACT_LEASE_PRIVATE_KEY_PATH");
	const receiptPublicKey = _ReadArtifactMountedPem(environment.ARTIFACT_RECEIPT_PUBLIC_KEY_PATH, "ARTIFACT_RECEIPT_PUBLIC_KEY_PATH");
	return new PrismaConversationAssetOutputUnitOfWork(prisma, _CreateArtifactServicePromotionPort(serviceUrl), {
		signLease(claims) { return __SignArtifactWriteLease(claims, leasePrivateKey, Math.floor(Date.now() / 1_000)); },
		verifyReceipt(compact) { return __VerifyArtifactPromotionReceipt(compact, receiptPublicKey); },
		digestReceipt(compact) { return `sha256:${createHash("sha256").update(compact, "utf8").digest("hex")}`; }
	}, scannerAvailable);
}

/** Build the sole app-owned HTTP client for artifact-service promotion. */
export function _CreateArtifactServicePromotionPort(serviceUrl: string): { promote(lease: string, bytes: AsyncIterable<Uint8Array>): Promise<{ readonly receipt: string }> }
{
	return {
		async promote(lease: string, bytes: AsyncIterable<Uint8Array>): Promise<{ readonly receipt: string }>
		{
			return ___DoWithTrace("artifact.promote.fetch", {}, async function _Promote(): Promise<{ readonly receipt: string }>
			{
				const response = await fetch(`${serviceUrl}/v1/artifacts/promote`, { method: "POST", headers: { "x-opencrane-artifact-lease": lease }, body: Readable.toWeb(Readable.from(bytes)) as unknown as BodyInit, duplex: "half" } as RequestInit);
				if (!response.ok) throw new Error(`artifact service promotion failed with ${response.status}`);
				return ___ParseAndValidateJson(await response.text(), "artifact service promotion response", _PromotionReceipt);
			});
		},
	};
}

/** Validate the exact receipt returned after artifact promotion. */
function _PromotionReceipt(value: unknown): { readonly receipt: string }
{
	if (typeof value !== "object" || value === null || Array.isArray(value) || !("receipt" in value) || typeof value.receipt !== "string" || value.receipt.length === 0) throw new Error("artifact service promotion returned no receipt");
	return { receipt: value.receipt };
}

/** Build the server-side path that turns exact published coordinates into verified ArtifactStore bytes. */
export function _CreatePublishedArtifactReader(prisma: PrismaClient, environment: NodeJS.ProcessEnv = process.env): { read(input: PublishedArtifactReadTarget): Promise<ReadableStream<Uint8Array>> }
{
	const repository = _CreateArtifactCatalogueRepository(prisma);
	return {
		async read(input: PublishedArtifactReadTarget): Promise<ReadableStream<Uint8Array>>
		{
			return ___DoWithTrace("artifact.published-read", { siloId: input.siloId, artifactId: input.artifactId, artifactRevisionId: input.artifactRevisionId }, async function _ReadArtifact(): Promise<ReadableStream<Uint8Array>>
			{
				const serviceUrl = _InternalArtifactServiceUrl(environment.ARTIFACT_SERVICE_URL ?? "");
				const signLease = _CreateArtifactReadLeaseSigner(environment);
				const readPort = _CreateArtifactServiceReadPort(serviceUrl);
				const issued = await __IssueArtifactReadLease(repository, { sign: signLease }, { siloId: input.siloId, artifactId: input.artifactId, artifactRevisionId: input.artifactRevisionId }, Math.floor(Date.now() / 1_000));
				if (issued.outcome !== IssueArtifactReadLeaseOutcomes.Issued)
					throw new Error("artifact read lease denied");
				const response = await readPort.read(issued.compactLease);
				if (response.headers.get("content-length") !== String(issued.claims.byteLength) || response.headers.get("content-type") !== issued.claims.mediaType)
					throw new Error("artifact service read metadata did not match the published revision");
				if (response.body === null)
					throw new Error("artifact service returned no published artifact body");
				return response.body;
			});
		},
	};
}

/** Keep the skill worker's named port while reusing the single published-artifact reader. */
export function _CreateSkillAuthoringArtifactReader(prisma: PrismaClient, environment: NodeJS.ProcessEnv = process.env): SkillAuthoringArtifactReader
{
	return _CreatePublishedArtifactReader(prisma, environment);
}

/** Builds the server-side output broker that owns hashing, promotion, receipt verification, and completion. */
export function _CreateArtifactPreprocessOutputBroker(prisma: PrismaClient, maximumOutputBytes: number, environment: NodeJS.ProcessEnv = process.env): ArtifactPreprocessOutputBroker
{
	if (!Number.isSafeInteger(maximumOutputBytes) || maximumOutputBytes <= 0)
	{
		throw new Error("maximumOutputBytes must be a positive safe integer");
	}
	const jobs = _CreateArtifactPreprocessAuthority(prisma);
	const serviceUrl = _InternalArtifactServiceUrl(environment.ARTIFACT_SERVICE_URL ?? "");
	const promotionPort = _CreateArtifactServicePromotionPort(serviceUrl);
	const leasePrivateKey = _ReadArtifactMountedPem(environment.ARTIFACT_LEASE_PRIVATE_KEY_PATH, "ARTIFACT_LEASE_PRIVATE_KEY_PATH");
	const receiptPublicKey = _ReadArtifactMountedPem(environment.ARTIFACT_RECEIPT_PUBLIC_KEY_PATH, "ARTIFACT_RECEIPT_PUBLIC_KEY_PATH");
	return {
		async publish(command, bytes)
		{
			return ___DoWithTrace("artifact-preprocessor.output.broker", { jobId: command.jobId, attempt: command.attempt }, async function _PublishOutput()
			{
				// 1. Observe and hash the exact bounded body before granting any storage authority.
				const output = await _CollectBounded(bytes, maximumOutputBytes);
				const contentAddress = `sha256:${createHash("sha256").update(output).digest("hex")}`;
				const issued = await __IssueArtifactPreprocessOutputLease(jobs, { ...command, contentAddress, byteLength: output.byteLength });
				if (issued === null) return "conflict";
				if (issued === "completed") return "completed";

				// 2. Sign and consume the exact-byte write lease entirely inside OpenCrane.
				const compactLease = __SignArtifactWriteLease(issued.writeLease, leasePrivateKey, Math.floor(Date.now() / 1_000));
				const promoted = await promotionPort.promote(compactLease, _OneBuffer(output));
				const promotion = __VerifyArtifactPromotionReceipt(promoted.receipt, receiptPublicKey);
				if (promotion === null) throw new Error("artifact service returned an invalid promotion receipt");

				// 3. Commit the verified receipt, generated revision, lineage, and job atomically.
				const completed = await __CompleteArtifactPreprocessJob(jobs, { ...command, derivedRevisionId: issued.derivedRevisionId, promotion, receiptDigest: `sha256:${createHash("sha256").update(promoted.receipt, "utf8").digest("hex")}` });
				return completed ? "completed" : "conflict";
			});
		},
	};
}

/** Collect one untrusted stream under the configured raw-body ceiling. */
async function _CollectBounded(bytes: AsyncIterable<Uint8Array>, maximumBytes: number): Promise<Buffer>
{
	const chunks: Buffer[] = [];
	let length = 0;
	for await (const chunk of bytes)
	{
		length += chunk.byteLength;
		if (length > maximumBytes) throw new Error("artifact preprocess output exceeded the configured byte limit");
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks, length);
}

/** Hand an already size-checked output buffer to the promotion port without copying it again. */
async function* _OneBuffer(buffer: Buffer): AsyncGenerator<Uint8Array>
{
	yield buffer;
}
