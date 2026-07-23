import { Router, type Request, type Response } from "express";

import { ARTIFACT_PREPROCESSOR_PROJECTED_TOKEN_AUDIENCE, ARTIFACT_PREPROCESSOR_SERVICE_ACCOUNT_NAME, type ArtifactPreprocessorOutputLeaseCommand } from "@opencrane/contracts";

import { __ClaimArtifactPreprocessJob, __CompleteArtifactPreprocessJob, __IssueArtifactPreprocessOutputLease } from "./artifact-preprocessing.js";
import type { ArtifactPreprocessorRouterDependencies, ReviewedArtifactPreprocessorIdentity } from "./artifact-preprocessing.types.js";

/**
 * Build the internal PDF-preprocessing API for the sole dedicated worker.
 *
 * **This router is NOT behind `___AuthMiddleware`.** Its separate internal listener is restricted
 * by Kubernetes NetworkPolicy, while TokenReview additionally binds every request to the exact
 * preprocessor ServiceAccount and audience before it can observe catalog work.
 *
 * @see apps/opencrane/helm/templates/_networkpolicy.tpl — protects the server internal listener.
 * @see apps/artifact-preprocessor/helm/templates/_resources.tpl — wires the sole caller identity.
 */
export function __CreateArtifactPreprocessorRouter(dependencies: ArtifactPreprocessorRouterDependencies): Router
{
	const router = Router();

	router.post("/jobs:claim", async function _claim(request: Request, response: Response)
	{
		try
		{
			if (!await _IsPreprocessor(request, dependencies) || !_IsEmptyObject(request.body))
			{
				_RespondProblem(response, 401, "preprocessor_identity_denied");
				return;
			}
			const claim = await __ClaimArtifactPreprocessJob(dependencies.repository, dependencies.signer);
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

	router.put("/jobs/:jobId/output-lease", async function _outputLease(request: Request, response: Response)
	{
		try
		{
			if (!await _IsPreprocessor(request, dependencies))
			{
				_RespondProblem(response, 401, "preprocessor_identity_denied");
				return;
			}
			const command = _ParseOutputLease(request.params["jobId"], request.body);
			if (command === null)
			{
				_RespondProblem(response, 400, "invalid_output_lease");
				return;
			}
			const lease = await __IssueArtifactPreprocessOutputLease(dependencies.repository, dependencies.signer, command);
			if (lease === null)
			{
				_RespondProblem(response, 409, "stale_preprocess_claim");
				return;
			}
			response.status(200).json(lease);
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "artifact_preprocessor.output_lease" }, "Artifact preprocessor output lease failed");
			_RespondProblem(response, 503, "preprocess_authority_unavailable");
		}
	});

	router.put("/jobs/:jobId/complete", async function _complete(request: Request, response: Response)
	{
		try
		{
			if (!await _IsPreprocessor(request, dependencies))
			{
				_RespondProblem(response, 401, "preprocessor_identity_denied");
				return;
			}
			const command = _ParseCompletion(request.params["jobId"], request.body);
			if (command === null)
			{
				_RespondProblem(response, 400, "invalid_completion");
				return;
			}
			const promotion = dependencies.receipts.verifyReceipt(command.promotionReceipt);
			if (promotion === null)
			{
				_RespondProblem(response, 409, "invalid_promotion_receipt");
				return;
			}
			const completed = await __CompleteArtifactPreprocessJob(dependencies.repository, { jobId: command.jobId, attempt: command.attempt, claimFence: command.claimFence, derivedRevisionId: command.derivedRevisionId, promotion, receiptDigest: dependencies.receipts.digestReceipt(command.promotionReceipt) });
			if (!completed)
			{
				_RespondProblem(response, 409, "stale_preprocess_claim");
				return;
			}
			response.status(204).end();
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "artifact_preprocessor.complete" }, "Artifact preprocessor completion failed");
			_RespondProblem(response, 503, "preprocess_authority_unavailable");
		}
	});

	return router;
}

/** TokenReviews one bearer and requires the fixed preprocessor identity. */
async function _IsPreprocessor(request: Request, dependencies: ArtifactPreprocessorRouterDependencies): Promise<boolean>
{
	const token = _BearerValue(request.header("authorization"));
	if (token === null) return false;
	const identity = await dependencies.tokenReviewer.__Review(token);
	return identity !== null && _IdentityMatches(identity, dependencies.namespace);
}

/** Matches every independently reviewed identity coordinate against the fixed worker contract. */
function _IdentityMatches(identity: ReviewedArtifactPreprocessorIdentity, namespace: string): boolean
{
	return identity.username === `system:serviceaccount:${namespace}:${ARTIFACT_PREPROCESSOR_SERVICE_ACCOUNT_NAME}` && identity.namespace === namespace && identity.serviceAccountName === ARTIFACT_PREPROCESSOR_SERVICE_ACCOUNT_NAME && identity.audiences.includes(ARTIFACT_PREPROCESSOR_PROJECTED_TOKEN_AUDIENCE);
}

/** Accepts one unambiguous standard bearer credential. */
function _BearerValue(value: string | undefined): string | null
{
	return value === undefined ? null : /^Bearer ([^\s,]+)$/u.exec(value)?.[1] ?? null;
}

/** Requires an empty object for an authority-owned polling request. */
function _IsEmptyObject(value: unknown): boolean
{
	return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
}

/** Parses the fixed exact-byte output request without accepting caller-added policy fields. */
function _ParseOutputLease(jobId: unknown, value: unknown): ArtifactPreprocessorOutputLeaseCommand | null
{
	if (typeof jobId !== "string" || !jobId || value === null || typeof value !== "object" || Array.isArray(value)) return null;
	const body = value as Record<string, unknown>;
	if (Object.keys(body).length !== 5 || !["jobId", "attempt", "claimFence", "contentAddress", "byteLength"].every(function _has(key) { return key in body; })) return null;
	return typeof body["jobId"] === "string" && body["jobId"] === jobId && typeof body["attempt"] === "number" && typeof body["claimFence"] === "string" && typeof body["contentAddress"] === "string" && typeof body["byteLength"] === "number" ? { jobId, attempt: body["attempt"], claimFence: body["claimFence"], contentAddress: body["contentAddress"], byteLength: body["byteLength"] } : null;
}

/** Parses the exact completion evidence without accepting a caller-selected catalog coordinate. */
function _ParseCompletion(jobId: unknown, value: unknown): { readonly jobId: string; readonly attempt: number; readonly claimFence: string; readonly derivedRevisionId: string; readonly promotionReceipt: string } | null
{
	if (typeof jobId !== "string" || !jobId || value === null || typeof value !== "object" || Array.isArray(value)) return null;
	const body = value as Record<string, unknown>;
	if (Object.keys(body).length !== 5 || !["jobId", "attempt", "claimFence", "derivedRevisionId", "promotionReceipt"].every(function _has(key) { return key in body; })) return null;
	return typeof body["jobId"] === "string" && body["jobId"] === jobId && typeof body["attempt"] === "number" && typeof body["claimFence"] === "string" && typeof body["derivedRevisionId"] === "string" && typeof body["promotionReceipt"] === "string" ? { jobId, attempt: body["attempt"], claimFence: body["claimFence"], derivedRevisionId: body["derivedRevisionId"], promotionReceipt: body["promotionReceipt"] } : null;
}

/** Writes one bounded internal problem response. */
function _RespondProblem(response: Response, status: number, reason: string): void
{
	response.status(status).json({ error: reason });
}
