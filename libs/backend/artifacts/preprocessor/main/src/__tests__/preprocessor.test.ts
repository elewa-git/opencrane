import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ArtifactPreprocessorJobClaim } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { __ProcessArtifactPreprocessorJob } from "../preprocessor.js";
import type { ArtifactPreprocessorDependencies, ArtifactPreprocessorRemote, PdfTextExtractor } from "../preprocessor.types.js";

/** Fixed claim fixture that gives the worker only source-read and later write coordinates. */
function _Claim(): ArtifactPreprocessorJobClaim
{
	return { lease: { jobId: "job-1", attempt: 1, claimFence: "fence-1", expiresAt: "2030-01-01T00:00:00.000Z" }, sourceRevisionId: "revision-1", sourceContentAddress: `sha256:${"a".repeat(64)}`, sourceMediaType: "application/pdf", sourceByteLength: 4, derivedArtifactId: "artifact-derived", sourceReadLease: "read-lease" };
}

/** Confirm the worker promotes only the hashed output and completes with the service receipt. */
describe("artifact preprocessing worker", function _suite()
{
	it("uses the server-owned output lease and receipt after conversion", async function _process()
	{
		const scratchDirectory = await mkdtemp(join(tmpdir(), "artifact-preprocessor-"));
		const remote: ArtifactPreprocessorRemote = {
			claim: vi.fn(),
			readSource: vi.fn(async function _read(_claim, path) { await writeFile(path, "pdf!"); }),
			issueOutputLease: vi.fn(async function _issue(command) { return { lease: _Claim().lease, derivedRevisionId: "artifact-preprocess:lease-1", artifactWriteLease: "write-lease" }; }),
			promoteOutput: vi.fn(async function _promote(lease, output) { expect(lease).toBe("write-lease"); expect(Buffer.from(output).toString()).toBe("extracted text"); return "promotion-receipt"; }),
			complete: vi.fn(),
		};
		const extractor: PdfTextExtractor = { extract: async function _extract(_source, output) { await writeFile(output, "extracted text"); } };
		const dependencies: ArtifactPreprocessorDependencies = { remote, extractor, scratchDirectory, maximumSourceBytes: 100, maximumOutputBytes: 100, conversionTimeoutMilliseconds: 1_000, pollIntervalMilliseconds: 100, logger: { info: vi.fn(), warn: vi.fn() } as never };
		try
		{
			await __ProcessArtifactPreprocessorJob(dependencies, _Claim(), new AbortController().signal);
			expect(remote.issueOutputLease).toHaveBeenCalledWith(expect.objectContaining({ contentAddress: `sha256:${(await import("node:crypto")).createHash("sha256").update("extracted text").digest("hex")}`, byteLength: 14 }), expect.any(AbortSignal));
			expect(remote.complete).toHaveBeenCalledWith({ jobId: "job-1", attempt: 1, claimFence: "fence-1", derivedRevisionId: "artifact-preprocess:lease-1", promotionReceipt: "promotion-receipt" }, expect.any(AbortSignal));
			expect(await readdir(scratchDirectory)).toEqual([]);
		}
		finally
		{
			await rm(scratchDirectory, { recursive: true, force: true });
		}
	});
});
