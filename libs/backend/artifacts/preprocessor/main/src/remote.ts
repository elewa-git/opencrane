import { createReadStream, createWriteStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { ArtifactPreprocessorClaimCommand, ArtifactPreprocessorFailureCommand, ArtifactPreprocessorJobClaim } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ___ParseAndValidateJson } from "@opencrane/util";

import type { ArtifactPreprocessorRemote, ArtifactPreprocessorRemoteConfig } from "./preprocessor.types.js";

/** Maximum accepted claim response size from the private authority. */
const _MAXIMUM_CLAIM_RESPONSE_BYTES = 16_384;

/**
 * Build the worker's only route to the outside world: OpenCrane.
 *
 * Every call reads the projected ServiceAccount token from disk again, so kubelet rotation needs no
 * restart, and every call gets its own timeout independent of any caller. The worker never learns a
 * storage path or a storage credential — bytes are brokered through OpenCrane in both directions.
 *
 * Called by: `apps/artifact-preprocessor/src/index.ts`.
 * @param config - OpenCrane origin, token path, and per-call timeout.
 * @returns An adapter implementing claim, source read, output submit, and failure report.
 * @see {@link ArtifactPreprocessorRemote}
 */
export function _CreateArtifactPreprocessorRemote(config: ArtifactPreprocessorRemoteConfig): ArtifactPreprocessorRemote
{
	return {
		claim(signal) { return _Claim(config, signal); },
		readSource(claim, destinationPath, maximumBytes, signal) { return _ReadSource(config, claim, destinationPath, maximumBytes, signal); },
		submitOutput(command, sourcePath, byteLength, signal) { return _SubmitOutput(config, command, sourcePath, byteLength, signal); },
		reportFailure(command, signal) { return _ReportFailure(config, command, signal); },
	};
}

/** Ask OpenCrane for the next job, returning null when there is none. OpenCrane authenticates the worker by TokenReview on its projected token. */
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
			return _ReadBoundedAndValidateJson(response, _MAXIMUM_CLAIM_RESPONSE_BYTES, _ClaimFromUnknown);
		}
		finally
		{
			dispose();
		}
	});
}

/** Stream the source PDF from OpenCrane into a scratch file, refusing to write more than the byte limit. */
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

/** Stream the converted text back to OpenCrane, which hashes, stores, and publishes it. The worker is given no storage location and no storage credential, so it cannot write to the object store itself. */
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

/** Tell OpenCrane this attempt failed, sending one fixed reason code with the current claim. OpenCrane decides whether to retry. */
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

/** Read the projected ServiceAccount token from disk and reject a blank one. It is never cached, so a rotated token is picked up on the next call. */
async function _Authorization(config: ArtifactPreprocessorRemoteConfig): Promise<string>
{
	const token = (await readFile(config.tokenPath, "utf8")).trim();
	if (!token) throw new Error("artifact preprocessor projected token is empty");
	return `Bearer ${token}`;
}

/** Combine the caller's cancellation with this client's own timeout, so a slow OpenCrane call cannot hang forever even when the caller never cancels. */
function _TimeoutAbort(milliseconds: number, parent: AbortSignal): readonly [AbortSignal, () => void]
{
	const controller = new AbortController();
	const timeout = setTimeout(function _timeout() { controller.abort(new Error("artifact preprocessor request timeout")); }, milliseconds);
	function _Abort(): void { controller.abort(parent.reason); }
	if (parent.aborted) _Abort();
	else parent.addEventListener("abort", _Abort, { once: true });
	return [controller.signal, function _dispose() { clearTimeout(timeout); parent.removeEventListener("abort", _Abort); }];
}

/** Pull out the three fields — `jobId`, `attempt`, `claimFence` — that every later broker call must carry. */
function _ClaimCommand(claim: ArtifactPreprocessorJobClaim): ArtifactPreprocessorClaimCommand
{
	return { jobId: claim.lease.jobId, attempt: claim.lease.attempt, claimFence: claim.lease.claimFence };
}

/** Cancel an unexpected response body so the socket is released, then throw a stable protocol error. */
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

/** Decode a claim response, rejecting any unexpected field so a changed server contract fails loudly rather than being silently ignored. */
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

/**
 * Read a size-capped response body and validate it before returning anything.
 *
 * The cap is applied twice: once to the declared `Content-Length` and again while streaming, because
 * a declared length is not evidence. So a server that under-declares its body still cannot make
 * this allocate more than `maximumBytes`.
 *
 * @param response - Response whose body is untrusted.
 * @param maximumBytes - Hard byte ceiling, enforced before and during streaming.
 * @param validate - Validator run immediately after JSON decoding.
 * @param validatorArguments - Extra values the validator needs, such as the expected job id.
 * @returns The validated value.
 * @throws Error when the declared length is too large, the streamed body exceeds the cap, the text is not JSON, or the validator rejects it.
 */
async function _ReadBoundedAndValidateJson<T, TArguments extends readonly unknown[]>(response: Response, maximumBytes: number, validate: (candidate: unknown, ...arguments_: TArguments) => T, ...validatorArguments: TArguments): Promise<T>
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

	// 3. Parse only the now-bounded bytes and immediately apply the exact protocol validator.
	return ___ParseAndValidateJson(Buffer.concat(chunks, byteLength).toString("utf8"), "artifact preprocess authority response", validate, ...validatorArguments);
}

/** Require an object to carry exactly the fixed protocol keys. */
function _HasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean
{
	const actual = Object.keys(value);
	return actual.length === keys.length && keys.every(function _has(key) { return key in value; });
}
