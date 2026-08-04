import { randomUUID } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";

import type { ArtifactPreprocessorClaimCommand, ArtifactPreprocessorFailureCode, ArtifactPreprocessorJobClaim } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import type { ArtifactPreprocessorDependencies } from "./preprocessor.types.js";

/** Run the bounded outbound-only job loop until Kubernetes requests shutdown. */
export async function __RunArtifactPreprocessor(dependencies: ArtifactPreprocessorDependencies, signal: AbortSignal): Promise<void>
{
	while (!signal.aborted)
	{
		try
		{
			const claim = await dependencies.remote.claim(signal);
			if (claim === null)
			{
				await _Wait(dependencies.pollIntervalMilliseconds, signal);
				continue;
			}
			await __ProcessArtifactPreprocessorJob(dependencies, claim, signal);
		}
		catch (err)
		{
			if (signal.aborted) return;
			dependencies.logger.warn({ err }, "artifact preprocessing job deferred for fenced retry");
			await _Wait(dependencies.pollIntervalMilliseconds, signal);
		}
	}
}

/** Read, convert, and submit one already-fenced PDF claim through OpenCrane only. */
export async function __ProcessArtifactPreprocessorJob(dependencies: ArtifactPreprocessorDependencies, claim: ArtifactPreprocessorJobClaim, signal: AbortSignal): Promise<void>
{
	await ___DoWithTrace("artifact_preprocessor.job.process", { jobId: claim.lease.jobId, attempt: claim.lease.attempt, sourceByteLength: claim.sourceByteLength }, async function _process()
	{
		const nonce = randomUUID();
		const sourcePath = join(dependencies.scratchDirectory, `${nonce}.pdf`);
		const outputPath = join(dependencies.scratchDirectory, `${nonce}.txt`);
		const command = _ClaimCommand(claim);
		try
		{
			// 1. Source broker — OpenCrane streams only the current claim's PDF into bounded scratch.
			try
			{
				await dependencies.remote.readSource(claim, sourcePath, dependencies.maximumSourceBytes, signal);
			}
			catch (err)
			{
				await _ReportFailure(dependencies, command, "source_read_failed", err, signal);
			}

			// 2. Conversion — fixed argv execution and a pre-read stat keep parser output within its ceiling.
			const outputByteLength = await _ConvertOutput(dependencies, claim, command, sourcePath, outputPath, signal);

			// 3. Output broker — stream bytes back to OpenCrane for server-owned hashing, promotion, and publication.
			try
			{
				await dependencies.remote.submitOutput(command, outputPath, outputByteLength, signal);
			}
			catch (err)
			{
				await _ReportFailure(dependencies, command, "output_submission_failed", err, signal);
			}
			dependencies.logger.info({ jobId: claim.lease.jobId, attempt: claim.lease.attempt, sourceByteLength: claim.sourceByteLength, outputByteLength }, "artifact preprocessing job completed");
		}
		finally
		{
			await Promise.all([rm(sourcePath, { force: true }), rm(outputPath, { force: true })]);
		}
	});
}

/** Convert one claimed PDF and return its validated output size or report the fenced failure. */
async function _ConvertOutput(dependencies: ArtifactPreprocessorDependencies, claim: ArtifactPreprocessorJobClaim, command: ArtifactPreprocessorClaimCommand, sourcePath: string, outputPath: string, signal: AbortSignal): Promise<number>
{
	try
	{
		await ___DoWithTrace("artifact_preprocessor.pdf.extract", { jobId: claim.lease.jobId, attempt: claim.lease.attempt }, async function _extract()
		{
			await dependencies.extractor.extract(sourcePath, outputPath, dependencies.conversionTimeoutMilliseconds, signal);
		});
		return await _BoundedOutputByteLength(outputPath, dependencies.maximumOutputBytes);
	}
	catch (err)
	{
		return _ReportFailure(dependencies, command, "conversion_failed", err, signal);
	}
}

/** Fail closed before opening converter output as a potentially large stream. */
async function _BoundedOutputByteLength(path: string, maximumBytes: number): Promise<number>
{
	const metadata = await stat(path);
	if (!metadata.isFile() || !Number.isSafeInteger(metadata.size) || metadata.size > maximumBytes) throw new Error("pdftotext output exceeds artifact preprocessor maximum output bytes");
	return metadata.size;
}

/** Report one stable failure category and then preserve the stage's original failure. */
async function _ReportFailure(dependencies: ArtifactPreprocessorDependencies, command: ArtifactPreprocessorClaimCommand, failureCode: ArtifactPreprocessorFailureCode, failure: unknown, signal: AbortSignal): Promise<never>
{
	if (!signal.aborted)
	{
		try
		{
			await dependencies.remote.reportFailure({ ...command, failureCode }, signal);
		}
		catch (err)
		{
			dependencies.logger.warn({ err, jobId: command.jobId, attempt: command.attempt, failureCode }, "artifact preprocessing failure report was not accepted");
		}
	}
	throw failure;
}

/** Extract the exact live claim coordinates accepted by later broker calls. */
function _ClaimCommand(claim: ArtifactPreprocessorJobClaim): ArtifactPreprocessorClaimCommand
{
	return { jobId: claim.lease.jobId, attempt: claim.lease.attempt, claimFence: claim.lease.claimFence };
}

/** Wait for a poll interval while promptly respecting Kubernetes shutdown. */
async function _Wait(milliseconds: number, signal: AbortSignal): Promise<void>
{
	if (signal.aborted) return;
	await new Promise<void>(function _sleep(resolve)
	{
		const timer = setTimeout(_finish, milliseconds);
		function _finish(): void
		{
			signal.removeEventListener("abort", _abort);
			resolve();
		}
		function _abort(): void
		{
			clearTimeout(timer);
			_finish();
		}
		signal.addEventListener("abort", _abort, { once: true });
	});
}
