import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { ArtifactPreprocessorCompletionCommand, ArtifactPreprocessorJobClaim, ArtifactPreprocessorOutputLease, ArtifactPreprocessorOutputLeaseCommand } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/observability";

import type { ArtifactPreprocessorRemote, ArtifactPreprocessorRemoteConfig } from "./preprocessor.types.js";

/** Bounded OpenCrane response read while its request deadline remains active. */
interface AuthorityResponse
{
	/** HTTP status returned by the internal authority. */
	readonly status: number;
	/** Whether the HTTP status is in the successful 2xx range. */
	readonly ok: boolean;
	/** Parsed JSON response body, absent for the deliberately empty 204 protocol result. */
	readonly body: unknown | null;
}

/** Create the remote adapter that reads a rotating projected token for each OpenCrane call. */
export function _CreateArtifactPreprocessorRemote(config: ArtifactPreprocessorRemoteConfig): ArtifactPreprocessorRemote
{
	return {
		claim(signal) { return _Claim(config, signal); },
		readSource(claim, destinationPath, maximumBytes, signal) { return _ReadSource(config, claim, destinationPath, maximumBytes, signal); },
		issueOutputLease(command, signal) { return _IssueOutputLease(config, command, signal); },
		promoteOutput(writeLease, output, signal) { return _PromoteOutput(config, writeLease, output, signal); },
		complete(command, signal) { return _Complete(config, command, signal); },
	};
}

/** Claim one job through the TokenReview-protected OpenCrane internal route. */
async function _Claim(config: ArtifactPreprocessorRemoteConfig, signal: AbortSignal): Promise<ArtifactPreprocessorJobClaim | null>
{
	const response = await _OpenCraneRequest(config, "/api/internal/artifact-preprocessor/jobs:claim", "POST", {}, signal);
	if (response.status === 204) return null;
	if (!response.ok) throw new Error(`artifact preprocess claim failed with HTTP ${response.status}`);
	return _ClaimFromUnknown(response.body);
}

/** Stream source bytes only through the signed artifact read capability and verify its CAS digest. */
async function _ReadSource(config: ArtifactPreprocessorRemoteConfig, claim: ArtifactPreprocessorJobClaim, destinationPath: string, maximumBytes: number, signal: AbortSignal): Promise<void>
{
	await ___DoWithTrace("artifact_preprocessor.source.read", { jobId: claim.lease.jobId, attempt: claim.lease.attempt, sourceByteLength: claim.sourceByteLength }, async function _read()
	{
		const controller = _TimeoutAbort(config.requestTimeoutMilliseconds, signal);
		try
		{
			// X-OpenCrane-Artifact-Lease is the private capability header consumed by artifact-service.
			// @see https://www.rfc-editor.org/rfc/rfc6648
			const response = await fetch(`${config.artifactServiceUrl}/v1/artifacts/read/${claim.sourceContentAddress}`, { headers: { "x-opencrane-artifact-lease": claim.sourceReadLease }, signal: controller.signal });
			if (!response.ok || response.body === null) throw new Error(`artifact source read failed with HTTP ${response.status}`);
			const digest = createHash("sha256");
			let byteLength = 0;
			const bound = new Transform({ transform(chunk: Uint8Array, _encoding, callback)
			{
				byteLength += chunk.byteLength;
				if (byteLength > maximumBytes || byteLength > claim.sourceByteLength)
				{
					callback(new Error("artifact source bytes exceed the fenced claim limit"));
					return;
				}
				digest.update(chunk);
				callback(null, chunk);
			} });
			await pipeline(Readable.fromWeb(response.body as never), bound, createWriteStream(destinationPath, { flags: "wx", mode: 0o600 }), { signal: controller.signal });
			if (byteLength !== claim.sourceByteLength || `sha256:${digest.digest("hex")}` !== claim.sourceContentAddress)
			{
				throw new Error("artifact source bytes do not match the claimed canonical address");
			}
		}
		finally
		{
			controller.dispose();
		}
	});
}

/** Ask OpenCrane to sign one output lease whose bytes are already hashed by this worker. */
async function _IssueOutputLease(config: ArtifactPreprocessorRemoteConfig, command: ArtifactPreprocessorOutputLeaseCommand, signal: AbortSignal): Promise<ArtifactPreprocessorOutputLease>
{
	const response = await _OpenCraneRequest(config, `/api/internal/artifact-preprocessor/jobs/${encodeURIComponent(command.jobId)}/output-lease`, "PUT", command, signal);
	if (!response.ok) throw new Error(`artifact preprocess output lease failed with HTTP ${response.status}`);
	return _OutputLeaseFromUnknown(response.body);
}

/** Promote derived bytes directly to ArtifactStore without copying them through OpenCrane. */
async function _PromoteOutput(config: ArtifactPreprocessorRemoteConfig, writeLease: string, output: Uint8Array, signal: AbortSignal): Promise<string>
{
	return ___DoWithTrace("artifact_preprocessor.output.promote", { outputByteLength: output.byteLength }, async function _promote()
	{
		const controller = _TimeoutAbort(config.requestTimeoutMilliseconds, signal);
		try
		{
			// X-OpenCrane-Artifact-Lease is the private capability header consumed by artifact-service.
			// @see https://www.rfc-editor.org/rfc/rfc6648
			const response = await fetch(`${config.artifactServiceUrl}/v1/artifacts/promote`, { method: "POST", headers: { "x-opencrane-artifact-lease": writeLease, "content-type": "text/plain; charset=utf-8" }, body: Buffer.from(output), signal: controller.signal });
			if (response.status !== 201) throw new Error(`artifact output promotion failed with HTTP ${response.status}`);
			const value = await response.json() as unknown;
			if (value === null || typeof value !== "object" || typeof (value as Record<string, unknown>)["receipt"] !== "string") throw new Error("artifact output promotion returned no receipt");
			return (value as Record<string, unknown>)["receipt"] as string;
		}
		finally
		{
			controller.dispose();
		}
	});
}

/** Consume the independent promotion receipt through the still-fenced OpenCrane completion route. */
async function _Complete(config: ArtifactPreprocessorRemoteConfig, command: ArtifactPreprocessorCompletionCommand, signal: AbortSignal): Promise<void>
{
	const response = await _OpenCraneRequest(config, `/api/internal/artifact-preprocessor/jobs/${encodeURIComponent(command.jobId)}/complete`, "PUT", command, signal);
	if (response.status !== 204) throw new Error(`artifact preprocess completion failed with HTTP ${response.status}`);
}

/** Make one authenticated JSON request while reading the rotated token immediately before use. */
async function _OpenCraneRequest(config: ArtifactPreprocessorRemoteConfig, path: string, method: "POST" | "PUT", body: object, signal: AbortSignal): Promise<AuthorityResponse>
{
	return ___DoWithTrace("artifact_preprocessor.authority.request", { method, path }, async function _request()
	{
		const controller = _TimeoutAbort(config.requestTimeoutMilliseconds, signal);
		try
		{
			const token = (await readFileAsync(config.tokenPath, "utf8")).trim();
			if (!token) throw new Error("artifact preprocessor projected token is empty");
			const response = await fetch(`${config.openCraneInternalUrl}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
			return { status: response.status, ok: response.ok, body: response.status === 204 ? null : await response.json() };
		}
		finally
		{
			controller.dispose();
		}
	});
}

/** Combine caller cancellation with a bounded independent HTTP deadline. */
function _TimeoutAbort(milliseconds: number, parent: AbortSignal): { readonly signal: AbortSignal; readonly dispose: () => void }
{
	const controller = new AbortController();
	const timeout = setTimeout(function _timeout() { controller.abort(new Error("artifact preprocessor request timeout")); }, milliseconds);
	function _Abort(): void { controller.abort(parent.reason); }
	parent.addEventListener("abort", _Abort, { once: true });
	return { signal: controller.signal, dispose() { clearTimeout(timeout); parent.removeEventListener("abort", _Abort); } };
}

/** Decode one minimally validated, server-owned claim response before using its capabilities. */
function _ClaimFromUnknown(value: unknown): ArtifactPreprocessorJobClaim
{
	if (value === null || typeof value !== "object") throw new Error("artifact preprocess claim was not an object");
	const claim = value as Record<string, unknown>;
	const lease = claim["lease"] as Record<string, unknown> | null;
	if (lease === null || typeof lease !== "object" || typeof lease["jobId"] !== "string" || !lease["jobId"] || !Number.isSafeInteger(lease["attempt"]) || (lease["attempt"] as number) < 1 || typeof lease["claimFence"] !== "string" || !lease["claimFence"] || typeof lease["expiresAt"] !== "string" || typeof claim["sourceRevisionId"] !== "string" || typeof claim["sourceContentAddress"] !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(claim["sourceContentAddress"]) || claim["sourceMediaType"] !== "application/pdf" || !Number.isSafeInteger(claim["sourceByteLength"]) || (claim["sourceByteLength"] as number) < 1 || typeof claim["derivedArtifactId"] !== "string" || typeof claim["sourceReadLease"] !== "string" || !claim["sourceReadLease"]) throw new Error("artifact preprocess claim had an invalid shape");
	return claim as unknown as ArtifactPreprocessorJobClaim;
}

/** Decode one minimally validated server-authorized output capability response. */
function _OutputLeaseFromUnknown(value: unknown): ArtifactPreprocessorOutputLease
{
	if (value === null || typeof value !== "object") throw new Error("artifact preprocess output lease was not an object");
	const lease = value as Record<string, unknown>;
	if (typeof lease["derivedRevisionId"] !== "string" || typeof lease["artifactWriteLease"] !== "string" || lease["lease"] === null || typeof lease["lease"] !== "object") throw new Error("artifact preprocess output lease had an invalid shape");
	return lease as unknown as ArtifactPreprocessorOutputLease;
}
