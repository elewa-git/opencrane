import { randomUUID } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";

import type { ArtifactPreprocessorClaimCommand, ArtifactPreprocessorFailureCode, ArtifactPreprocessorJobClaim } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import type { ArtifactPreprocessorDependencies } from "./preprocessor.types";

/**
 * Claim and process PDF preprocessing jobs until the process is asked to stop.
 *
 * Outbound only: the worker opens every connection itself and OpenCrane never calls in, so the
 * worker needs no inbound network access. It claims a job, processes it, and sleeps for the poll
 * interval when there is nothing to do.
 *
 * The loop never exits on error. A failed job is logged and retried after the poll interval, and
 * only an aborted `signal` ends the loop — so a caller must not rely on this returning to signal
 * a problem.
 *
 * Called by: `apps/artifact-preprocessor/src/index.ts`.
 * @param dependencies - The OpenCrane broker, the PDF converter, scratch directory, size and time limits, and a logger.
 * @param signal - Aborted on shutdown; the loop stops at the next safe point.
 * @returns Resolves when the signal is aborted. It does not reject.
 */
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

/**
 * Process one claimed PDF: fetch the source from OpenCrane, convert it, and submit the text back.
 *
 * Every byte moves through OpenCrane. The worker is given no storage path and no storage
 * credential, so it cannot reach the object store directly. Scratch files are removed even when a
 * stage fails.
 *
 * On failure it reports one fixed reason code to OpenCrane and then re-throws the original error,
 * so the caller's loop still sees the failure. OpenCrane, not the worker, decides whether the job
 * is retried.
 *
 * Called by: {@link __RunArtifactPreprocessor}; exported for the package's own tests.
 * @param dependencies - Broker, converter, scratch directory, and limits.
 * @param claim - The claimed job, including the fence every later call must carry.
 * @param signal - Shutdown signal.
 * @throws Re-throws the original failure after reporting a reason code; a failure to report is logged and swallowed.
 */
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

/** Convert one PDF and return the output size, or report a `conversion_failed` reason to OpenCrane and re-throw. */
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

/** Stat the converter's output and throw when it is not a regular file or is over the size limit, so an oversized result is never opened as a stream. */
async function _BoundedOutputByteLength(path: string, maximumBytes: number): Promise<number>
{
	const metadata = await stat(path);
	if (!metadata.isFile() || !Number.isSafeInteger(metadata.size) || metadata.size > maximumBytes) throw new Error("pdftotext output exceeds artifact preprocessor maximum output bytes");
	return metadata.size;
}

/** Report a fixed reason code to OpenCrane, then re-throw the original error so its detail is not lost. A failed report is logged and does not replace the original error. */
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

/** Pull out the three fields — `jobId`, `attempt`, `claimFence` — that every later broker call must carry. */
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
