import { describe, expect, it, vi } from "vitest";

import { __IssueArtifactReadLease } from "../artifact-read-lease";
import { IssueArtifactReadLeaseOutcomes, type PublishedArtifactReadTarget } from "../artifact-read-lease.types";

/** Build one exact active published revision returned by the server-owned repository. */
function _Target(overrides: Partial<PublishedArtifactReadTarget> = {}): PublishedArtifactReadTarget
{
	return { siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 12, mediaType: "text/plain", ...overrides };
}

describe("ArtifactStore read lease issuer", function _Suite()
{
	it("issues only server-loaded active published facts with a five-minute lifetime", async function _Issues()
	{
		const signer = { sign: vi.fn().mockReturnValue("compact-read-lease") };
		const repository = { loadPublishedReadTarget: vi.fn().mockResolvedValue(_Target({ mediaType: "text/plain; charset=utf-8" })) };
		const result = await __IssueArtifactReadLease(repository, signer, { siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1" }, 1_750_000_000);

		expect(result).toMatchObject({ outcome: IssueArtifactReadLeaseOutcomes.Issued, compactLease: "compact-read-lease", claims: { siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", contentAddress: _Target().contentAddress, byteLength: 12, mediaType: "text/plain; charset=utf-8", expiresAtEpochSeconds: 1_750_000_300 } });
		expect(signer.sign).toHaveBeenCalledWith(expect.objectContaining({ action: "artifact.read" }));
	});

	it("rejects malformed coordinates before querying or signing", async function _RejectsMalformedCommand()
	{
		const repository = { loadPublishedReadTarget: vi.fn() };
		const signer = { sign: vi.fn() };

		await expect(__IssueArtifactReadLease(repository, signer, { siloId: "../silo", artifactId: "artifact-1", artifactRevisionId: "revision-1" }, 1_750_000_000)).resolves.toEqual({ outcome: IssueArtifactReadLeaseOutcomes.Denied, reason: "invalid_command" });
		expect(repository.loadPublishedReadTarget).not.toHaveBeenCalled();
		expect(signer.sign).not.toHaveBeenCalled();
	});

	it.each([
		["a different revision", _Target({ artifactRevisionId: "revision-2" })],
		["an unsafe byte length", _Target({ byteLength: Number.MAX_SAFE_INTEGER + 1 })],
		["a header-unsafe media type", _Target({ mediaType: "text/plain\r\nx-injected: yes" })],
		["an invalid content address", _Target({ contentAddress: "sha256:not-a-digest" })],
	])("fails closed for %s returned by the repository", async function _RejectsTarget(_name, target)
	{
		const signer = { sign: vi.fn() };
		const result = await __IssueArtifactReadLease({ loadPublishedReadTarget: vi.fn().mockResolvedValue(target) }, signer, { siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1" }, 1_750_000_000);

		expect(result).toEqual({ outcome: IssueArtifactReadLeaseOutcomes.Denied, reason: "revision_not_readable" });
		expect(signer.sign).not.toHaveBeenCalled();
	});
});
