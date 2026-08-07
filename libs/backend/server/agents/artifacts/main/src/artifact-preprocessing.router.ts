import { once } from "node:events";

import { Router, type Request, type Response } from "express";

import { ARTIFACT_PREPROCESSOR_PROJECTED_TOKEN_AUDIENCE, ARTIFACT_PREPROCESSOR_SERVICE_ACCOUNT_NAME, type ArtifactPreprocessorClaimCommand, type ArtifactPreprocessorFailureCode, type ArtifactPreprocessorFailureCommand } from "@opencrane/contracts";

import { __ClaimArtifactPreprocessJob, __FailArtifactPreprocessJob } from "./artifact-preprocessing.js";
import type { ArtifactPreprocessorRouterDependencies, ReviewedArtifactPreprocessorIdentity } from "./artifact-preprocessing.types.js";

/**
 * Build the internal PDF-preprocessing API for the sole dedicated worker.
 *
 * **This router is NOT behind `___AuthMiddleware`.** Its separate internal listener is restricted
 * by Kubernetes NetworkPolicy, while TokenReview additionally binds every request to the exact
 * preprocessor ServiceAccount and audience before it can observe catalogue work. Source and output
 * bytes are brokered through OpenCrane, so storage endpoints, leases, and receipts never reach the
 * worker namespace.
 *
 * @see apps/opencrane/helm/templates/_networkpolicy.tpl - protects the server internal listener.
 * @see apps/artifact-preprocessor/helm/templates/_resources.tpl - wires the sole caller identity.
 */
export function __CreateArtifactPreprocessorRouter(dependencies: ArtifactPreprocessorRouterDependencies): Router
{
	const router = Router();

	router.post("/jobs:claim", async function _Claim(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsPreprocessor(request, dependencies) || !_IsEmptyObject(request.body))
			{
				_RespondProblem(response, 401, "preprocessor_identity_denied");
				return;
			}
			const claim = await __ClaimArtifactPreprocessJob(dependencies.repository);
			if (claim === null)
			{
				response.status(204).end();
				return;
			}
			response.status(200).json(claim);
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "artifact_preprocessor.claim" }, "Artifact preprocessor claim failed");
			_RespondProblem(response, 503, "preprocess_authority_unavailable");
		}
	});

	router.post("/jobs/:jobId/source", async function _Source(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsPreprocessor(request, dependencies))
			{
				_RespondProblem(response, 401, "preprocessor_identity_denied");
				return;
			}
			const command = _ParseClaimCommand(request.params["jobId"], request.body);
			if (command === null)
			{
				_RespondProblem(response, 400, "invalid_preprocess_claim");
				return;
			}
			const source = await dependencies.sourceBroker.read(command);
			if (source === null)
			{
				_RespondProblem(response, 409, "stale_preprocess_claim");
				return;
			}
			response.status(200);
			response.setHeader("content-type", source.mediaType);
			response.setHeader("content-length", String(source.byteLength));
			response.setHeader("cache-control", "no-store");
			response.setHeader("x-content-type-options", "nosniff");
			await _WriteBytes(response, source.bytes);
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "artifact_preprocessor.source" }, "Artifact preprocessor source broker failed");
			if (!response.headersSent) _RespondProblem(response, 503, "preprocess_source_unavailable");
			else response.destroy();
		}
	});

	router.put("/jobs/:jobId/output", async function _Output(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsPreprocessor(request, dependencies))
			{
				_RespondProblem(response, 401, "preprocessor_identity_denied");
				return;
			}
			// RFC 6648 deprecated the X- convention, but these request-only headers intentionally
			// remain private OpenCrane protocol fields and are never represented as standard HTTP.
			const command = _ParseClaimHeaders(request.params["jobId"], request.header("x-opencrane-preprocess-attempt"), request.header("x-opencrane-preprocess-fence"));
			if (command === null || !Buffer.isBuffer(request.body))
			{
				_RespondProblem(response, 400, "invalid_preprocess_output");
				return;
			}
			const result = await dependencies.outputBroker.publish(command, _OneChunk(request.body));
			if (result === "conflict")
			{
				_RespondProblem(response, 409, "stale_preprocess_claim");
				return;
			}
			response.status(204).end();
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "artifact_preprocessor.output" }, "Artifact preprocessor output broker failed");
			_RespondProblem(response, 503, "preprocess_output_unavailable");
		}
	});

	router.put("/jobs/:jobId/failure", async function _Failure(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsPreprocessor(request, dependencies))
			{
				_RespondProblem(response, 401, "preprocessor_identity_denied");
				return;
			}
			const command = _ParseFailure(request.params["jobId"], request.body);
			if (command === null)
			{
				_RespondProblem(response, 400, "invalid_preprocess_failure");
				return;
			}
			const result = await __FailArtifactPreprocessJob(dependencies.repository, command);
			if (result.status === "conflict")
			{
				_RespondProblem(response, 409, "stale_preprocess_claim");
				return;
			}
			response.status(204).end();
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "artifact_preprocessor.failure" }, "Artifact preprocessor failure report failed");
			_RespondProblem(response, 503, "preprocess_authority_unavailable");
		}
	});

	return router;
}

/** TokenReview one bearer and require the fixed preprocessor identity. */
async function _IsPreprocessor(request: Request, dependencies: ArtifactPreprocessorRouterDependencies): Promise<boolean>
{
	const token = _BearerValue(request.header("authorization"));
	if (token === null) return false;
	const identity = await dependencies.tokenReviewer.__Review(token);
	return identity !== null && _IdentityMatches(identity, dependencies.namespace);
}

/** Match every independently reviewed identity coordinate against the fixed worker contract. */
function _IdentityMatches(identity: ReviewedArtifactPreprocessorIdentity, namespace: string): boolean
{
	return identity.username === `system:serviceaccount:${namespace}:${ARTIFACT_PREPROCESSOR_SERVICE_ACCOUNT_NAME}`
		&& identity.namespace === namespace
		&& identity.serviceAccountName === ARTIFACT_PREPROCESSOR_SERVICE_ACCOUNT_NAME
		&& identity.audiences.includes(ARTIFACT_PREPROCESSOR_PROJECTED_TOKEN_AUDIENCE);
}

/** Accept one unambiguous standard bearer credential. */
function _BearerValue(value: string | undefined): string | null
{
	return value === undefined ? null : /^Bearer ([^\s,]+)$/u.exec(value)?.[1] ?? null;
}

/** Require an empty object for an authority-owned polling request. */
function _IsEmptyObject(value: unknown): boolean
{
	return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
}

/** Parse exact live-claim coordinates without accepting caller-added policy fields. */
function _ParseClaimCommand(jobId: unknown, value: unknown): ArtifactPreprocessorClaimCommand | null
{
	if (typeof jobId !== "string" || jobId.length === 0 || value === null || typeof value !== "object" || Array.isArray(value)) return null;
	const body = value as Record<string, unknown>;
	if (Object.keys(body).length !== 3 || !["jobId", "attempt", "claimFence"].every(function _Has(key): boolean { return key in body; })) return null;
	return body["jobId"] === jobId && Number.isSafeInteger(body["attempt"]) && (body["attempt"] as number) > 0 && typeof body["claimFence"] === "string" && body["claimFence"].length > 0
		? { jobId, attempt: body["attempt"] as number, claimFence: body["claimFence"] }
		: null;
}

/** Parse the two private request headers that bind raw output bytes to one current claim. */
function _ParseClaimHeaders(jobId: unknown, attempt: string | undefined, claimFence: string | undefined): ArtifactPreprocessorClaimCommand | null
{
	const parsedAttempt = Number(attempt);
	return typeof jobId === "string" && jobId.length > 0 && Number.isSafeInteger(parsedAttempt) && parsedAttempt > 0 && typeof claimFence === "string" && claimFence.length > 0
		? { jobId, attempt: parsedAttempt, claimFence }
		: null;
}

/** Parse one bounded failure category and exact live-claim coordinates. */
function _ParseFailure(jobId: unknown, value: unknown): ArtifactPreprocessorFailureCommand | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
	const body = value as Record<string, unknown>;
	if (Object.keys(body).length !== 4 || typeof body["failureCode"] !== "string" || !_IsFailureCode(body["failureCode"])) return null;
	const claim = _ParseClaimCommand(jobId, { jobId: body["jobId"], attempt: body["attempt"], claimFence: body["claimFence"] });
	return claim === null ? null : { ...claim, failureCode: body["failureCode"] };
}

/** Keep failure reports within the protocol's stable non-sensitive vocabulary. */
function _IsFailureCode(value: string): value is ArtifactPreprocessorFailureCode
{
	return value === "source_read_failed" || value === "conversion_failed" || value === "output_submission_failed";
}

/** Expose a parsed raw body through the broker's streaming interface without copying it. */
async function* _OneChunk(body: Buffer): AsyncGenerator<Uint8Array>
{
	yield body;
}

/** Stream brokered source bytes with response backpressure and no in-memory source copy. */
async function _WriteBytes(response: Response, bytes: AsyncIterable<Uint8Array>): Promise<void>
{
	for await (const chunk of bytes)
	{
		if (!response.write(chunk)) await once(response, "drain");
	}
	response.end();
}

/** Write one bounded internal problem response. */
function _RespondProblem(response: Response, status: number, reason: string): void
{
	response.status(status).json({ error: reason });
}
