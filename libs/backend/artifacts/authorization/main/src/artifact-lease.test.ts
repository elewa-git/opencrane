import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { __SignArtifactPromotionReceipt, __SignArtifactWriteLease, __VerifyArtifactPromotionReceipt, __VerifyArtifactWriteLease } from "./artifact-lease.js";

const _leaseKeys = generateKeyPairSync("ed25519");
const _receiptKeys = generateKeyPairSync("ed25519");
const _leasePrivateKey = _leaseKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const _leasePublicKey = _leaseKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
const _receiptPrivateKey = _receiptKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const _receiptPublicKey = _receiptKeys.publicKey.export({ type: "spki", format: "pem" }).toString();

describe("ArtifactStore signed internal protocol", function _suite()
{
	it("accepts only an unexpired OpenCrane-signed write lease", function _leaseRoundTrip()
	{
		const compact = __SignArtifactWriteLease({ leaseId: "lease-1", siloId: "silo-1", artifactId: "artifact-1", action: "artifact.write", expiresAtEpochSeconds: 1_750_000_060, expectedContentAddress: null, expectedByteLength: null, mediaType: "text/plain" }, _leasePrivateKey, 1_750_000_000);
		expect(__VerifyArtifactWriteLease(compact, _leasePublicKey, 1_750_000_001)).toMatchObject({ leaseId: "lease-1", artifactId: "artifact-1" });
		expect(__VerifyArtifactWriteLease(compact, _receiptPublicKey, 1_750_000_001)).toBeNull();
		expect(__VerifyArtifactWriteLease(compact, _leasePublicKey, 1_750_000_061)).toBeNull();
	});

	it("keeps service promotion receipts distinct from write-lease authority", function _receiptRoundTrip()
	{
		const compact = __SignArtifactPromotionReceipt({ leaseId: "lease-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 12, mediaType: "text/plain", issuedAtEpochSeconds: 1_750_000_000 }, _receiptPrivateKey);
		expect(__VerifyArtifactPromotionReceipt(compact, _receiptPublicKey)).toMatchObject({ leaseId: "lease-1", byteLength: 12 });
		expect(__VerifyArtifactPromotionReceipt(`${compact}x`, _receiptPublicKey)).toBeNull();
	});
});
