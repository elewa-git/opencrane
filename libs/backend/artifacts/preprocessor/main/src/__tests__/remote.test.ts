import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ArtifactPreprocessorJobClaim } from "@opencrane/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { _CreateArtifactPreprocessorRemote } from "../remote.js";

/** Restore the global fetch implementation after each remote-adapter protocol assertion. */
afterEach(function _restoreFetch()
{
	vi.unstubAllGlobals();
});

/** Verify the source reader preserves the colon-bearing canonical path and exact lease header. */
describe("artifact preprocessor remote adapter", function _suite()
{
	it("streams only a hash-matching source through its read lease", async function _readSource()
	{
		const bytes = Buffer.from("pdf!");
		const address = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
		const claim: ArtifactPreprocessorJobClaim = { lease: { jobId: "job-1", attempt: 1, claimFence: "fence-1", expiresAt: "2030-01-01T00:00:00.000Z" }, sourceRevisionId: "revision-1", sourceContentAddress: address, sourceMediaType: "application/pdf", sourceByteLength: bytes.byteLength, derivedArtifactId: "artifact-derived", sourceReadLease: "read-lease" };
		const fetchMock = vi.fn(async function _fetch(url: string, init: RequestInit) { expect(url).toBe(`http://artifact-service/v1/artifacts/read/${address}`); expect(init.headers).toMatchObject({ "x-opencrane-artifact-lease": "read-lease" }); return new Response(bytes, { status: 200 }); });
		vi.stubGlobal("fetch", fetchMock);
		const scratch = await mkdtemp(join(tmpdir(), "artifact-preprocessor-remote-"));
		try
		{
			const remote = _CreateArtifactPreprocessorRemote({ openCraneInternalUrl: "http://server", artifactServiceUrl: "http://artifact-service", tokenPath: "/token", requestTimeoutMilliseconds: 1_000 });
			const destination = join(scratch, "source.pdf");
			await remote.readSource(claim, destination, 100, new AbortController().signal);
			expect(await readFile(destination)).toEqual(bytes);
		}
		finally
		{
			await rm(scratch, { recursive: true, force: true });
		}
	});
});
