import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ArtifactPreprocessorJobClaim } from "@opencrane/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { _CreateArtifactPreprocessorRemote } from "../remote";

/** Fixed broker-only claim fixture used by transport assertions. */
function _Claim(): ArtifactPreprocessorJobClaim
{
	return { lease: { jobId: "job-1", attempt: 2, claimFence: "fence-2", expiresAt: "2030-01-01T00:00:00.000Z" }, sourceMediaType: "application/pdf", sourceByteLength: 4 };
}

/** Restore the global fetch implementation after each remote-adapter protocol assertion. */
afterEach(function _RestoreFetch()
{
	vi.unstubAllGlobals();
});

/** Verify every byte and job operation stays behind the OpenCrane broker. */
describe("artifact preprocessor remote adapter", function _suite()
{
	it("bootstraps the mounted assignment with a freshly read projected token", async function _bootstrap()
	{
		const scratch = await mkdtemp(join(tmpdir(), "artifact-preprocessor-remote-"));
		const tokenPath = join(scratch, "token");
		await writeFile(tokenPath, "projected-token\n");
		const fetchMock = vi.fn(async function _fetch(url: string, init: RequestInit)
		{
			expect(url).toBe("http://opencrane/api/internal/artifact-preprocessor/jobs:bootstrap");
			expect(init.method).toBe("POST");
			expect(init.headers).toMatchObject({ authorization: "Bearer projected-token", "content-type": "application/json" });
			expect(init.body).toBe(JSON.stringify({ reference: "bootstrap-reference" }));
			return Response.json(_Claim());
		});
		vi.stubGlobal("fetch", fetchMock);
		try
		{
			const remote = _CreateArtifactPreprocessorRemote({ openCraneInternalUrl: "http://opencrane", tokenPath, requestTimeoutMilliseconds: 1_000 });
			await expect(remote.bootstrap("bootstrap-reference", new AbortController().signal)).resolves.toEqual(_Claim());
		}
		finally
		{
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it("rejects invalid bootstrap JSON before it can become protocol state", async function _RejectsInvalidClaimJson()
	{
		const scratch = await mkdtemp(join(tmpdir(), "artifact-preprocessor-remote-"));
		const tokenPath = join(scratch, "token");
		await writeFile(tokenPath, "projected-token");
		vi.stubGlobal("fetch", vi.fn(async function _Fetch() { return new Response("{", { status: 200, headers: { "content-length": "1" } }); }));
		try
		{
			const remote = _CreateArtifactPreprocessorRemote({ openCraneInternalUrl: "http://opencrane", tokenPath, requestTimeoutMilliseconds: 1_000 });
			await expect(remote.bootstrap("bootstrap-reference", new AbortController().signal)).rejects.toThrow(/artifact preprocess authority response must contain valid JSON/);
		}
		finally
		{
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it("cancels an anomalous bootstrap response before clearing its deadline", async function _cancelRejectedResponse()
	{
		const scratch = await mkdtemp(join(tmpdir(), "artifact-preprocessor-remote-"));
		const tokenPath = join(scratch, "token");
		await writeFile(tokenPath, "projected-token");
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({ pull() { /* Keep the anomalous response open until cancellation. */ }, cancel });
		vi.stubGlobal("fetch", vi.fn(async function _fetch() { return new Response(body, { status: 503 }); }));
		try
		{
			const remote = _CreateArtifactPreprocessorRemote({ openCraneInternalUrl: "http://opencrane", tokenPath, requestTimeoutMilliseconds: 1_000 });
			await expect(remote.bootstrap("bootstrap-reference", new AbortController().signal)).rejects.toThrow("HTTP 503");
			expect(cancel).toHaveBeenCalledOnce();
		}
		finally
		{
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it("posts the claim command and streams only the declared PDF length", async function _readSource()
	{
		const scratch = await mkdtemp(join(tmpdir(), "artifact-preprocessor-remote-"));
		const tokenPath = join(scratch, "token");
		await writeFile(tokenPath, "projected-token");
		const fetchMock = vi.fn(async function _fetch(url: string, init: RequestInit)
		{
			expect(url).toBe("http://opencrane/api/internal/artifact-preprocessor/jobs/job-1/source");
			expect(init.headers).toMatchObject({ authorization: "Bearer projected-token", "content-type": "application/json" });
			expect(JSON.parse(String(init.body))).toEqual({ jobId: "job-1", attempt: 2, claimFence: "fence-2" });
			return new Response("pdf!", { status: 200, headers: { "content-type": "application/pdf", "content-length": "4" } });
		});
		vi.stubGlobal("fetch", fetchMock);
		try
		{
			const remote = _CreateArtifactPreprocessorRemote({ openCraneInternalUrl: "http://opencrane", tokenPath, requestTimeoutMilliseconds: 1_000 });
			const destination = join(scratch, "source.pdf");
			await remote.readSource(_Claim(), destination, 100, new AbortController().signal);
			expect(await readFile(destination, "utf8")).toBe("pdf!");
		}
		finally
		{
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it("streams text output with only the fenced private headers", async function _submitOutput()
	{
		const scratch = await mkdtemp(join(tmpdir(), "artifact-preprocessor-remote-"));
		const tokenPath = join(scratch, "token");
		const outputPath = join(scratch, "output.txt");
		await writeFile(tokenPath, "projected-token");
		await writeFile(outputPath, "text");
		const fetchMock = vi.fn(async function _fetch(url: string, init: RequestInit)
		{
			expect(url).toBe("http://opencrane/api/internal/artifact-preprocessor/jobs/job-1/output");
			expect(init.headers).toMatchObject({ authorization: "Bearer projected-token", "content-type": "text/plain; charset=utf-8", "content-length": "4", "x-opencrane-preprocess-attempt": "2", "x-opencrane-preprocess-fence": "fence-2" });
			expect(Buffer.from(await new Response(init.body as BodyInit).arrayBuffer()).toString()).toBe("text");
			return new Response(null, { status: 204 });
		});
		vi.stubGlobal("fetch", fetchMock);
		try
		{
			const remote = _CreateArtifactPreprocessorRemote({ openCraneInternalUrl: "http://opencrane", tokenPath, requestTimeoutMilliseconds: 1_000 });
			await remote.submitOutput({ jobId: "job-1", attempt: 2, claimFence: "fence-2" }, outputPath, 4, new AbortController().signal);
		}
		finally
		{
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it("reports only the stable failure category and current claim coordinates", async function _failure()
	{
		const scratch = await mkdtemp(join(tmpdir(), "artifact-preprocessor-remote-"));
		const tokenPath = join(scratch, "token");
		await writeFile(tokenPath, "projected-token");
		const fetchMock = vi.fn(async function _fetch(url: string, init: RequestInit)
		{
			expect(url).toBe("http://opencrane/api/internal/artifact-preprocessor/jobs/job-1/failure");
			expect(JSON.parse(String(init.body))).toEqual({ jobId: "job-1", attempt: 2, claimFence: "fence-2", failureCode: "conversion_failed" });
			return new Response(null, { status: 204 });
		});
		vi.stubGlobal("fetch", fetchMock);
		try
		{
			const remote = _CreateArtifactPreprocessorRemote({ openCraneInternalUrl: "http://opencrane", tokenPath, requestTimeoutMilliseconds: 1_000 });
			await remote.reportFailure({ jobId: "job-1", attempt: 2, claimFence: "fence-2", failureCode: "conversion_failed" }, new AbortController().signal);
		}
		finally
		{
			await rm(scratch, { recursive: true, force: true });
		}
	});
});
