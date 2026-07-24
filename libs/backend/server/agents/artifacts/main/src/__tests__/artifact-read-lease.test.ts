import { describe, expect, it, vi } from "vitest";

import { __IssueArtifactReadLease } from "../artifact-read-lease.js";

/** Build one exact active published revision returned by the server-owned repository. */
function _Target()
{
	return { siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 12, mediaType: "text/plain" };
}

describe("ArtifactStore read lease issuer", function _suite()
{
	it("issues only server-loaded active published revision facts with a five-minute lifetime", async function _issues()
	{
		const signer = { sign: vi.fn().mockReturnValue("compact-read-lease") };
		const result = await __IssueArtifactReadLease({ loadPublishedReadTarget: vi.fn().mockResolvedValue(_Target()) }, signer, { siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1" }, 1_750_000_000);

		expect(result).toMatchObject({ outcome: "issued", compactLease: "compact-read-lease", claims: { siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", contentAddress: _Target().contentAddress, byteLength: 12, expiresAtEpochSeconds: 1_750_000_300 } });
		expect(signer.sign).toHaveBeenCalledWith(expect.objectContaining({ action: "artifact.read" }));
	});

	it("fails closed when the repository cannot prove the requested active published revision", async function _denies()
	{
		const signer = { sign: vi.fn() };
		const result = await __IssueArtifactReadLease({ loadPublishedReadTarget: vi.fn().mockResolvedValue({ ..._Target(), artifactRevisionId: "other-revision" }) }, signer, { siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1" }, 1_750_000_000);

		expect(result).toEqual({ outcome: "denied", reason: "revision_not_readable" });
		expect(signer.sign).not.toHaveBeenCalled();
	});
});
