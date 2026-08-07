import { describe, expect, it, vi } from "vitest";

import { __FinalizeArtifactRevision } from "../artifact-finalization.js";

describe("artifact finalization", function ()
{
	it("commits only exact ArtifactStore promotion metadata", async function ()
	{
		const finalizeRevisionAtomically = vi.fn().mockResolvedValue({ status: "finalized" });
		const result = await __FinalizeArtifactRevision({ finalizeRevisionAtomically }, { artifactId: "artifact-1", revision: 1, artifactRevisionId: "revision-1", createdBy: "user-1", provenance: { source: "upload" }, idempotencyKey: "finalize-1", promotion: { leaseId: "lease-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 12, mediaType: "text/plain", receiptDigest: `sha256:${"b".repeat(64)}` } });
		expect(result).toEqual({ outcome: "finalized", idempotent: false });
		expect(finalizeRevisionAtomically).toHaveBeenCalledOnce();
	});

	it("rejects a non-content-addressed storage receipt", async function ()
	{
		const finalizeRevisionAtomically = vi.fn();
		const result = await __FinalizeArtifactRevision({ finalizeRevisionAtomically }, { artifactId: "artifact-1", revision: 1, artifactRevisionId: "revision-1", createdBy: "user-1", provenance: {}, idempotencyKey: "finalize-1", promotion: { leaseId: "lease-1", contentAddress: "path/on/disk", byteLength: 12, mediaType: "text/plain", receiptDigest: `sha256:${"b".repeat(64)}` } });
		expect(result).toEqual({ outcome: "denied", reason: "invalid_command" });
		expect(finalizeRevisionAtomically).not.toHaveBeenCalled();
	});
});
