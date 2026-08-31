import { once } from "node:events";

import { Router, type Request, type Response } from "express";

import { ARTIFACT_PREPROCESSOR_PROJECTED_TOKEN_AUDIENCE, ARTIFACT_PREPROCESSOR_SERVICE_ACCOUNT_NAME, type ArtifactPreprocessorClaimCommand, type ArtifactPreprocessorFailureCode, type ArtifactPreprocessorFailureCommand } from "@opencrane/contracts";

import { __FailArtifactPreprocessJob } from "./artifact-preprocessing";
import type { ArtifactPreprocessorRouterDependencies, ReviewedArtifactPreprocessorIdentity } from "./artifact-preprocessing.types";

/**
 * Build the internal PDF-preprocessing API for the sole dedicated worker.
 *
 * **This router is NOT behind `___AuthMiddleware`.** Its separate internal listener is restricted
 * by Kubernetes NetworkPolicy, while TokenReview additionally binds every request to the exact
 * preprocessor ServiceAccount and audience before it can observe catalogue work. Source and output
 * bytes are brokered through OpenCrane, so storage endpoints, leases, and receipts never reach the
 * worker namespace.
 *
 * Three routes serve work already assigned by the workflow controller:
 * `POST /jobs/:jobId/source` streams the PDF, `PUT /jobs/:jobId/output` submits the text, and
 * `PUT /jobs/:jobId/failure` reports a failed delivery. A 409 means the delivery is no longer
 * current and the worker must stop handling it.
 *
 * A failure report may use only three codes: `source_read_failed`, `conversion_failed`, and
 * `output_submission_failed`. The set is closed on purpose. The worker holds the untrusted PDF,
 * so anything it can put in a failure report - an exception message, a temporary file path, text
 * pulled out of the document - would flow straight into server logs and the job row. Three fixed
 * words say which step broke, which is all the server-owned retry policy needs, and carry nothing
 * an attacker-supplied document could influence. Adding a free-text field would reopen that.
 *
 * Called by: `_CreateOptionalRuntimeComposition` in apps/opencrane/src/app/runtime-composition.ts
 * builds it; the worker's HTTP client is
 * libs/backend/artifacts/preprocessor/main/src/remote.ts.
 *
 * @param dependencies - Token reviewer, allowed namespace, repository, both byte brokers, and logger.
 * @returns An Express router to mount on the internal listener, never the public one.
 * @see apps/opencrane/helm/templates/_networkpolicy.tpl - protects the server internal listener.
 * @see apps/artifact-preprocessor/helm/templates/_resources.tpl - wires the sole caller identity.
 */
export function __CreateArtifactPreprocessorRouter(dependencies: ArtifactPreprocessorRouterDependencies): Router
{
	const router = Router();

	router.post("/jobs:bootstrap", async function _Bootstrap(request: Request, response: Response): Promise<void>
	{
		try
		{
			if (!await _IsPreprocessor(request, dependencies))
			{
				_RespondProblem(response, 401, "preprocessor_identity_denied");
				return;
			}
			const reference = _ParseBootstrapReference(request.body);
			const claim = reference === null ? null : await dependencies.repository.loadWorkerBootstrap(reference, dependencies.namespace);
			if (claim === null)
			{
				_RespondProblem(response, 409, "preprocess_bootstrap_denied");
				return;
			}
			response.status(200).json(claim);
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "artifact_preprocessor.bootstrap" }, "Artifact preprocessor bootstrap failed");
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
			if (!response.headersSent)
			{
				_RespondProblem(response, 503, "preprocess_source_unavailable");
			}
			else
			{
				response.destroy();
			}
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
			// RFC 6648 deprecated the X- prefix, but these two headers are private OpenCrane fields
			// between the server and its own worker, never proposed as standard HTTP, so the prefix
			// is kept to make that obvious. See https://www.rfc-editor.org/rfc/rfc6648 for the
			// deprecation this deliberately does not follow.
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

/** Ask Kubernetes who the bearer token belongs to, and accept only the one preprocessor ServiceAccount. */
async function _IsPreprocessor(request: Request, dependencies: ArtifactPreprocessorRouterDependencies): Promise<boolean>
{
	const token = _BearerValue(request.header("authorization"));
	if (token === null)
	{
		return false;
	}
	const identity = await dependencies.tokenReviewer.__Review(token);
	return identity !== null && _IdentityMatches(identity, dependencies.namespace);
}

/** Check the reviewed username, namespace, ServiceAccount name, and audience all match the one allowed worker. */
function _IdentityMatches(identity: ReviewedArtifactPreprocessorIdentity, namespace: string): boolean
{
	return identity.username === `system:serviceaccount:${namespace}:${ARTIFACT_PREPROCESSOR_SERVICE_ACCOUNT_NAME}`
		&& identity.namespace === namespace
		&& identity.serviceAccountName === ARTIFACT_PREPROCESSOR_SERVICE_ACCOUNT_NAME
		&& identity.audiences.includes(ARTIFACT_PREPROCESSOR_PROJECTED_TOKEN_AUDIENCE);
}

/** Reads the opaque reference from an exact one-field request body. */
function _ParseBootstrapReference(value: unknown): string | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value))
	{
		return null;
	}
	const body = value as Record<string, unknown>;
	return Object.keys(body).length === 1 && typeof body["reference"] === "string" ? body["reference"] : null;
}

/** Accept one unambiguous standard bearer credential. */
function _BearerValue(value: string | undefined): string | null
{
	return value === undefined ? null : /^Bearer ([^\s,]+)$/u.exec(value)?.[1] ?? null;
}

/** Read the job id, attempt, and fence from the body, rejecting any extra field so a worker cannot smuggle in a value the server owns. */
function _ParseClaimCommand(jobId: unknown, value: unknown): ArtifactPreprocessorClaimCommand | null
{
	if (typeof jobId !== "string" || jobId.length === 0 || value === null || typeof value !== "object" || Array.isArray(value))
	{
		return null;
	}
	const body = value as Record<string, unknown>;
	if (Object.keys(body).length !== 3 || !["jobId", "attempt", "claimFence"].every(function _Has(key): boolean { return key in body; }))
	{
		return null;
	}
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

/** Read the failure code plus the job id, attempt, and fence, rejecting anything else. */
function _ParseFailure(jobId: unknown, value: unknown): ArtifactPreprocessorFailureCommand | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value))
	{
		return null;
	}
	const body = value as Record<string, unknown>;
	if (Object.keys(body).length !== 4 || typeof body["failureCode"] !== "string" || !_IsFailureCode(body["failureCode"]))
	{
		return null;
	}
	const claim = _ParseClaimCommand(jobId, { jobId: body["jobId"], attempt: body["attempt"], claimFence: body["claimFence"] });
	return claim === null ? null : { ...claim, failureCode: body["failureCode"] };
}

/** Accept only the three fixed failure codes, so nothing derived from the untrusted PDF - an exception message, a file path, document text - can reach server logs or the job row. */
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
		if (!response.write(chunk))
		{
			await once(response, "drain");
		}
	}
	response.end();
}

/** Write one bounded internal problem response. */
function _RespondProblem(response: Response, status: number, reason: string): void
{
	response.status(status).json({ error: reason });
}
