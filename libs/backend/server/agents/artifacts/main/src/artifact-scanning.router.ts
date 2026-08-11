import { Router, type Request, type Response } from "express";

import { ARTIFACT_SCANNER_PROJECTED_TOKEN_AUDIENCE, ARTIFACT_SCANNER_SERVICE_ACCOUNT_NAME, ArtifactScannerVerdict, type ArtifactScannerClaimCommand, type ArtifactScannerFailureCommand, type ArtifactScannerResultCommand } from "@opencrane/contracts";

import type { ArtifactScannerRouterDependencies } from "./artifact-scanning.types.js";

/** Create the TokenReview-protected scanner job and byte-broker router. */
export function __CreateArtifactScannerRouter(dependencies: ArtifactScannerRouterDependencies): Router
{
	const router = Router();
	router.post("/jobs:claim", function _Claim(request, response) { void _Handle(request, response, dependencies, async function _Work() { const claim = await dependencies.authority.claim(); if (claim === null) response.status(204).end(); else response.status(200).json(claim); }); });
	router.post("/jobs/:jobId/source", function _Source(request, response) { void _Handle(request, response, dependencies, async function _Work() { const command = _ClaimCommand(request); if (command === null) return response.status(400).json({ error: "invalid_request" }); const source = await dependencies.authority.readSource(command); if (source === null) return response.status(409).json({ error: "stale_claim" }); response.status(200).type(source.mediaType).setHeader("content-length", String(source.byteLength)); for await (const chunk of await dependencies.sourceBroker.open(source)) response.write(chunk); response.end(); }); });
	router.put("/jobs/:jobId/result", function _Result(request, response) { void _Handle(request, response, dependencies, async function _Work() { const command = _ResultCommand(request); if (command === null) return response.status(400).json({ error: "invalid_request" }); const result = await dependencies.authority.complete(command); response.status(result === "stale" ? 409 : 204).end(); }); });
	router.put("/jobs/:jobId/failure", function _Failure(request, response) { void _Handle(request, response, dependencies, async function _Work() { const command = _FailureCommand(request); if (command === null) return response.status(400).json({ error: "invalid_request" }); const result = await dependencies.authority.fail(command); response.status(result === "stale" ? 409 : 204).end(); }); });
	return router;
}

/** Authenticate the exact scanner identity before any authority call. */
async function _Handle(request: Request, response: Response, dependencies: ArtifactScannerRouterDependencies, work: () => Promise<unknown>): Promise<void>
{
	try
	{
		const token = request.header("authorization")?.match(/^Bearer (.+)$/u)?.[1];
		const identity = token ? await dependencies.tokenReviewer.__Review(token) : null;
		const expectedUsername = `system:serviceaccount:${dependencies.expectedNamespace}:${ARTIFACT_SCANNER_SERVICE_ACCOUNT_NAME}`;
		if (identity === null || identity.username !== expectedUsername || identity.namespace !== dependencies.expectedNamespace || identity.serviceAccountName !== ARTIFACT_SCANNER_SERVICE_ACCOUNT_NAME || !identity.audiences.includes(ARTIFACT_SCANNER_PROJECTED_TOKEN_AUDIENCE)) { response.status(401).json({ error: "unauthorized" }); return; }
		await work();
	}
	catch (err)
	{
		dependencies.logger.error({ err }, "artifact scanner request failed");
		if (!response.headersSent) response.status(503).json({ error: "temporarily_unavailable" });
		else response.destroy();
	}
}

/** Parse exact claim coordinates from JSON or private headers. */
function _ClaimCommand(request: Request): ArtifactScannerClaimCommand | null
{
	const attempt = Number(request.header("x-opencrane-scan-attempt") ?? request.body?.attempt);
	const claimFence = request.header("x-opencrane-scan-fence") ?? request.body?.claimFence;
	const rawJobId = request.params["jobId"];
	const jobId = typeof rawJobId === "string" ? rawJobId : null;
	return jobId && Number.isSafeInteger(attempt) && attempt > 0 && typeof claimFence === "string" && claimFence ? { jobId, attempt, claimFence } : null;
}

/** Parse one exact clean/rejected result. */
function _ResultCommand(request: Request): ArtifactScannerResultCommand | null
{
	const claim = _ClaimCommand(request);
	const verdict = request.body?.verdict;
	const scannerVersion = request.body?.scannerVersion;
	return claim !== null && (verdict === ArtifactScannerVerdict.Clean || verdict === ArtifactScannerVerdict.Rejected) && typeof scannerVersion === "string" && scannerVersion ? { ...claim, verdict, scannerVersion } : null;
}

/** Parse one bounded worker failure. */
function _FailureCommand(request: Request): ArtifactScannerFailureCommand | null
{
	const claim = _ClaimCommand(request);
	const failureCode = request.body?.failureCode;
	return claim !== null && (failureCode === "source_read_failed" || failureCode === "scanner_failed") ? { ...claim, failureCode } : null;
}
