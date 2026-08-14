import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

import { ___CanonicalizeJson, ___ParseAndValidateJson } from "@opencrane/util";

import { __IsSafeArtifactMediaType } from "./artifact-media-type";
import type { ArtifactPromotionReceiptClaims, ArtifactReadLeaseClaims, ArtifactWriteLeaseClaims } from "./artifact-lease.types";

const _LEASE_AUDIENCE = "artifact-service";
const _LEASE_TYPE = "opencrane.artifact-write-lease";
const _READ_LEASE_TYPE = "opencrane.artifact-read-lease";
const _RECEIPT_AUDIENCE = "opencrane";
const _RECEIPT_TYPE = "opencrane.artifact-promotion-receipt";

/**
 * Sign a short-lived lease permitting one artifact upload.
 *
 * OpenCrane issues the lease; artifact-service verifies it with
 * {@link __VerifyArtifactWriteLease} and will not accept a single byte without one. The lease
 * pins the expected content address, byte length, and media type, so a caller cannot upload
 * different bytes than the ones authorized.
 *
 * Called by: `apps/opencrane/src/infra/artifacts/artifact-upload.factory.ts`.
 * @param claims - What the lease permits; validated before signing.
 * @param privateKeyPem - OpenCrane's Ed25519 signing key, PEM encoded.
 * @param nowEpochSeconds - Current time, recorded as the lease's `iat`.
 * @returns A compact JWS string to hand the uploading client.
 * @throws Error when the claims are invalid — a blank id, an expiry already in the past, a malformed content address or byte length, or an unsafe media type. Nothing is signed in that case.
 */
export function __SignArtifactWriteLease(claims: ArtifactWriteLeaseClaims, privateKeyPem: string, nowEpochSeconds: number): string
{
	if (!_isLease(claims, nowEpochSeconds)) throw new Error("invalid artifact write lease claims");
	return _sign({ typ: _LEASE_TYPE, aud: _LEASE_AUDIENCE, iat: nowEpochSeconds, ...claims }, privateKeyPem);
}

/**
 * Verify an upload lease before artifact-service accepts any bytes.
 *
 * Checks the Ed25519 signature, that the lease is of the write type and addressed to
 * artifact-service, that it was issued within five minutes either side of now, and that its
 * claims are still valid and unexpired. Returns null rather than throwing, so a caller must treat
 * null as "reject the request" and must not proceed on a falsy result.
 *
 * Called by: `apps/artifact-service/src/server.ts`.
 * @param compact - The compact JWS presented by the client.
 * @param publicKeyPem - OpenCrane's Ed25519 public key, PEM encoded.
 * @param nowEpochSeconds - Current time.
 * @returns The verified claims, or null for any failure — bad signature, wrong type or audience, clock skew beyond five minutes, or expired.
 */
export function __VerifyArtifactWriteLease(compact: string, publicKeyPem: string, nowEpochSeconds: number): ArtifactWriteLeaseClaims | null
{
	const payload = _verify(compact, publicKeyPem);
	const issuedAt = payload?.iat;
	if (payload === null || payload.typ !== _LEASE_TYPE || payload.aud !== _LEASE_AUDIENCE || typeof issuedAt !== "number" || !Number.isSafeInteger(issuedAt) || issuedAt < nowEpochSeconds - 300 || issuedAt > nowEpochSeconds + 300) return null;
	const claims = _leaseFromPayload(payload);
	return claims !== null && _isLease(claims, nowEpochSeconds) ? claims : null;
}

/**
 * Sign a short-lived lease permitting one artifact read.
 *
 * Separate from a write lease by its `typ`, so the two can never be swapped. A read lease may not
 * live longer than five minutes, and it pins the exact revision, content address, byte length, and
 * media type artifact-service must serve.
 *
 * Called by: `apps/opencrane/src/infra/artifacts/artifact-read-lease-signer.factory.ts`.
 * @param claims - What the lease permits; validated before signing.
 * @param privateKeyPem - OpenCrane's Ed25519 signing key, PEM encoded.
 * @param nowEpochSeconds - Current time, recorded as the lease's `iat`.
 * @returns A compact JWS string.
 * @throws Error when the claims are invalid, including an expiry more than 300 seconds ahead.
 */
export function __SignArtifactReadLease(claims: ArtifactReadLeaseClaims, privateKeyPem: string, nowEpochSeconds: number): string
{
	if (!_isReadLease(claims, nowEpochSeconds)) throw new Error("invalid artifact read lease claims");
	return _sign({ typ: _READ_LEASE_TYPE, aud: _LEASE_AUDIENCE, iat: nowEpochSeconds, ...claims }, privateKeyPem);
}

/**
 * Verify a read lease before artifact-service streams any bytes.
 *
 * Checks the signature, the read `typ` and audience, that the lease was issued in the last five
 * minutes and not in the future, and that it has not expired. Returns null rather than throwing,
 * so a caller must treat null as "reject the request".
 *
 * Called by: `apps/artifact-service/src/server.ts`.
 * @param compact - The compact JWS presented by the client.
 * @param publicKeyPem - OpenCrane's Ed25519 public key, PEM encoded.
 * @param nowEpochSeconds - Current time.
 * @returns The verified claims, or null for any failure.
 */
export function __VerifyArtifactReadLease(compact: string, publicKeyPem: string, nowEpochSeconds: number): ArtifactReadLeaseClaims | null
{
	const payload = _verify(compact, publicKeyPem);
	const issuedAt = payload?.iat;
	if (payload === null || payload.typ !== _READ_LEASE_TYPE || payload.aud !== _LEASE_AUDIENCE || typeof issuedAt !== "number" || !Number.isSafeInteger(issuedAt) || issuedAt < nowEpochSeconds - 300 || issuedAt > nowEpochSeconds) return null;
	const claims = _readLeaseFromPayload(payload);
	return claims !== null && _isReadLease(claims, issuedAt) && claims.expiresAtEpochSeconds > nowEpochSeconds ? claims : null;
}

/**
 * Sign a receipt proving artifact-service durably stored one object.
 *
 * Signed with artifact-service's OWN key, deliberately not OpenCrane's lease key, so a receipt can
 * never be forged by whoever can mint a lease. OpenCrane verifies it with
 * {@link __VerifyArtifactPromotionReceipt} before it records a catalog revision.
 *
 * Called by: `apps/artifact-service/src/server.ts`.
 * @param claims - The lease id, content address, byte length, media type, and issue time.
 * @param privateKeyPem - artifact-service's Ed25519 receipt key, PEM encoded.
 * @returns A compact JWS string for OpenCrane to verify.
 * @throws Error when the claims are invalid, so an unverifiable receipt is never produced.
 */
export function __SignArtifactPromotionReceipt(claims: ArtifactPromotionReceiptClaims, privateKeyPem: string): string
{
	if (!_isReceipt(claims)) throw new Error("invalid artifact promotion receipt claims");
	return _sign({ typ: _RECEIPT_TYPE, aud: _RECEIPT_AUDIENCE, ...claims }, privateKeyPem);
}

/**
 * Verify an artifact-service receipt before OpenCrane records a catalog revision.
 *
 * Unlike the leases, a receipt has no expiry — it is a statement that bytes exist, which does not
 * stop being true. Returns null rather than throwing, so a caller must treat null as "do not
 * record the revision".
 *
 * Called by: `apps/opencrane/src/infra/artifacts/artifact-upload.factory.ts`.
 * @param compact - The compact JWS receipt.
 * @param publicKeyPem - artifact-service's Ed25519 receipt public key, PEM encoded.
 * @returns The verified claims, or null when the signature, type, audience, or claim shape fails.
 */
export function __VerifyArtifactPromotionReceipt(compact: string, publicKeyPem: string): ArtifactPromotionReceiptClaims | null
{
	const payload = _verify(compact, publicKeyPem);
	if (payload === null || payload.typ !== _RECEIPT_TYPE || payload.aud !== _RECEIPT_AUDIENCE) return null;
	const claims = _receiptFromPayload(payload);
	return claims !== null && _isReceipt(claims) ? claims : null;
}

/** Build a compact JWS with a fixed `EdDSA` header over RFC 8785 canonical JSON, so the algorithm can never be chosen by an attacker and the same claims always produce the same signing input. @see https://www.rfc-editor.org/rfc/rfc8785 */
function _sign(payload: Record<string, unknown>, privateKeyPem: string): string
{
	const header = Buffer.from(___CanonicalizeJson({ alg: "EdDSA", typ: "JWT" } as never)).toString("base64url");
	const body = Buffer.from(___CanonicalizeJson(payload as never)).toString("base64url");
	const signingInput = `${header}.${body}`;
	return `${signingInput}.${sign(null, Buffer.from(signingInput), createPrivateKey(privateKeyPem)).toString("base64url")}`;
}

/** Verify a compact JWS, accepting only an `EdDSA` header and only an object payload. Returns null on any failure, including malformed base64url segments. */
function _verify(compact: string, publicKeyPem: string): Record<string, unknown> | null
{
	const parts = compact.split(".");
	if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/u.test(part))) return null;
	try
	{
		const header = ___ParseAndValidateJson(Buffer.from(parts[0], "base64url").toString("utf8"), "artifact JWS protected header", _ObjectPayload);
		if (header.alg !== "EdDSA" || header.typ !== "JWT" || !verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey(publicKeyPem), Buffer.from(parts[2], "base64url"))) return null;
		return ___ParseAndValidateJson(Buffer.from(parts[1], "base64url").toString("utf8"), "artifact JWS payload", _ObjectPayload);
	}
	catch { return null; }
}

/** Require one decoded JWS component to be a non-array object. */
function _ObjectPayload(value: unknown): Record<string, unknown>
{
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("artifact JWS component must be an object");
	return value as Record<string, unknown>;
}

function _leaseFromPayload(value: Record<string, unknown>): ArtifactWriteLeaseClaims | null
{
	return typeof value.leaseId === "string" && typeof value.siloId === "string" && typeof value.artifactId === "string" && value.action === "artifact.write" && Number.isSafeInteger(value.expiresAtEpochSeconds) && (typeof value.expectedContentAddress === "string" || value.expectedContentAddress === null) && (Number.isSafeInteger(value.expectedByteLength) || value.expectedByteLength === null) && typeof value.mediaType === "string" ? value as unknown as ArtifactWriteLeaseClaims : null;
}

/** Return the payload as read-lease claims when every expected field has the right type, or null. Field types only — validity and expiry are checked separately. */
function _readLeaseFromPayload(value: Record<string, unknown>): ArtifactReadLeaseClaims | null
{
	return typeof value.leaseId === "string" && typeof value.siloId === "string" && typeof value.artifactId === "string" && typeof value.artifactRevisionId === "string" && typeof value.contentAddress === "string" && Number.isSafeInteger(value.byteLength) && typeof value.mediaType === "string" && value.action === "artifact.read" && Number.isSafeInteger(value.expiresAtEpochSeconds) ? value as unknown as ArtifactReadLeaseClaims : null;
}

function _receiptFromPayload(value: Record<string, unknown>): ArtifactPromotionReceiptClaims | null
{
	return typeof value.leaseId === "string" && typeof value.contentAddress === "string" && Number.isSafeInteger(value.byteLength) && typeof value.mediaType === "string" && Number.isSafeInteger(value.issuedAtEpochSeconds) ? value as unknown as ArtifactPromotionReceiptClaims : null;
}

function _isLease(value: ArtifactWriteLeaseClaims, now: number): boolean
{
	return value.leaseId.trim().length > 0 && value.siloId.trim().length > 0 && value.artifactId.trim().length > 0 && value.action === "artifact.write" && Number.isSafeInteger(value.expiresAtEpochSeconds) && value.expiresAtEpochSeconds > now && (value.expectedContentAddress === null || /^sha256:[0-9a-f]{64}$/u.test(value.expectedContentAddress)) && (value.expectedByteLength === null || (Number.isSafeInteger(value.expectedByteLength) && value.expectedByteLength >= 0)) && __IsSafeArtifactMediaType(value.mediaType);
}

/** Whether read-lease claims are usable: non-blank ids, a well-formed content address, a non-negative byte length, a safe media type, the read action, and an expiry that is in the future and no more than 300 seconds away. */
function _isReadLease(value: ArtifactReadLeaseClaims, now: number): boolean
{
	return value.leaseId.trim().length > 0 && value.siloId.trim().length > 0 && value.artifactId.trim().length > 0 && value.artifactRevisionId.trim().length > 0 && /^sha256:[0-9a-f]{64}$/u.test(value.contentAddress) && Number.isSafeInteger(value.byteLength) && value.byteLength >= 0 && __IsSafeArtifactMediaType(value.mediaType) && value.action === "artifact.read" && Number.isSafeInteger(value.expiresAtEpochSeconds) && value.expiresAtEpochSeconds > now && value.expiresAtEpochSeconds <= now + 300;
}

function _isReceipt(value: ArtifactPromotionReceiptClaims): boolean
{
	return value.leaseId.trim().length > 0 && /^sha256:[0-9a-f]{64}$/u.test(value.contentAddress) && Number.isSafeInteger(value.byteLength) && value.byteLength >= 0 && __IsSafeArtifactMediaType(value.mediaType) && Number.isSafeInteger(value.issuedAtEpochSeconds) && value.issuedAtEpochSeconds >= 0;
}
