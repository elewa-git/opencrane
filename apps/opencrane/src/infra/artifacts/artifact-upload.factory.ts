import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";

import type { PrismaClient } from "@prisma/client";

import { __SignArtifactReadLease, __SignArtifactWriteLease, __VerifyArtifactPromotionReceipt } from "@opencrane/backend/artifacts/authorization";
import { __UploadArtifact, PrismaArtifactAuthorityRepository } from "@opencrane/backend/server/agents/artifacts";
import type { ArtifactUploadResult, VerifiedArtifactUploadCommand } from "@opencrane/backend/server/agents/artifacts";
import type { SkillAuthoringArtifactReader, SkillAuthoringInputRecord } from "@opencrane/backend/agents/skills/execution";

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
export function _CreateArtifactServiceReadPort(serviceUrl: string): { read(lease: string, contentAddress: string): Promise<Response> }
{
	return {
		async read(lease: string, contentAddress: string): Promise<Response>
		{
			if (!/^sha256:[a-f0-9]{64}$/u.test(contentAddress)) throw new Error("artifact read requires a canonical content address");
			const response = await fetch(`${serviceUrl}/v1/artifacts/content/${contentAddress.slice("sha256:".length)}`, { redirect: "error", headers: { "x-opencrane-artifact-lease": lease } });
			if (!response.ok || response.body === null) throw new Error(`artifact service read failed with ${response.status}`);
			return response;
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
export function _CreateSkillAuthoringArtifactReader(environment: NodeJS.ProcessEnv = process.env): SkillAuthoringArtifactReader
{
	return {
		async read(input: SkillAuthoringInputRecord): Promise<ReadableStream<Uint8Array>>
		{
			const serviceUrl = _InternalServiceUrl(environment.ARTIFACT_SERVICE_URL ?? "");
			const signLease = _CreateArtifactReadLeaseSigner(environment);
			const readPort = _CreateArtifactServiceReadPort(serviceUrl);
			const lease = signLease({ leaseId: randomUUID(), siloId: input.siloId, artifactId: input.artifactId, artifactRevisionId: input.artifactRevisionId, contentAddress: input.contentAddress, byteLength: input.byteLength, mediaType: input.mediaType, action: "artifact.read", expiresAtEpochSeconds: Math.floor(Date.now() / 1_000) + 60 });
			const response = await readPort.read(lease, input.contentAddress);
			if (response.headers.get("content-length") !== String(input.byteLength) || response.headers.get("content-type") !== input.mediaType) throw new Error("artifact service read metadata did not match the fenced revision");
			return response.body as ReadableStream<Uint8Array>;
		},
	};
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
