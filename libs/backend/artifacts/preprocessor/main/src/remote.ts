import { createReadStream, createWriteStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { ArtifactPreprocessorClaimCommand, ArtifactPreprocessorFailureCommand, ArtifactPreprocessorJobClaim } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/observability";

import type { ArtifactPreprocessorRemote, ArtifactPreprocessorRemoteConfig } from "./preprocessor.types.js";

/** Maximum accepted claim response size from the private authority. */
const _MAXIMUM_CLAIM_RESPONSE_BYTES = 16_384;

/** Create the OpenCrane-only adapter that reads a rotating projected token for every call. */
export function _CreateArtifactPreprocessorRemote(config: ArtifactPreprocessorRemoteConfig): ArtifactPreprocessorRemote
{
	return {
		claim(signal) { return _Claim(config, signal); },
		readSource(claim, destinationPath, maximumBytes, signal) { return _ReadSource(config, claim, destinationPath, maximumBytes, signal); },
		submitOutput(command, sourcePath, byteLength, signal) { return _SubmitOutput(config, command, sourcePath, byteLength, signal); },
		reportFailure(command, signal) { return _ReportFailure(config, command, signal); },
	};
}

/** Claim one job through the TokenReview-protected OpenCrane internal route. */
async function _Claim(config: ArtifactPreprocessorRemoteConfig, signal: AbortSignal): Promise<ArtifactPreprocessorJobClaim | null>
{
	return ___DoWithTrace("artifact_preprocessor.job.claim", {}, async function _claim()
	{
		const [requestSignal, dispose] = _TimeoutAbort(config.requestTimeoutMilliseconds, signal);
		try
		{
			const response = await fetch(`${config.openCraneInternalUrl}/api/internal/artifact-preprocessor/jobs:claim`, { method: "POST", headers: { authorization: await _Authorization(config), "content-type": "application/json" }, body: "{}", signal: requestSignal });
			if (response.status === 204) return null;
			if (!response.ok) return _RejectResponse(response, `artifact preprocess claim failed with HTTP ${response.status}`);
			return _ClaimFromUnknown(await _ReadBoundedJson(response, _MAXIMUM_CLAIM_RESPONSE_BYTES));
		}
		finally
		{
			dispose();
		}
	});
}

/** Stream server-brokered source bytes into one exclusive bounded scratch file. */
async function _ReadSource(config: ArtifactPreprocessorRemoteConfig, claim: ArtifactPreprocessorJobClaim, destinationPath: string, maximumBytes: number, signal: AbortSignal): Promise<void>
{
	await ___DoWithTrace("artifact_preprocessor.source.read", { jobId: claim.lease.jobId, attempt: claim.lease.attempt, sourceByteLength: claim.sourceByteLength }, async function _read()
	{
		if (claim.sourceByteLength > maximumBytes) throw new Error("claimed source PDF exceeds artifact preprocessor maximum source bytes");
		const [requestSignal, dispose] = _TimeoutAbort(config.requestTimeoutMilliseconds, signal);
		try
		{
			const command = _ClaimCommand(claim);
			const response = await fetch(`${config.openCraneInternalUrl}/api/internal/artifact-preprocessor/jobs/${encodeURIComponent(command.jobId)}/source`, { method: "POST", headers: { authorization: await _Authorization(config), "content-type": "application/json" }, body: JSON.stringify(command), signal: requestSignal });
			if (!response.ok || response.body === null) return _RejectResponse(response, `artifact source broker failed with HTTP ${response.status}`);
			if (response.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/pdf") return _RejectResponse(response, "artifact source broker returned an invalid media type");
			const declaredLength = Number(response.headers.get("content-length"));
			if (!Number.isSafeInteger(declaredLength) || declaredLength !== claim.sourceByteLength) return _RejectResponse(response, "artifact source broker returned an invalid content length");

			let byteLength = 0;
			const bound = new Transform({ transform(chunk: Uint8Array, _encoding, callback)
			{
				byteLength += chunk.byteLength;
				if (byteLength > maximumBytes || byteLength > claim.sourceByteLength)
				{
					callback(new Error("artifact source bytes exceed the fenced claim limit"));
					return;
				}
				callback(null, chunk);
			} });
			await pipeline(Readable.fromWeb(response.body as never), bound, createWriteStream(destinationPath, { flags: "wx", mode: 0o600 }), { signal: requestSignal });
			if (byteLength !== claim.sourceByteLength) throw new Error("artifact source bytes do not match the fenced claim length");
		}
		finally
		{
			dispose();
		}
	});
}

/** Stream one bounded output to OpenCrane without exposing storage coordinates or capabilities. */
async function _SubmitOutput(config: ArtifactPreprocessorRemoteConfig, command: ArtifactPreprocessorClaimCommand, sourcePath: string, byteLength: number, signal: AbortSignal): Promise<void>
{
	await ___DoWithTrace("artifact_preprocessor.output.submit", { jobId: command.jobId, attempt: command.attempt, outputByteLength: byteLength }, async function _submit()
	{
		const metadata = await stat(sourcePath);
		if (!metadata.isFile() || !Number.isSafeInteger(byteLength) || byteLength < 0 || metadata.size !== byteLength) throw new Error("artifact output file did not match its declared byte length");
		const [requestSignal, dispose] = _TimeoutAbort(config.requestTimeoutMilliseconds, signal);
		try
		{
			// X-OpenCrane-Preprocess-Attempt / X-OpenCrane-Preprocess-Fence carry the
			// live claim beside a raw streaming body; they are private protocol headers.
			// @see https://www.rfc-editor.org/rfc/rfc6648
			const headers = { authorization: await _Authorization(config), "content-type": "text/plain; charset=utf-8", "content-length": String(byteLength), "x-opencrane-preprocess-attempt": String(command.attempt), "x-opencrane-preprocess-fence": command.claimFence };
			const request = { method: "PUT", headers, body: Readable.toWeb(createReadStream(sourcePath)), duplex: "half", signal: requestSignal } as RequestInit & { duplex: "half" };
			const response = await fetch(`${config.openCraneInternalUrl}/api/internal/artifact-preprocessor/jobs/${encodeURIComponent(command.jobId)}/output`, request);
			if (response.status !== 204) return _RejectResponse(response, `artifact output broker failed with HTTP ${response.status}`);
		}
		finally
		{
			dispose();
		}
	});
}

/** Report one worker-observed failure through the current claim fence. */
async function _ReportFailure(config: ArtifactPreprocessorRemoteConfig, command: ArtifactPreprocessorFailureCommand, signal: AbortSignal): Promise<void>
{
	await ___DoWithTrace("artifact_preprocessor.failure.report", { jobId: command.jobId, attempt: command.attempt, failureCode: command.failureCode }, async function _report()
	{
		const [requestSignal, dispose] = _TimeoutAbort(config.requestTimeoutMilliseconds, signal);
		try
		{
			const response = await fetch(`${config.openCraneInternalUrl}/api/internal/artifact-preprocessor/jobs/${encodeURIComponent(command.jobId)}/failure`, { method: "PUT", headers: { authorization: await _Authorization(config), "content-type": "application/json" }, body: JSON.stringify(command), signal: requestSignal });
			if (response.status !== 204) return _RejectResponse(response, `artifact preprocess failure report failed with HTTP ${response.status}`);
		}
		finally
		{
			dispose();
		}
	});
}

/** Read and validate the mounted projected token without retaining it between calls. */
async function _Authorization(config: ArtifactPreprocessorRemoteConfig): Promise<string>
{
	const token = (await readFile(config.tokenPath, "utf8")).trim();
	if (!token) throw new Error("artifact preprocessor projected token is empty");
	return `Bearer ${token}`;
}

/** Combine caller cancellation with one bounded independent HTTP deadline. */
function _TimeoutAbort(milliseconds: number, parent: AbortSignal): readonly [AbortSignal, () => void]
{
	const controller = new AbortController();
	const timeout = setTimeout(function _timeout() { controller.abort(new Error("artifact preprocessor request timeout")); }, milliseconds);
	function _Abort(): void { controller.abort(parent.reason); }
	if (parent.aborted) _Abort();
	else parent.addEventListener("abort", _Abort, { once: true });
	return [controller.signal, function _dispose() { clearTimeout(timeout); parent.removeEventListener("abort", _Abort); }];
}

/** Extract the exact live claim coordinates accepted by later broker calls. */
function _ClaimCommand(claim: ArtifactPreprocessorJobClaim): ArtifactPreprocessorClaimCommand
{
	return { jobId: claim.lease.jobId, attempt: claim.lease.attempt, claimFence: claim.lease.claimFence };
}

/** Cancel an anomalous response body before surfacing its bounded protocol failure. */
async function _RejectResponse(response: Response, message: string): Promise<never>
{
	try
	{
		await response.body?.cancel();
	}
	catch
	{
		// The stable protocol error remains more useful than a secondary cancellation failure.
	}
	throw new Error(message);
}

/** Decode one exact server-owned claim response without accepting added fields. */
function _ClaimFromUnknown(value: unknown): ArtifactPreprocessorJobClaim
{
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("artifact preprocess claim was not an object");
	const claim = value as Record<string, unknown>;
	const lease = claim["lease"];
	if (!_HasExactKeys(claim, ["lease", "sourceMediaType", "sourceByteLength"]) || lease === null || typeof lease !== "object" || Array.isArray(lease)) throw new Error("artifact preprocess claim had an invalid shape");
	const jobLease = lease as Record<string, unknown>;
	if (!_HasExactKeys(jobLease, ["jobId", "attempt", "claimFence", "expiresAt"]) || typeof jobLease["jobId"] !== "string" || !jobLease["jobId"] || !Number.isSafeInteger(jobLease["attempt"]) || (jobLease["attempt"] as number) < 1 || typeof jobLease["claimFence"] !== "string" || !jobLease["claimFence"] || typeof jobLease["expiresAt"] !== "string" || !Number.isFinite(Date.parse(jobLease["expiresAt"])) || claim["sourceMediaType"] !== "application/pdf" || !Number.isSafeInteger(claim["sourceByteLength"]) || (claim["sourceByteLength"] as number) < 1) throw new Error("artifact preprocess claim had an invalid shape");
	return claim as unknown as ArtifactPreprocessorJobClaim;
}

/** Read a small JSON authority response without accepting an unbounded body. */
async function _ReadBoundedJson(response: Response, maximumBytes: number): Promise<unknown>
{
	// 1. Reject an impossible declared size before allocating any response storage.
	const declaredLength = response.headers.get("content-length");
	if (declaredLength !== null)
	{
		const parsedLength = Number(declaredLength);
		if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maximumBytes) throw new Error("artifact preprocess authority response had an invalid byte length");
	}
	if (response.body === null) throw new Error("artifact preprocess authority returned no response body");

	// 2. Enforce the same ceiling while streaming because Content-Length is not trusted evidence.
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	for await (const chunk of Readable.fromWeb(response.body as never))
	{
		byteLength += chunk.byteLength;
		if (byteLength > maximumBytes) throw new Error("artifact preprocess authority response exceeded its byte limit");
		chunks.push(chunk);
	}

	// 3. Parse only the now-bounded bytes into the protocol's exact structural validator.
	try
	{
		return JSON.parse(Buffer.concat(chunks, byteLength).toString("utf8")) as unknown;
	}
	catch
	{
		throw new Error("artifact preprocess authority returned invalid JSON");
	}
}

/** Require an object to carry exactly the fixed protocol keys. */
function _HasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean
{
	const actual = Object.keys(value);
	return actual.length === keys.length && keys.every(function _has(key) { return key in value; });
}
