import { createHash, randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import type { ArtifactPreprocessorJobClaim } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/observability";

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

/** Convert, hash, promote, and receipt-complete one already fenced PDF claim. */
export async function __ProcessArtifactPreprocessorJob(dependencies: ArtifactPreprocessorDependencies, claim: ArtifactPreprocessorJobClaim, signal: AbortSignal): Promise<void>
{
	await ___DoWithTrace("artifact_preprocessor.job.process", { jobId: claim.lease.jobId, attempt: claim.lease.attempt, sourceByteLength: claim.sourceByteLength }, async function _process()
	{
		const nonce = randomUUID();
		const sourcePath = join(dependencies.scratchDirectory, `${nonce}.pdf`);
		const outputPath = join(dependencies.scratchDirectory, `${nonce}.txt`);
		try
		{
			// 1. Refuse a claim that cannot fit the independently bounded worker scratch allocation.
			if (claim.sourceByteLength > dependencies.maximumSourceBytes)
			{
				throw new Error("claimed source PDF exceeds artifact preprocessor maximum source bytes");
			}
			// 2. Stream and hash only the capability-bound source before handing it to the PDF parser.
			await dependencies.remote.readSource(claim, sourcePath, dependencies.maximumSourceBytes, signal);
			// 3. Invoke the fixed converter without shell interpolation and reject unbounded output.
			await dependencies.extractor.extract(sourcePath, outputPath, dependencies.conversionTimeoutMilliseconds, signal);
			const output = await _ReadBoundedOutput(outputPath, dependencies.maximumOutputBytes);
			const contentAddress = `sha256:${createHash("sha256").update(output).digest("hex")}`;
			// 4. Bind the observed output digest to this exact live claim before bytes can reach CAS.
			const outputLease = await dependencies.remote.issueOutputLease({ jobId: claim.lease.jobId, attempt: claim.lease.attempt, claimFence: claim.lease.claimFence, contentAddress, byteLength: output.byteLength }, signal);
			// 5. Promote only capability-authorized bytes, then consume the independent service receipt.
			const promotionReceipt = await dependencies.remote.promoteOutput(outputLease.artifactWriteLease, output, signal);
			await dependencies.remote.complete({ jobId: claim.lease.jobId, attempt: claim.lease.attempt, claimFence: claim.lease.claimFence, derivedRevisionId: outputLease.derivedRevisionId, promotionReceipt }, signal);
			dependencies.logger.info({ jobId: claim.lease.jobId, attempt: claim.lease.attempt, sourceByteLength: claim.sourceByteLength, outputByteLength: output.byteLength }, "artifact preprocessing job completed");
		}
		finally
		{
			await Promise.all([rm(sourcePath, { force: true }), rm(outputPath, { force: true })]);
		}
	});
}

/** Read converter output only after enforcing the configured bounded transient file size. */
async function _ReadBoundedOutput(path: string, maximumBytes: number): Promise<Uint8Array>
{
	const output = await readFile(path);
	if (output.byteLength > maximumBytes) throw new Error("pdftotext output exceeds artifact preprocessor maximum output bytes");
	return output;
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
