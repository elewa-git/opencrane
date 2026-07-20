import { describe, expect, it, vi } from "vitest";

import { __UploadArtifact } from "../artifact-upload.js";

const _address = `sha256:${"a".repeat(64)}`;
const _receiptDigest = `sha256:${"b".repeat(64)}`;

function _command()
{
	return { artifactId: "artifact-1", siloId: "silo-1", capabilityJti: "capability-1", expectedContentAddress: _address, expectedByteLength: 12, mediaType: "text/plain", expiresAtEpochSeconds: 1_750_000_060, createdBy: "user-1", revision: 1, artifactRevisionId: "revision-1", provenance: { source: "upload" }, idempotencyKey: "finalize-1", bytes: (async function* _bytes(): AsyncIterable<Uint8Array> { yield Buffer.from("opencrane"); })() };
}

describe("proof-authorized artifact upload", function _suite()
{
	it("issues a durable lease, promotes only with its signed lease, and finalizes only the verified receipt", async function _workflow()
	{
		const finalizeRevisionAtomically = vi.fn().mockResolvedValue({ status: "finalized" });
		const result = await __UploadArtifact({ issueLeaseAtomically: vi.fn().mockResolvedValue({ status: "issued", lease: { leaseId: "lease-1", siloId: "silo-1", artifactId: "artifact-1", action: "artifact.write", expiresAtEpochSeconds: 1_750_000_060, expectedContentAddress: _address, expectedByteLength: 12, mediaType: "text/plain" } }), finalizeRevisionAtomically }, { promote: vi.fn().mockResolvedValue({ receipt: "service-receipt" }) }, { signLease: vi.fn().mockReturnValue("signed-lease"), verifyReceipt: vi.fn().mockReturnValue({ leaseId: "lease-1", contentAddress: _address, byteLength: 12, mediaType: "text/plain", issuedAtEpochSeconds: 1_750_000_000 }), digestReceipt: vi.fn().mockReturnValue(_receiptDigest) }, _command());
		expect(result).toEqual({ outcome: "finalized", idempotent: false });
		expect(finalizeRevisionAtomically).toHaveBeenCalledWith(expect.objectContaining({ promotion: expect.objectContaining({ leaseId: "lease-1", receiptDigest: _receiptDigest }) }));
	});

	it("never finalizes a receipt that differs from its durable lease", async function _mismatch()
	{
		const finalizeRevisionAtomically = vi.fn();
		const result = await __UploadArtifact({ issueLeaseAtomically: vi.fn().mockResolvedValue({ status: "issued", lease: { leaseId: "lease-1", siloId: "silo-1", artifactId: "artifact-1", action: "artifact.write", expiresAtEpochSeconds: 1_750_000_060, expectedContentAddress: _address, expectedByteLength: 12, mediaType: "text/plain" } }), finalizeRevisionAtomically }, { promote: vi.fn().mockResolvedValue({ receipt: "forged-receipt" }) }, { signLease: vi.fn().mockReturnValue("signed-lease"), verifyReceipt: vi.fn().mockReturnValue({ leaseId: "other-lease", contentAddress: _address, byteLength: 12, mediaType: "text/plain", issuedAtEpochSeconds: 1_750_000_000 }), digestReceipt: vi.fn() }, _command());
		expect(result).toEqual({ outcome: "denied", reason: "promotion_invalid" });
		expect(finalizeRevisionAtomically).not.toHaveBeenCalled();
	});
});
