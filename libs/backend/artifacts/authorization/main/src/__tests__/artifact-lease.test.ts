import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it } from "vitest";

import { __SignArtifactPromotionReceipt, __SignArtifactReadLease, __SignArtifactWriteLease, __VerifyArtifactPromotionReceipt, __VerifyArtifactReadLease, __VerifyArtifactWriteLease } from "../artifact-lease.js";

const _leaseKeys = generateKeyPairSync("ed25519");
const _receiptKeys = generateKeyPairSync("ed25519");
const _leasePrivateKey = _leaseKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const _leasePublicKey = _leaseKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
const _receiptPrivateKey = _receiptKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const _receiptPublicKey = _receiptKeys.publicKey.export({ type: "spki", format: "pem" }).toString();

/** Signs an adversarial payload without the production claim validator to exercise verification. */
function _SignUncheckedReadLease(payload: Record<string, unknown>): string
{
	const header = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT" })).toString("base64url");
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	const signingInput = `${header}.${body}`;
	return `${signingInput}.${sign(null, Buffer.from(signingInput), createPrivateKey(_leasePrivateKey)).toString("base64url")}`;
}

describe("ArtifactStore signed internal protocol", function _suite()
{
	it("accepts only an unexpired OpenCrane-signed write lease", function _leaseRoundTrip()
	{
		const compact = __SignArtifactWriteLease({ leaseId: "lease-1", siloId: "silo-1", artifactId: "artifact-1", action: "artifact.write", expiresAtEpochSeconds: 1_750_000_060, expectedContentAddress: null, expectedByteLength: null, mediaType: "text/plain" }, _leasePrivateKey, 1_750_000_000);
		expect(__VerifyArtifactWriteLease(compact, _leasePublicKey, 1_750_000_001)).toMatchObject({ leaseId: "lease-1", artifactId: "artifact-1" });
		expect(__VerifyArtifactWriteLease(compact, _receiptPublicKey, 1_750_000_001)).toBeNull();
		expect(__VerifyArtifactWriteLease(compact, _leasePublicKey, 1_750_000_061)).toBeNull();
	});

	it("rejects leases issued outside the symmetric five-minute clock-skew window", function _leaseIssuedAtWindow()
	{
		const now = 1_750_000_400;
		const atPastBoundary = __SignArtifactWriteLease({ leaseId: "lease-past-boundary", siloId: "silo-1", artifactId: "artifact-1", action: "artifact.write", expiresAtEpochSeconds: now + 60, expectedContentAddress: null, expectedByteLength: null, mediaType: "text/plain" }, _leasePrivateKey, now - 300);
		const beforePastBoundary = __SignArtifactWriteLease({ leaseId: "lease-too-old", siloId: "silo-1", artifactId: "artifact-1", action: "artifact.write", expiresAtEpochSeconds: now + 60, expectedContentAddress: null, expectedByteLength: null, mediaType: "text/plain" }, _leasePrivateKey, now - 301);
		const atFutureBoundary = __SignArtifactWriteLease({ leaseId: "lease-future-boundary", siloId: "silo-1", artifactId: "artifact-1", action: "artifact.write", expiresAtEpochSeconds: now + 600, expectedContentAddress: null, expectedByteLength: null, mediaType: "text/plain" }, _leasePrivateKey, now + 300);
		expect(__VerifyArtifactWriteLease(atPastBoundary, _leasePublicKey, now)).toMatchObject({ leaseId: "lease-past-boundary" });
		expect(__VerifyArtifactWriteLease(beforePastBoundary, _leasePublicKey, now)).toBeNull();
		expect(__VerifyArtifactWriteLease(atFutureBoundary, _leasePublicKey, now)).toMatchObject({ leaseId: "lease-future-boundary" });
	});

	it("keeps one immutable read lease distinct from upload authority", function _readLeaseRoundTrip()
	{
		const now = 1_750_000_000;
		const compact = __SignArtifactReadLease({ leaseId: "read-1", siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 12, mediaType: "application/gzip", action: "artifact.read", expiresAtEpochSeconds: now + 300 }, _leasePrivateKey, now);
		expect(__VerifyArtifactReadLease(compact, _leasePublicKey, now)).toMatchObject({ leaseId: "read-1", action: "artifact.read" });
		expect(__VerifyArtifactWriteLease(compact, _leasePublicKey, now)).toBeNull();
		expect(__VerifyArtifactReadLease(compact, _receiptPublicKey, now)).toBeNull();
		expect(__VerifyArtifactReadLease(compact, _leasePublicKey, now - 1)).toBeNull();
		expect(__VerifyArtifactReadLease(compact, _leasePublicKey, now + 300)).toBeNull();
	});

	it("rejects read leases longer than five minutes or with unsafe response media types", function _boundedReadLease()
	{
		const now = 1_750_000_000;
		const base = { leaseId: "read-1", siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 12, mediaType: "text/plain", action: "artifact.read" as const };
		expect(function _tooLongReadLease(): string { return __SignArtifactReadLease({ ...base, expiresAtEpochSeconds: now + 301 }, _leasePrivateKey, now); }).toThrow(/invalid artifact read lease claims/);
		expect(function _unsafeMediaType(): string { return __SignArtifactReadLease({ ...base, mediaType: "text/plain\r\nX-Injected: yes", expiresAtEpochSeconds: now + 60 }, _leasePrivateKey, now); }).toThrow(/invalid artifact read lease claims/);
		const parameterized = __SignArtifactReadLease({ ...base, mediaType: "text/plain; charset=utf-8", expiresAtEpochSeconds: now + 60 }, _leasePrivateKey, now);
		expect(__VerifyArtifactReadLease(parameterized, _leasePublicKey, now)).toMatchObject({ mediaType: "text/plain; charset=utf-8" });
		const overlongSignedPayload = _SignUncheckedReadLease({ typ: "opencrane.artifact-read-lease", aud: "artifact-service", iat: now, ...base, expiresAtEpochSeconds: now + 301 });
		expect(__VerifyArtifactReadLease(overlongSignedPayload, _leasePublicKey, now)).toBeNull();
	});

	it("keeps service promotion receipts distinct from write-lease authority", function _receiptRoundTrip()
	{
		const compact = __SignArtifactPromotionReceipt({ leaseId: "lease-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 12, mediaType: "text/plain", issuedAtEpochSeconds: 1_750_000_000 }, _receiptPrivateKey);
		expect(__VerifyArtifactPromotionReceipt(compact, _receiptPublicKey)).toMatchObject({ leaseId: "lease-1", byteLength: 12 });
		expect(__VerifyArtifactPromotionReceipt(`${compact}x`, _receiptPublicKey)).toBeNull();
	});
});
