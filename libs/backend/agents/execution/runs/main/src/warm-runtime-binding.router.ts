import { Router, type Request, type Response } from "express";

import type { Es256PublicJwk } from "@opencrane/models/authorization";

import type { WarmRuntimeBindingRouterDependencies, WarmRuntimeBindingSubmission } from "./warm-runtime-binding.types";

/** Build the dedicated warm Pod one-use binding endpoint. */
export function __CreateWarmRuntimeBindingRouter(dependencies: WarmRuntimeBindingRouterDependencies): Router
{
	const router = Router();
	router.post("/bind", async function _Bind(request: Request, response: Response): Promise<void>
	{
		try
		{
			const token = _Bearer(request.header("authorization"));
			const identity = token === null ? null : await dependencies.tokenReviewer.__Review(token);
			if (identity === null)
			{
				response.status(401).json({ error: "warm_runtime_identity_denied" });
				return;
			}
			const submission = _Submission(request.body);
			if (submission === null)
			{
				response.status(400).json({ error: "invalid_warm_runtime_binding" });
				return;
			}
			const result = await dependencies.authority.bind(identity, submission);
			if (result.outcome === "conflict")
			{
				response.status(409).json({ error: "warm_runtime_binding_conflict" });
				return;
			}
			response.status(200).json({ receiptId: result.receiptId, attemptModelKey: result.attemptModelKey });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "warm_runtime.bind" }, "Warm runtime binding failed");
			response.status(503).json({ error: "warm_runtime_binding_unavailable" });
		}
	});
	return router;
}

/** Parse one standard bearer value without accepting lists or whitespace. */
function _Bearer(value: string | undefined): string | null
{
	return value === undefined ? null : /^Bearer ([^\s,]+)$/u.exec(value)?.[1] ?? null;
}

/** Parse only public proof-key evidence; Pod coordinates come from TokenReview. */
function _Submission(value: unknown): WarmRuntimeBindingSubmission | null
{
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (Object.keys(record).length !== 2 || !("proofPublicJwk" in record) || !("proofKeyThumbprint" in record)) return null;
	const thumbprint = record["proofKeyThumbprint"];
	const publicJwk = _Jwk(record["proofPublicJwk"]);
	return typeof thumbprint === "string" && thumbprint.length > 0 && thumbprint.length <= 128 && publicJwk !== null ? { proofPublicJwk: publicJwk, proofKeyThumbprint: thumbprint } : null;
}

/** Accept one complete public P-256 JWK without extra members. */
function _Jwk(value: unknown): Es256PublicJwk | null
{
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (Object.keys(record).length !== 4 || record["kty"] !== "EC" || record["crv"] !== "P-256" || typeof record["x"] !== "string" || typeof record["y"] !== "string" || record["x"].length === 0 || record["y"].length === 0 || record["x"].length > 128 || record["y"].length > 128) return null;
	return { kty: "EC", crv: "P-256", x: record["x"], y: record["y"] };
}
