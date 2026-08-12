import { createHash } from "node:crypto";

import { Router, type Request, type Response } from "express";

import type { SteeringIngestCaller, SteeringIngestRequestBody, SteeringIngestRouterDependencies } from "./steering-ingest.router.types.js";

/** Longest steering instruction accepted, so it stays safe to store and to put in a prompt. */
const _MAX_STEERING_CHARACTERS = 4_000;

/**
 * Create the steering router: the caller needs a browser session, and may steer only their own run.
 *
 * The route accepts nothing but a single `text` field, and derives the owner, the silo, and the run
 * attempt on the server. Nothing about which run or which attempt comes from the caller beyond the
 * run id in the path, and ownership is proved inside the write transaction.
 *
 * Called by: `_CreateSteeringIngestRouter` (prisma-steering-ingest.router.ts), which
 * apps/opencrane/src/app/routes.ts mounts at /api/v1/me/runs.
 *
 * @param dependencies - Caller resolution, the steering queue, a clock, and a logger.
 * @returns An Express router exposing POST /:runId/steering.
 * @see SteeringRequestRepository for which status code each outcome produces.
 */
export function __CreateSteeringIngestRouter(dependencies: SteeringIngestRouterDependencies): Router
{
	const router = Router();

	router.post("/:runId/steering", async function _submit(request: Request, response: Response)
	{
		const caller = _requireCaller(request, response, dependencies);
		const runId = request.params["runId"];
		const body = _body(request.body);
		if (caller === null) return;
		if (typeof runId !== "string" || !runId.trim() || body === null) { _respond(response, 400, "invalid_steering_request"); return; }

		try
		{
			const content = { text: body.text };
			const idempotencyDigest = _hash(body.idempotencyKey);
			const result = await dependencies.requests.submitAtomically({ runId, siloId: caller.siloId, subjectId: caller.subjectId, content, idempotencyDigest, digest: `${idempotencyDigest}:${_hash(content)}`, submittedAt: dependencies.clock.now() });
			if (result.outcome === "queued") { response.status(202).json({ steeringRequestId: result.steeringRequestId, attempt: result.attempt, state: "pending" }); return; }
			if (result.outcome === "idempotent") { response.status(200).json({ steeringRequestId: result.steeringRequestId, attempt: result.attempt, state: "pending" }); return; }
			if (result.outcome === "idempotency_conflict") { _respond(response, 409, "steering_idempotency_conflict"); return; }
			if (result.outcome === "run_not_steerable") { _respond(response, 409, "run_not_steerable"); return; }
			_respond(response, 404, "run_not_found");
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "runtime_steering.submit", siloId: caller.siloId }, "Runtime steering submission failed");
			_respond(response, 503, "steering_unavailable");
		}
	});

	return router;
}

/** Return the caller from the session, or write a 401 that reveals nothing about the run. */
function _requireCaller(request: Request, response: Response, dependencies: SteeringIngestRouterDependencies): SteeringIngestCaller | null
{
	const caller = dependencies.resolveCaller(request);
	if (caller === null) _respond(response, 401, "steering_authentication_required");
	return caller;
}

/** Accept only a body of `{ text }` within the length limit; the caller cannot send any other field. */
function _body(body: unknown): SteeringIngestRequestBody | null
{
	if (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 2) return null;
	const text = (body as Record<string, unknown>)["text"];
	const idempotencyKey = (body as Record<string, unknown>)["idempotencyKey"];
	if (typeof text !== "string" || typeof idempotencyKey !== "string") return null;
	const trimmed = text.trim();
	const key = idempotencyKey.trim();
	return trimmed && trimmed.length <= _MAX_STEERING_CHARACTERS && key && key.length <= 128 ? { text: trimmed, idempotencyKey: key } : null;
}

/** Hash a retry coordinate or accepted instruction without storing the browser key. */
function _hash(content: string | { readonly text: string }): string
{
	const value = typeof content === "string" ? content : JSON.stringify(content);
	return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

/** Write one bounded JSON problem response. */
function _respond(response: Response, status: number, error: string): void
{
	response.status(status).json({ error });
}
