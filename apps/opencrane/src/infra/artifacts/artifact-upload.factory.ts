import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import type { PrismaClient } from "@prisma/client";

import { __SignArtifactWriteLease, __VerifyArtifactPromotionReceipt } from "@opencrane/backend/artifacts/authorization";
import { _CreateArtifactCatalogueRepository, _CreateArtifactPreprocessAuthority, _CreateArtifactUploadAuthority, __CompleteArtifactPreprocessJob, __IssueArtifactPreprocessOutputLease, __IssueArtifactReadLease, __UploadArtifact, IssueArtifactReadLeaseOutcomes, type ArtifactPreprocessOutputBroker, type ArtifactUploadResult, type VerifiedArtifactUploadCommand } from "@opencrane/backend/server/agents/artifacts";
import type { SkillAuthoringArtifactReader, SkillAuthoringInputRecord } from "@opencrane/backend/agents/skills/execution";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ___ParseAndValidateJson } from "@opencrane/util";

import { _ReadArtifactMountedPem } from "./artifact-mounted-key.loader.js";
import { _CreateArtifactReadLeaseSigner } from "./artifact-read-lease-signer.factory.js";
import { _CreateArtifactServiceReadPort, _InternalArtifactServiceUrl } from "./artifact-service-read-port.factory.js";

/** Build the path this app uses to take a proof-authorized command through to the private artifact service. */
export function _CreateArtifactUploadGateway(prisma: PrismaClient, environment: NodeJS.ProcessEnv = process.env): { upload(command: VerifiedArtifactUploadCommand): Promise<ArtifactUploadResult> }
{
	const serviceUrl = _InternalArtifactServiceUrl(environment.ARTIFACT_SERVICE_URL ?? "");
	const leasePrivateKey = _ReadArtifactMountedPem(environment.ARTIFACT_LEASE_PRIVATE_KEY_PATH, "ARTIFACT_LEASE_PRIVATE_KEY_PATH");
	const receiptPublicKey = _ReadArtifactMountedPem(environment.ARTIFACT_RECEIPT_PUBLIC_KEY_PATH, "ARTIFACT_RECEIPT_PUBLIC_KEY_PATH");
	const repository = _CreateArtifactUploadAuthority(prisma);
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

/** Build the sole app-owned HTTP client for artifact-service promotion. */
export function _CreateArtifactServicePromotionPort(serviceUrl: string): { promote(lease: string, bytes: AsyncIterable<Uint8Array>): Promise<{ readonly receipt: string }> }
{
	return {
		async promote(lease: string, bytes: AsyncIterable<Uint8Array>): Promise<{ readonly receipt: string }>
		{
			const response = await fetch(`${serviceUrl}/v1/artifacts/promote`, { method: "POST", headers: { "x-opencrane-artifact-lease": lease }, body: Readable.toWeb(Readable.from(bytes)) as unknown as BodyInit, duplex: "half" } as RequestInit);
			if (!response.ok) throw new Error(`artifact service promotion failed with ${response.status}`);
			return ___ParseAndValidateJson(await response.text(), "artifact service promotion response", _PromotionReceipt);
		},
	};
}

/** Validate the exact receipt returned after artifact promotion. */
function _PromotionReceipt(value: unknown): { readonly receipt: string }
{
	if (typeof value !== "object" || value === null || Array.isArray(value) || !("receipt" in value) || typeof value.receipt !== "string" || value.receipt.length === 0) throw new Error("artifact service promotion returned no receipt");
	return { receipt: value.receipt };
}

/** Build the one server-side path that turns a fenced authoring input into verified ArtifactStore bytes. */
export function _CreateSkillAuthoringArtifactReader(prisma: PrismaClient, environment: NodeJS.ProcessEnv = process.env): SkillAuthoringArtifactReader
{
	const repository = _CreateArtifactCatalogueRepository(prisma);
	return {
		async read(input: SkillAuthoringInputRecord): Promise<ReadableStream<Uint8Array>>
		{
			return ___DoWithTrace("skill-authoring.artifact-read", { siloId: input.siloId, artifactId: input.artifactId, artifactRevisionId: input.artifactRevisionId }, async function _ReadArtifact(): Promise<ReadableStream<Uint8Array>>
			{
				const serviceUrl = _InternalArtifactServiceUrl(environment.ARTIFACT_SERVICE_URL ?? "");
				const signLease = _CreateArtifactReadLeaseSigner(environment);
				const readPort = _CreateArtifactServiceReadPort(serviceUrl);
				const issued = await __IssueArtifactReadLease(repository, { sign: signLease }, { siloId: input.siloId, artifactId: input.artifactId, artifactRevisionId: input.artifactRevisionId }, Math.floor(Date.now() / 1_000));
				if (issued.outcome !== IssueArtifactReadLeaseOutcomes.Issued) throw new Error("artifact read lease denied");
				const response = await readPort.read(issued.compactLease);
				if (response.headers.get("content-length") !== String(issued.claims.byteLength) || response.headers.get("content-type") !== issued.claims.mediaType) throw new Error("artifact service read metadata did not match the published revision");
				return response.body as ReadableStream<Uint8Array>;
			});
		},
	};
}

/** Build the server-side output broker that owns hashing, promotion, receipt verification, and completion. */
export function _CreateArtifactPreprocessOutputBroker(prisma: PrismaClient, maximumOutputBytes: number, environment: NodeJS.ProcessEnv = process.env): ArtifactPreprocessOutputBroker
{
	if (!Number.isSafeInteger(maximumOutputBytes) || maximumOutputBytes <= 0) throw new Error("maximumOutputBytes must be a positive safe integer");
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
