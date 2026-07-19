import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

import { ___CanonicalizeJson } from "@opencrane/util";

import type { ArtifactPromotionReceiptClaims, ArtifactWriteLeaseClaims } from "./artifact-lease.types.js";

const _LEASE_AUDIENCE = "artifact-service";
const _LEASE_TYPE = "opencrane.artifact-write-lease";
const _RECEIPT_AUDIENCE = "opencrane";
const _RECEIPT_TYPE = "opencrane.artifact-promotion-receipt";

/** Sign one exact short-lived artifact write lease with an OpenCrane Ed25519 private key. */
export function __SignArtifactWriteLease(claims: ArtifactWriteLeaseClaims, privateKeyPem: string, nowEpochSeconds: number): string
{
	if (!_isLease(claims, nowEpochSeconds)) throw new Error("invalid artifact write lease claims");
	return _sign({ typ: _LEASE_TYPE, aud: _LEASE_AUDIENCE, iat: nowEpochSeconds, ...claims }, privateKeyPem);
}

/** Verify an artifact-service lease before any byte staging begins. */
export function __VerifyArtifactWriteLease(compact: string, publicKeyPem: string, nowEpochSeconds: number): ArtifactWriteLeaseClaims | null
{
	const payload = _verify(compact, publicKeyPem);
	const issuedAt = payload?.iat;
	if (payload === null || payload.typ !== _LEASE_TYPE || payload.aud !== _LEASE_AUDIENCE || typeof issuedAt !== "number" || !Number.isSafeInteger(issuedAt) || issuedAt < nowEpochSeconds - 300 || issuedAt > nowEpochSeconds + 300) return null;
	const claims = _leaseFromPayload(payload);
	return claims !== null && _isLease(claims, nowEpochSeconds) ? claims : null;
}

/** Sign promotion facts with the service's distinct Ed25519 receipt key. */
export function __SignArtifactPromotionReceipt(claims: ArtifactPromotionReceiptClaims, privateKeyPem: string): string
{
	if (!_isReceipt(claims)) throw new Error("invalid artifact promotion receipt claims");
	return _sign({ typ: _RECEIPT_TYPE, aud: _RECEIPT_AUDIENCE, ...claims }, privateKeyPem);
}

/** Verify a receipt before OpenCrane consumes its durable promotion digest. */
export function __VerifyArtifactPromotionReceipt(compact: string, publicKeyPem: string): ArtifactPromotionReceiptClaims | null
{
	const payload = _verify(compact, publicKeyPem);
	if (payload === null || payload.typ !== _RECEIPT_TYPE || payload.aud !== _RECEIPT_AUDIENCE) return null;
	const claims = _receiptFromPayload(payload);
	return claims !== null && _isReceipt(claims) ? claims : null;
}

/** Build and sign strict compact JWS JSON without accepting arbitrary algorithms. */
function _sign(payload: Record<string, unknown>, privateKeyPem: string): string
{
	const header = Buffer.from(___CanonicalizeJson({ alg: "EdDSA", typ: "JWT" } as never)).toString("base64url");
	const body = Buffer.from(___CanonicalizeJson(payload as never)).toString("base64url");
	const signingInput = `${header}.${body}`;
	return `${signingInput}.${sign(null, Buffer.from(signingInput), createPrivateKey(privateKeyPem)).toString("base64url")}`;
}

/** Verify Ed25519 JWS signatures and parse only object payloads. */
function _verify(compact: string, publicKeyPem: string): Record<string, unknown> | null
{
	const parts = compact.split(".");
	if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/u.test(part))) return null;
	try
	{
		const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Record<string, unknown>;
		if (header.alg !== "EdDSA" || header.typ !== "JWT" || !verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey(publicKeyPem), Buffer.from(parts[2], "base64url"))) return null;
		const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as unknown;
		return typeof payload === "object" && payload !== null && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
	}
	catch { return null; }
}

function _leaseFromPayload(value: Record<string, unknown>): ArtifactWriteLeaseClaims | null
{
	return typeof value.leaseId === "string" && typeof value.siloId === "string" && typeof value.artifactId === "string" && value.action === "artifact.write" && Number.isSafeInteger(value.expiresAtEpochSeconds) && (typeof value.expectedContentAddress === "string" || value.expectedContentAddress === null) && (Number.isSafeInteger(value.expectedByteLength) || value.expectedByteLength === null) && typeof value.mediaType === "string" ? value as unknown as ArtifactWriteLeaseClaims : null;
}

function _receiptFromPayload(value: Record<string, unknown>): ArtifactPromotionReceiptClaims | null
{
	return typeof value.leaseId === "string" && typeof value.contentAddress === "string" && Number.isSafeInteger(value.byteLength) && typeof value.mediaType === "string" && Number.isSafeInteger(value.issuedAtEpochSeconds) ? value as unknown as ArtifactPromotionReceiptClaims : null;
}

function _isLease(value: ArtifactWriteLeaseClaims, now: number): boolean
{
	return value.leaseId.trim().length > 0 && value.siloId.trim().length > 0 && value.artifactId.trim().length > 0 && value.action === "artifact.write" && Number.isSafeInteger(value.expiresAtEpochSeconds) && value.expiresAtEpochSeconds > now && (value.expectedContentAddress === null || /^sha256:[0-9a-f]{64}$/u.test(value.expectedContentAddress)) && (value.expectedByteLength === null || (Number.isSafeInteger(value.expectedByteLength) && value.expectedByteLength >= 0)) && value.mediaType.includes("/");
}

function _isReceipt(value: ArtifactPromotionReceiptClaims): boolean
{
	return value.leaseId.trim().length > 0 && /^sha256:[0-9a-f]{64}$/u.test(value.contentAddress) && Number.isSafeInteger(value.byteLength) && value.byteLength >= 0 && value.mediaType.includes("/") && Number.isSafeInteger(value.issuedAtEpochSeconds) && value.issuedAtEpochSeconds >= 0;
}
