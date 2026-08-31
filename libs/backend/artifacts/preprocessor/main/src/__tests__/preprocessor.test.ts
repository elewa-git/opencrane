import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ArtifactPreprocessorJobClaim } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { __ProcessArtifactPreprocessorJob } from "../preprocessor";
import type { ArtifactPreprocessorDependencies, ArtifactPreprocessorRemote, PdfTextExtractor } from "../preprocessor.types";

/** Fixed capability-free claim fixture used by worker orchestration tests. */
function _Claim(): ArtifactPreprocessorJobClaim
{
	return { lease: { jobId: "job-1", attempt: 1, claimFence: "fence-1", expiresAt: "2030-01-01T00:00:00.000Z" }, sourceMediaType: "application/pdf", sourceByteLength: 4 };
}

/** Build the default broker, converter, logger, and bounded worker configuration. */
function _Dependencies(scratchDirectory: string): ArtifactPreprocessorDependencies
{
	const remote: ArtifactPreprocessorRemote = {
		bootstrap: vi.fn(),
		readSource: vi.fn(async function _read(_claim, path) { await writeFile(path, "pdf!"); }),
		submitOutput: vi.fn(async function _submit(_command, path, byteLength)
		{
			expect(byteLength).toBe(14);
			expect(await readFile(path, "utf8")).toBe("extracted text");
		}),
		reportFailure: vi.fn(),
	};
	const extractor: PdfTextExtractor = { extract: vi.fn(async function _extract(_source, output) { await writeFile(output, "extracted text"); }) };
	return { remote, extractor, scratchDirectory, maximumSourceBytes: 100, maximumOutputBytes: 100, conversionTimeoutMilliseconds: 1_000, logger: { info: vi.fn(), warn: vi.fn() } as never };
}

/** Confirm the worker uses only OpenCrane brokers and always removes transient files. */
describe("artifact preprocessing worker", function _suite()
{
	it("streams the bounded converted output through OpenCrane", async function _process()
	{
		const scratchDirectory = await mkdtemp(join(tmpdir(), "artifact-preprocessor-"));
		const dependencies = _Dependencies(scratchDirectory);
		try
		{
			await __ProcessArtifactPreprocessorJob(dependencies, _Claim(), new AbortController().signal);
			expect(dependencies.remote.readSource).toHaveBeenCalledWith(_Claim(), expect.stringMatching(/\.pdf$/u), 100, expect.any(AbortSignal));
			expect(dependencies.remote.submitOutput).toHaveBeenCalledWith({ jobId: "job-1", attempt: 1, claimFence: "fence-1" }, expect.stringMatching(/\.txt$/u), 14, expect.any(AbortSignal));
			expect(dependencies.remote.reportFailure).not.toHaveBeenCalled();
			expect(await readdir(scratchDirectory)).toEqual([]);
		}
		finally
		{
			await rm(scratchDirectory, { recursive: true, force: true });
		}
	});

	it("reports a source broker failure against the live fence", async function _sourceFailure()
	{
		const scratchDirectory = await mkdtemp(join(tmpdir(), "artifact-preprocessor-"));
		const dependencies = _Dependencies(scratchDirectory);
		dependencies.remote.readSource = vi.fn(async function _fail() { throw new Error("source unavailable"); });
		try
		{
			await expect(__ProcessArtifactPreprocessorJob(dependencies, _Claim(), new AbortController().signal)).rejects.toThrow("source unavailable");
			expect(dependencies.remote.reportFailure).toHaveBeenCalledWith({ jobId: "job-1", attempt: 1, claimFence: "fence-1", failureCode: "source_read_failed" }, expect.any(AbortSignal));
			expect(dependencies.extractor.extract).not.toHaveBeenCalled();
			expect(await readdir(scratchDirectory)).toEqual([]);
		}
		finally
		{
			await rm(scratchDirectory, { recursive: true, force: true });
		}
	});

	it("stats and rejects oversized converter output before submission", async function _conversionFailure()
	{
		const scratchDirectory = await mkdtemp(join(tmpdir(), "artifact-preprocessor-"));
		const dependencies = _Dependencies(scratchDirectory);
		dependencies.extractor.extract = vi.fn(async function _oversized(_source, output) { await writeFile(output, Buffer.alloc(101)); });
		try
		{
			await expect(__ProcessArtifactPreprocessorJob(dependencies, _Claim(), new AbortController().signal)).rejects.toThrow("maximum output bytes");
			expect(dependencies.remote.reportFailure).toHaveBeenCalledWith({ jobId: "job-1", attempt: 1, claimFence: "fence-1", failureCode: "conversion_failed" }, expect.any(AbortSignal));
			expect(dependencies.remote.submitOutput).not.toHaveBeenCalled();
			expect(await readdir(scratchDirectory)).toEqual([]);
		}
		finally
		{
			await rm(scratchDirectory, { recursive: true, force: true });
		}
	});

	it("reports an output broker failure without exposing storage evidence", async function _outputFailure()
	{
		const scratchDirectory = await mkdtemp(join(tmpdir(), "artifact-preprocessor-"));
		const dependencies = _Dependencies(scratchDirectory);
		dependencies.remote.submitOutput = vi.fn(async function _fail() { throw new Error("output unavailable"); });
		try
		{
			await expect(__ProcessArtifactPreprocessorJob(dependencies, _Claim(), new AbortController().signal)).rejects.toThrow("output unavailable");
			expect(dependencies.remote.reportFailure).toHaveBeenCalledWith({ jobId: "job-1", attempt: 1, claimFence: "fence-1", failureCode: "output_submission_failed" }, expect.any(AbortSignal));
			expect(await readdir(scratchDirectory)).toEqual([]);
		}
		finally
		{
			await rm(scratchDirectory, { recursive: true, force: true });
		}
	});
});
