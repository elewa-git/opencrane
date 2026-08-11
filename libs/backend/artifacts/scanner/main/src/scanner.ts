import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { ___DoWithTrace } from "@opencrane/backend/observability";
import type { ArtifactScannerClaimCommand, ArtifactScannerFailureCommand, ArtifactScannerJobClaim } from "@opencrane/contracts";

import type { ArtifactScannerDependencies } from "./scanner.types.js";

/** Run the outbound-only scan loop until shutdown. */
export async function __RunArtifactScanner(dependencies: ArtifactScannerDependencies, signal: AbortSignal): Promise<void>
{
	while (!signal.aborted)
	{
		try
		{
			const claim = await dependencies.remote.claim(signal);
			if (claim !== null) await __ProcessArtifactScanJob(dependencies, claim, signal);
			else await _Wait(dependencies.pollIntervalMilliseconds, signal);
		}
		catch (err)
		{
			if (signal.aborted) return;
			dependencies.logger.warn({ err }, "artifact scan deferred for fenced retry");
			await _Wait(dependencies.pollIntervalMilliseconds, signal);
		}
	}
}

/** Read and scan one server-selected quarantined revision. */
export async function __ProcessArtifactScanJob(dependencies: ArtifactScannerDependencies, claim: ArtifactScannerJobClaim, signal: AbortSignal): Promise<void>
{
	await ___DoWithTrace("artifact_scanner.job.process", { jobId: claim.lease.jobId, attempt: claim.lease.attempt, sourceByteLength: claim.sourceByteLength }, async function _process()
	{
		const sourcePath = join(dependencies.scratchDirectory, `${randomUUID()}.scan`);
		const command = _ClaimCommand(claim);
		try
		{
			// 1. OpenCrane streams only the current claim into bounded scratch.
			try { await dependencies.remote.readSource(claim, sourcePath, dependencies.maximumSourceBytes, signal); }
			catch (err) { return _ReportFailure(dependencies, { ...command, failureCode: "source_read_failed" }, err, signal); }
			// 2. The pinned offline engine scans the complete local file.
			let verdict;
			try { verdict = await dependencies.scanner.scan(sourcePath, dependencies.scanTimeoutMilliseconds, signal); }
			catch (err) { return _ReportFailure(dependencies, { ...command, failureCode: "scanner_failed" }, err, signal); }
			// 3. The server alone publishes or rejects the revision through the fence.
			await dependencies.remote.reportResult({ ...command, verdict, scannerVersion: dependencies.scanner.version }, signal);
			dependencies.logger.info({ jobId: command.jobId, attempt: command.attempt, verdict }, "artifact scan completed");
		}
		finally
		{
			await rm(sourcePath, { force: true });
		}
	});
}

/** Report one bounded failure and preserve the original failure. */
async function _ReportFailure(dependencies: ArtifactScannerDependencies, command: ArtifactScannerFailureCommand, failure: unknown, signal: AbortSignal): Promise<never>
{
	if (!signal.aborted)
	{
		try { await dependencies.remote.reportFailure(command, signal); }
		catch (err) { dependencies.logger.warn({ err, jobId: command.jobId, attempt: command.attempt }, "artifact scan failure report was not accepted"); }
	}
	throw failure;
}

/** Extract current claim coordinates. */
function _ClaimCommand(claim: ArtifactScannerJobClaim): ArtifactScannerClaimCommand
{
	return { jobId: claim.lease.jobId, attempt: claim.lease.attempt, claimFence: claim.lease.claimFence };
}

/** Abort-aware idle wait. */
async function _Wait(milliseconds: number, signal: AbortSignal): Promise<void>
{
	if (signal.aborted) return;
	await new Promise<void>(function _sleep(resolve)
	{
		const timer = setTimeout(resolve, milliseconds);
		signal.addEventListener("abort", function _abort() { clearTimeout(timer); resolve(); }, { once: true });
	});
}
