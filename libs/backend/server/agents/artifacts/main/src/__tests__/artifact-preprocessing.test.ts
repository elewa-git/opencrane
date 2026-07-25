import { describe, expect, it, vi } from "vitest";

import { __ClaimArtifactPreprocessJob, __CompleteArtifactPreprocessJob, __IssueArtifactPreprocessOutputLease } from "../artifact-preprocessing.js";
import type { ArtifactPreprocessRepository } from "../artifact-preprocessing.types.js";

/** Fixed live claim projection used to exercise worker-facing capability shaping. */
function _Claim()
{
	return { jobId: "job-1", attempt: 1, claimFence: "fence-1", claimExpiresAt: new Date("2026-07-23T12:00:00.000Z"), sourceArtifactId: "source-artifact-1", sourceRevisionId: "source-revision-1", siloId: "silo-1", sourceContentAddress: `sha256:${"a".repeat(64)}`, sourceByteLength: 42, derivedArtifactId: "derived-artifact-1" };
}

/** Builds the smallest preprocessing authority surface required by the pure workflow functions. */
function _Repository(overrides: Partial<ArtifactPreprocessRepository> = {}): ArtifactPreprocessRepository
{
	return { claimNextAtomically: vi.fn().mockResolvedValue({ status: "none" }), issueOutputLeaseAtomically: vi.fn(), completeAtomically: vi.fn(), ...overrides } as ArtifactPreprocessRepository;
}

/** Builds deterministic compact-capability emitters without holding test key material. */
function _Signer()
{
	return { signReadLease: vi.fn().mockReturnValue("signed-read-lease"), signWriteLease: vi.fn().mockReturnValue("signed-write-lease") };
}

describe("artifact preprocessing authority", function _DescribeAuthority()
{
	it("returns only an exact source read lease for the freshly fenced claim", async function _ClaimExactSource()
	{
		const repository = _Repository({ claimNextAtomically: vi.fn().mockResolvedValue({ status: "claimed", claim: _Claim() }) });
		const signer = _Signer();

		const result = await __ClaimArtifactPreprocessJob(repository, signer);

		expect(result).toMatchObject({ sourceRevisionId: "source-revision-1", sourceContentAddress: _Claim().sourceContentAddress, sourceMediaType: "application/pdf", sourceReadLease: "signed-read-lease" });
		expect(signer.signReadLease).toHaveBeenCalledWith(expect.objectContaining({ siloId: "silo-1", artifactId: "source-artifact-1", artifactRevisionId: "source-revision-1", contentAddress: _Claim().sourceContentAddress, byteLength: 42, action: "artifact.read", mediaType: "application/pdf" }));
	});

	it("does not ask the database for an invalid caller-supplied output coordinate", async function _RejectInvalidOutput()
	{
		const repository = _Repository();
		const signer = _Signer();

		const result = await __IssueArtifactPreprocessOutputLease(repository, signer, { jobId: "job-1", attempt: 1, claimFence: "fence-1", contentAddress: "not-a-content-address", byteLength: 12 });

		expect(result).toBeNull();
		expect(repository.issueOutputLeaseAtomically).not.toHaveBeenCalled();
	});

	it("signs only the exact durable write lease returned by the repository", async function _IssueExactOutput()
	{
		const repository = _Repository({ issueOutputLeaseAtomically: vi.fn().mockResolvedValue({ status: "issued", lease: { jobId: "job-1", attempt: 1, claimFence: "fence-1", derivedRevisionId: "artifact-preprocess:lease-1", writeLease: { leaseId: "lease-1", siloId: "silo-1", artifactId: "derived-artifact-1", action: "artifact.write", expiresAtEpochSeconds: 1_784_779_200, expectedContentAddress: `sha256:${"b".repeat(64)}`, expectedByteLength: 12, mediaType: "text/plain" } } }) });
		const signer = _Signer();

		const result = await __IssueArtifactPreprocessOutputLease(repository, signer, { jobId: "job-1", attempt: 1, claimFence: "fence-1", contentAddress: `sha256:${"b".repeat(64)}`, byteLength: 12 });

		expect(result).toMatchObject({ derivedRevisionId: "artifact-preprocess:lease-1", artifactWriteLease: "signed-write-lease" });
		expect(signer.signWriteLease).toHaveBeenCalledWith(expect.objectContaining({ leaseId: "lease-1", expectedContentAddress: `sha256:${"b".repeat(64)}`, expectedByteLength: 12, mediaType: "text/plain" }));
	});

	it("returns false when durable receipt completion rejects a stale claim", async function _RejectStaleCompletion()
	{
		const repository = _Repository({ completeAtomically: vi.fn().mockResolvedValue({ status: "conflict", reason: "stale_claim" }) });

		const result = await __CompleteArtifactPreprocessJob(repository, { jobId: "job-1", attempt: 1, claimFence: "fence-1", derivedRevisionId: "artifact-preprocess:lease-1", promotion: { leaseId: "lease-1", contentAddress: `sha256:${"b".repeat(64)}`, byteLength: 12, mediaType: "text/plain", issuedAtEpochSeconds: 1 }, receiptDigest: `sha256:${"c".repeat(64)}` });

		expect(result).toBe(false);
	});
});
