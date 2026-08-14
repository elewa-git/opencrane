import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { ArtifactScannerClaimCommand, ArtifactScannerFailureCommand, ArtifactScannerJobClaim, ArtifactScannerResultCommand } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import type { ArtifactScannerRemote, ArtifactScannerRemoteConfig } from "./scanner.types";

/** Create the projected-token OpenCrane scanner adapter. */
export function _CreateArtifactScannerRemote(config: ArtifactScannerRemoteConfig): ArtifactScannerRemote
{
	return {
		claim(signal) { return _Claim(config, signal); },
		readSource(claim, destinationPath, maximumBytes, signal) { return _ReadSource(config, claim, destinationPath, maximumBytes, signal); },
		reportResult(command, signal) { return _SendJson(config, `/api/internal/artifact-scanner/jobs/${encodeURIComponent(command.jobId)}/result`, command, signal); },
		reportFailure(command, signal) { return _SendJson(config, `/api/internal/artifact-scanner/jobs/${encodeURIComponent(command.jobId)}/failure`, command, signal); }
	};
}

/** Claim one scan job. */
async function _Claim(config: ArtifactScannerRemoteConfig, signal: AbortSignal): Promise<ArtifactScannerJobClaim | null>
{
	return ___DoWithTrace("artifact-scanner.job.claim", {}, async function _ClaimJob(): Promise<ArtifactScannerJobClaim | null>
	{
		const response = await fetch(`${config.openCraneInternalUrl}/api/internal/artifact-scanner/jobs:claim`, { method: "POST", headers: await _Headers(config), signal: AbortSignal.any([signal, AbortSignal.timeout(config.requestTimeoutMilliseconds)]) });
		if (response.status === 204) return null;
		if (!response.ok) throw new Error(`artifact scan claim failed with HTTP ${response.status}`);
		const value = await response.json() as ArtifactScannerJobClaim;
		if (!_ValidClaim(value)) throw new Error("artifact scan claim had an invalid shape");
		return value;
	});
}

/** Read exact source bytes with no storage coordinate exposure. */
async function _ReadSource(config: ArtifactScannerRemoteConfig, claim: ArtifactScannerJobClaim, destinationPath: string, maximumBytes: number, signal: AbortSignal): Promise<void>
{
	return ___DoWithTrace("artifact-scanner.source.read", { jobId: claim.lease.jobId, attempt: claim.lease.attempt, sourceByteLength: claim.sourceByteLength }, async function _ReadClaimedSource(): Promise<void>
	{
		if (claim.sourceByteLength > maximumBytes) throw new Error("artifact scan source exceeds configured maximum");
		const response = await fetch(`${config.openCraneInternalUrl}/api/internal/artifact-scanner/jobs/${encodeURIComponent(claim.lease.jobId)}/source`, { method: "POST", headers: await _Headers(config, claim.lease), signal: AbortSignal.any([signal, AbortSignal.timeout(config.requestTimeoutMilliseconds)]) });
		if (!response.ok || response.body === null) throw new Error(`artifact scan source failed with HTTP ${response.status}`);
		let byteLength = 0;
		const bound = new Transform({ transform(chunk: Uint8Array, _encoding, callback)
		{
			byteLength += chunk.byteLength;
			if (byteLength > claim.sourceByteLength || byteLength > maximumBytes) callback(new Error("artifact scan source exceeded claim"));
			else callback(null, chunk);
		} });
		await pipeline(Readable.fromWeb(response.body as never), bound, createWriteStream(destinationPath, { flags: "wx", mode: 0o600 }), { signal });
		if (byteLength !== claim.sourceByteLength) throw new Error("artifact scan source length did not match claim");
	});
}

/** Submit one fenced result or failure. */
async function _SendJson(config: ArtifactScannerRemoteConfig, path: string, command: ArtifactScannerResultCommand | ArtifactScannerFailureCommand, signal: AbortSignal): Promise<void>
{
	const isFailure = "failureCode" in command;
	const operation = isFailure ? "artifact-scanner.failure.report" : "artifact-scanner.result.report";
	const fields = isFailure ? { jobId: command.jobId, attempt: command.attempt, failureCode: command.failureCode } : { jobId: command.jobId, attempt: command.attempt };
	return ___DoWithTrace(operation, fields, async function _ReportOutcome(): Promise<void>
	{
		const response = await fetch(`${config.openCraneInternalUrl}${path}`, { method: "PUT", headers: await _Headers(config), body: JSON.stringify(command), signal: AbortSignal.any([signal, AbortSignal.timeout(config.requestTimeoutMilliseconds)]) });
		if (response.status !== 204) throw new Error(`artifact scan report failed with HTTP ${response.status}`);
	});
}

/** Read the rotating token for every request. */
async function _Headers(config: ArtifactScannerRemoteConfig, command?: ArtifactScannerClaimCommand): Promise<Record<string, string>>
{
	const token = (await readFile(config.tokenPath, "utf8")).trim();
	if (!token) throw new Error("artifact scanner projected token is empty");
	return { authorization: `Bearer ${token}`, "content-type": "application/json", ...(command === undefined ? {} : { "x-opencrane-scan-attempt": String(command.attempt), "x-opencrane-scan-fence": command.claimFence }) };
}

/** Validate the complete claim shape before trusting any bound. */
function _ValidClaim(value: ArtifactScannerJobClaim): boolean
{
	return typeof value?.lease?.jobId === "string" && value.lease.jobId.length > 0 && Number.isSafeInteger(value.lease.attempt) && value.lease.attempt > 0 && typeof value.lease.claimFence === "string" && value.lease.claimFence.length > 0 && Number.isSafeInteger(value.sourceByteLength) && value.sourceByteLength > 0;
}
