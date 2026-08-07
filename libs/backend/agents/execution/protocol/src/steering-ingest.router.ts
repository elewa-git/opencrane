import { createHash } from "node:crypto";

import { Router, type Request, type Response } from "express";

import type { SteeringIngestCaller, SteeringIngestRouterDependencies } from "./steering-ingest.router.types.js";

/** Largest accepted steering instruction, keeping it safe for durable event and prompt handling. */
const _MAX_STEERING_CHARACTERS = 4_000;

/** Create the browser-session-authenticated, self-only runtime steering ingest router. */
export function __CreateSteeringIngestRouter(dependencies: SteeringIngestRouterDependencies): Router
{
	const router = Router();

	router.post("/:runId/steering", async function _submit(request: Request, response: Response)
	{
		const caller = _requireCaller(request, response, dependencies);
		const runId = request.params["runId"];
		const text = _text(request.body);
		if (caller === null) return;
		if (typeof runId !== "string" || !runId.trim() || text === null) { _respond(response, 400, "invalid_steering_request"); return; }

		try
		{
			const content = { text };
			const result = await dependencies.requests.submitAtomically({ runId, siloId: caller.siloId, subjectId: caller.subjectId, content, digest: _digest(content), submittedAt: dependencies.clock.now() });
			if (result.outcome === "queued") { response.status(202).json({ steeringRequestId: result.steeringRequestId, attempt: result.attempt, state: "pending" }); return; }
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

/** Resolve one session-derived caller or write a non-disclosing authentication denial. */
function _requireCaller(request: Request, response: Response, dependencies: SteeringIngestRouterDependencies): SteeringIngestCaller | null
{
	const caller = dependencies.resolveCaller(request);
	if (caller === null) _respond(response, 401, "steering_authentication_required");
	return caller;
}

/** Accept one exact bounded text body rather than caller-chosen runtime coordinates or payloads. */
function _text(body: unknown): string | null
{
	if (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1) return null;
	const text = (body as Record<string, unknown>)["text"];
	if (typeof text !== "string") return null;
	const trimmed = text.trim();
	return trimmed && trimmed.length <= _MAX_STEERING_CHARACTERS ? trimmed : null;
}

/** Digest the accepted canonical instruction without retaining a browser-supplied identifier. */
function _digest(content: { readonly text: string }): string
{
	return `sha256:${createHash("sha256").update(JSON.stringify(content), "utf8").digest("hex")}`;
}

/** Write one bounded JSON problem response. */
function _respond(response: Response, status: number, error: string): void
{
	response.status(status).json({ error });
}
