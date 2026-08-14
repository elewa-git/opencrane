import { describe, expect, it, vi } from "vitest";

import { __ClaimArtifactPreprocessJob, __IssueArtifactPreprocessOutputLease } from "../artifact-preprocessing";
import type { ArtifactPreprocessRepository } from "../artifact-preprocessing.types";

/** Build a complete repository mock while allowing focused method overrides. */
function _Repository(overrides: Partial<ArtifactPreprocessRepository> = {}): ArtifactPreprocessRepository
{
	return {
		claimNextAtomically: vi.fn().mockResolvedValue({ status: "none" }),
			issueSourceLeaseAtomically: vi.fn(),
		issueOutputLeaseAtomically: vi.fn(),
		completeAtomically: vi.fn(),
		failAtomically: vi.fn(),
		...overrides,
	};
}

describe("artifact preprocessing authority", function _Suite()
{
	it("projects a durable claim without leaking catalogue or storage coordinates", async function _Claims()
	{
		const repository = _Repository({ claimNextAtomically: vi.fn().mockResolvedValue({ status: "claimed", claim: { jobId: "job-1", attempt: 1, claimFence: "fence-1", claimExpiresAt: new Date("2026-07-26T15:00:00.000Z"), siloId: "silo-1", sourceArtifactId: "artifact-1", sourceRevisionId: "revision-1", sourceByteLength: 12 } }) });
		await expect(__ClaimArtifactPreprocessJob(repository)).resolves.toEqual({ lease: { jobId: "job-1", attempt: 1, claimFence: "fence-1", expiresAt: "2026-07-26T15:00:00.000Z" }, sourceMediaType: "application/pdf", sourceByteLength: 12 });
	});

	it("rejects unsafe output metadata before durable lease authority is consulted", async function _RejectsUnsafeOutput()
	{
		const issueOutputLeaseAtomically = vi.fn();
		const repository = _Repository({ issueOutputLeaseAtomically });
		await expect(__IssueArtifactPreprocessOutputLease(repository, { jobId: "job-1", attempt: 1, claimFence: "fence-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: Number.MAX_SAFE_INTEGER + 1 })).resolves.toBeNull();
		expect(issueOutputLeaseAtomically).not.toHaveBeenCalled();
	});
});
