import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";

import type { PrismaClient } from "@prisma/client";

import { __SignArtifactReadLease, __SignArtifactWriteLease, __VerifyArtifactPromotionReceipt } from "@opencrane/backend/artifacts/authorization";
import { __CompleteArtifactPreprocessJob, __IssueArtifactPreprocessOutputLease, __IssueArtifactReadLease, __UploadArtifact, PrismaArtifactAuthorityRepository, PrismaArtifactPreprocessRepository } from "@opencrane/backend/server/agents/artifacts";
import type { ArtifactPreprocessOutputBroker, ArtifactPreprocessSourceBroker, ArtifactUploadResult, VerifiedArtifactUploadCommand } from "@opencrane/backend/server/agents/artifacts";
import type { SkillAuthoringArtifactReader, SkillAuthoringInputRecord } from "@opencrane/backend/agents/skills/execution";
import { ___DoWithTrace } from "@opencrane/observability";

/** Build the app-owned bridge from a proof-authorized command to the private artifact service. */
export function _CreateArtifactUploadGateway(prisma: PrismaClient, environment: NodeJS.ProcessEnv = process.env): { upload(command: VerifiedArtifactUploadCommand): Promise<ArtifactUploadResult> }
{
	const serviceUrl = _InternalServiceUrl(environment.ARTIFACT_SERVICE_URL ?? "");
	const leasePrivateKey = _ReadPem(environment.ARTIFACT_LEASE_PRIVATE_KEY_PATH, "ARTIFACT_LEASE_PRIVATE_KEY_PATH");
	const receiptPublicKey = _ReadPem(environment.ARTIFACT_RECEIPT_PUBLIC_KEY_PATH, "ARTIFACT_RECEIPT_PUBLIC_KEY_PATH");
	const repository = new PrismaArtifactAuthorityRepository(prisma);
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
			const body = await response.json() as { receipt?: unknown };
			if (typeof body.receipt !== "string") throw new Error("artifact service promotion returned no receipt");
			return { receipt: body.receipt };
		},
	};
}

/** Build the server-only HTTP client that retrieves bytes covered by one immutable read lease. */
export function _CreateArtifactServiceReadPort(serviceUrl: string): { read(lease: string): Promise<Response> }
{
	return {
		async read(lease: string): Promise<Response>
		{
			return ___DoWithTrace("artifact.read.fetch", { service: "artifact-service" }, async function _FetchArtifact(): Promise<Response>
			{
				const response = await fetch(`${serviceUrl}/v1/artifacts/read`, { redirect: "error", headers: { "x-opencrane-artifact-read-lease": lease } });
				if (!response.ok || response.body === null) throw new Error(`artifact service read failed with ${response.status}`);
				return response;
			});
		},
	};
}

/** Mint one read lease from server-owned mounted key material; workers never receive this token. */
export function _CreateArtifactReadLeaseSigner(environment: NodeJS.ProcessEnv = process.env): (claims: Parameters<typeof __SignArtifactReadLease>[0]) => string
{
	const leasePrivateKey = _ReadPem(environment.ARTIFACT_LEASE_PRIVATE_KEY_PATH, "ARTIFACT_LEASE_PRIVATE_KEY_PATH");
	return function _SignReadLease(claims): string { return __SignArtifactReadLease(claims, leasePrivateKey, Math.floor(Date.now() / 1_000)); };
}

/** Build the only server-side bridge from a fenced authoring input to verified ArtifactStore bytes. */
export function _CreateSkillAuthoringArtifactReader(prisma: PrismaClient, environment: NodeJS.ProcessEnv = process.env): SkillAuthoringArtifactReader
{
	const repository = new PrismaArtifactAuthorityRepository(prisma);
	return {
		async read(input: SkillAuthoringInputRecord): Promise<ReadableStream<Uint8Array>>
		{
			return ___DoWithTrace("skill-authoring.artifact-read", { siloId: input.siloId, artifactId: input.artifactId, artifactRevisionId: input.artifactRevisionId }, async function _ReadArtifact(): Promise<ReadableStream<Uint8Array>>
			{
				const serviceUrl = _InternalServiceUrl(environment.ARTIFACT_SERVICE_URL ?? "");
				const signLease = _CreateArtifactReadLeaseSigner(environment);
				const readPort = _CreateArtifactServiceReadPort(serviceUrl);
				const issued = await __IssueArtifactReadLease(repository, { sign: signLease }, { siloId: input.siloId, artifactId: input.artifactId, artifactRevisionId: input.artifactRevisionId }, Math.floor(Date.now() / 1_000));
				if (issued.outcome !== "issued") throw new Error("artifact read lease denied");
				const response = await readPort.read(issued.compactLease);
				if (response.headers.get("content-length") !== String(issued.claims.byteLength) || response.headers.get("content-type") !== issued.claims.mediaType) throw new Error("artifact service read metadata did not match the published revision");
				return response.body as ReadableStream<Uint8Array>;
			});
		},
	};
}

/** Build the server-side source broker that keeps read leases and storage coordinates private. */
export function _CreateArtifactPreprocessSourceBroker(prisma: PrismaClient, environment: NodeJS.ProcessEnv = process.env): ArtifactPreprocessSourceBroker
{
	const jobs = new PrismaArtifactPreprocessRepository(prisma);
	const serviceUrl = _InternalServiceUrl(environment.ARTIFACT_SERVICE_URL ?? "");
	const signLease = _CreateArtifactReadLeaseSigner(environment);
	const readPort = _CreateArtifactServiceReadPort(serviceUrl);
	return {
		async read(command)
		{
			return ___DoWithTrace("artifact-preprocessor.source.broker", { jobId: command.jobId, attempt: command.attempt }, async function _ReadSource()
			{
				// 1. Allocate exact read claims under the current database-owned fence and its old deadline.
				const source = await jobs.issueSourceLeaseAtomically(command);
				if (source === null) return null;

				// 2. Refuse a claim that expired after the transaction, then sign without extending its authority.
				if (source.readLease.expiresAtEpochSeconds <= Math.floor(Date.now() / 1_000)) return null;
				const compactLease = signLease(source.readLease);

				// 3. Cross-check storage metadata before proxying bytes without exposing the lease.
				const response = await readPort.read(compactLease);
				if (response.body === null || response.headers.get("content-length") !== String(source.byteLength) || response.headers.get("content-type") !== source.mediaType) throw new Error("artifact service read metadata did not match the claimed source");
				return { byteLength: source.byteLength, mediaType: source.mediaType, bytes: response.body as unknown as AsyncIterable<Uint8Array> };
			});
		},
	};
}

/** Build the server-side output broker that owns hashing, promotion, receipt verification, and completion. */
export function _CreateArtifactPreprocessOutputBroker(prisma: PrismaClient, maximumOutputBytes: number, environment: NodeJS.ProcessEnv = process.env): ArtifactPreprocessOutputBroker
{
	if (!Number.isSafeInteger(maximumOutputBytes) || maximumOutputBytes <= 0) throw new Error("maximumOutputBytes must be a positive safe integer");
	const jobs = new PrismaArtifactPreprocessRepository(prisma);
	const serviceUrl = _InternalServiceUrl(environment.ARTIFACT_SERVICE_URL ?? "");
	const promotionPort = _CreateArtifactServicePromotionPort(serviceUrl);
	const leasePrivateKey = _ReadPem(environment.ARTIFACT_LEASE_PRIVATE_KEY_PATH, "ARTIFACT_LEASE_PRIVATE_KEY_PATH");
	const receiptPublicKey = _ReadPem(environment.ARTIFACT_RECEIPT_PUBLIC_KEY_PATH, "ARTIFACT_RECEIPT_PUBLIC_KEY_PATH");
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

/** Adapt one already-bounded output buffer to the promotion port without another copy. */
async function* _OneBuffer(buffer: Buffer): AsyncGenerator<Uint8Array>
{
	yield buffer;
}

/** Require a credential-free, cluster-local HTTP endpoint. */
function _InternalServiceUrl(value: string): string
{
	const parsed = new URL(value);
	if (parsed.protocol !== "http:" || parsed.username || parsed.password || !parsed.hostname.endsWith(".svc.cluster.local")) throw new Error("ARTIFACT_SERVICE_URL must be a credential-free cluster-local HTTP URL");
	return parsed.toString().replace(/\/$/u, "");
}

/** Load a key only from a read-only mounted file, never a raw environment value. */
function _ReadPem(path: string | undefined, name: string): string
{
	if (path === undefined || !path.startsWith("/")) throw new Error(`${name} must identify an absolute mounted key path`);
	const value = readFileSync(path, "utf8");
	if (!value.includes("-----BEGIN ") || !value.includes(" KEY-----")) throw new Error(`${name} must contain a PEM key`);
	return value;
}
