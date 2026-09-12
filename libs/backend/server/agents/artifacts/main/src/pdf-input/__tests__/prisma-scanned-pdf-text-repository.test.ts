import { ArtifactPreprocessJobState, ArtifactRevisionState, ArtifactScanJobState, ArtifactState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaScannedPdfTextRepository } from "../prisma-scanned-pdf-text-repository";

/** Complete conversion graph with one clean source and one consumed completion. */
function _Job()
{
	return {
		state: ArtifactPreprocessJobState.Completed, completionDigest: `sha256:${"a".repeat(64)}`, completionConsumedAt: new Date(), completedAt: new Date(),
		derivedArtifactId: "text", derivedRevisionId: "text-1",
		sourceRevision: { id: "pdf-1", artifactId: "pdf", mediaType: "application/pdf", byteLength: 40n, state: ArtifactRevisionState.Published,
			artifact: { siloId: "silo", state: ArtifactState.Active, currentRevisionId: "pdf-1" }, scanJob: { state: ArtifactScanJobState.Clean } },
		derivedArtifact: { id: "text", siloId: "silo", state: ArtifactState.Active, currentRevisionId: "text-1" },
		derivedRevision: { id: "text-1", artifactId: "text", state: ArtifactRevisionState.Published, mediaType: "text/plain", byteLength: 12n,
			contentAddress: `sha256:${"b".repeat(64)}`, parents: [{ childRevisionId: "text-1", parentRevisionId: "pdf-1" }],
			provenance: { pipelineVersion: "pdf-to-text/v1", sourceRevisionId: "pdf-1" } },
	};
}

/** Exercises the public resolver with one exact catalogue snapshot. */
async function _Resolve(job: unknown)
{
	const transaction = { artifactPreprocessJob: { findUnique: vi.fn().mockResolvedValue(job) } };
	const repository = new PrismaScannedPdfTextRepository(transaction as never);
	const result = await repository.resolve("silo", "pdf", "pdf-1");
	expect(transaction.artifactPreprocessJob.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { sourceRevisionId_pipelineVersion: { sourceRevisionId: "pdf-1", pipelineVersion: "pdf-to-text/v1" } } }));
	return result;
}

describe("scanned PDF text lineage", function _Suite()
{
	it("returns only the exact published source and converted content coordinates", async function _Resolves()
	{
		await expect(_Resolve(_Job())).resolves.toEqual({ siloId: "silo", sourceArtifactId: "pdf", sourceRevisionId: "pdf-1", sourceByteLength: 40,
			artifactId: "text", artifactRevisionId: "text-1", contentAddress: `sha256:${"b".repeat(64)}`, byteLength: 12, mediaType: "text/plain" });
	});

	it("rejects missing or unconsumed completion even when text was already published", async function _Incomplete()
	{
		await expect(_Resolve(null)).resolves.toBeNull();
		for (const patch of [{ state: ArtifactPreprocessJobState.Claimed }, { completionDigest: null }, { completionConsumedAt: null }, { completedAt: null }])
			await expect(_Resolve({ ..._Job(), ...patch })).resolves.toBeNull();
	});

	it("rejects unsafe, replaced or foreign source revisions", async function _Source()
	{
		for (const patch of [{ scanJob: { state: ArtifactScanJobState.Rejected } }, { mediaType: "text/plain" }, { state: ArtifactRevisionState.Quarantined },
			{ artifactId: "foreign" }, { byteLength: 0n }, { artifact: { siloId: "other", state: ArtifactState.Active, currentRevisionId: "pdf-1" } },
			{ artifact: { siloId: "silo", state: ArtifactState.Active, currentRevisionId: "pdf-2" } }])
			await expect(_Resolve({ ..._Job(), sourceRevision: { ..._Job().sourceRevision, ...patch } })).resolves.toBeNull();
	});

	it("rejects an ambiguous parent or replaced, empty, malformed or foreign derivative", async function _Derivative()
	{
		for (const patch of [{ parents: [] }, { parents: [..._Job().derivedRevision.parents, { childRevisionId: "text-1", parentRevisionId: "other" }] },
			{ provenance: { pipelineVersion: "other", sourceRevisionId: "pdf-1" } }, { byteLength: 0n }, { byteLength: BigInt(Number.MAX_SAFE_INTEGER) + 1n },
			{ contentAddress: "unknown" }, { mediaType: "text/html" }, { artifactId: "other" }, { state: ArtifactRevisionState.Quarantined }])
			await expect(_Resolve({ ..._Job(), derivedRevision: { ..._Job().derivedRevision, ...patch } })).resolves.toBeNull();
		await expect(_Resolve({ ..._Job(), derivedArtifact: { ..._Job().derivedArtifact, currentRevisionId: "text-2" } })).resolves.toBeNull();
	});
});
