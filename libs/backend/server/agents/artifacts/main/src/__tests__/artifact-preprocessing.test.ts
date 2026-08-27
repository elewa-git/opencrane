import { describe, expect, it, vi } from "vitest";

import { __IssueArtifactPreprocessOutputLease } from "../artifact-preprocessing";
import type { ArtifactPreprocessRepository } from "../artifact-preprocessing.types";

/** Build a complete repository mock while allowing focused method overrides. */
function _Repository(overrides: Partial<ArtifactPreprocessRepository> = {}): ArtifactPreprocessRepository
{
	return {
		loadWorkerBootstrap: vi.fn(),
		claimForTask: vi.fn(),
		bindWorkload: vi.fn(),
		bindFirstPod: vi.fn(),
		loadCompletion: vi.fn(),
		complete: vi.fn(),
		issueSourceLeaseAtomically: vi.fn(),
		issueOutputLeaseAtomically: vi.fn(),
		completeAtomically: vi.fn(),
		failAtomically: vi.fn(),
		...overrides,
	};
}

describe("artifact preprocessing authority", function _Suite()
{
	it("rejects unsafe output metadata before durable lease authority is consulted", async function _RejectsUnsafeOutput()
	{
		const issueOutputLeaseAtomically = vi.fn();
		const repository = _Repository({ issueOutputLeaseAtomically });
		await expect(__IssueArtifactPreprocessOutputLease(repository, { jobId: "job-1", attempt: 1, claimFence: "fence-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: Number.MAX_SAFE_INTEGER + 1 })).resolves.toBeNull();
		expect(issueOutputLeaseAtomically).not.toHaveBeenCalled();
	});
});
