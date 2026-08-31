import { createHash } from "node:crypto";

import { Router, type Request, type Response } from "express";

import type { SteeringIngestCaller, SteeringIngestRequestBody, SteeringIngestRouterDependencies } from "./steering-ingest.router.types";

/**
 * Longest steering instruction accepted, so it stays safe to store and to put in a prompt.
 *
 * The published contract repeats this number as `maxLength: 4000` on the request body, so the two
 * have to move together.
 * @see _RuntimeSteeringOpenapiPaths in openapi.ts — the schema a client validates against.
 */
const _MAX_STEERING_CHARACTERS = 4_000;

/**
 * Create the steering router: the caller needs a browser session, and may steer only their own run.
 *
 * This is the trust boundary for owner-submitted steering, so it is worth being exact about who
 * decides what. The signed-in caller comes from `dependencies.resolveCaller`, which reads the
 * browser session and the request host; the silo and the subject are never read from the body. The
 * body itself may carry only `text` and `idempotencyKey` and nothing else, and the run attempt is
 * looked up on the server. So the only run coordinate the caller supplies is the run id in the
 * path, and even that is not trusted here: ownership is proved inside the write transaction, under
 * the run's lock, because it can change between this request arriving and the row being written.
 *
 * Sending the same `idempotencyKey` twice with the same text is safe and returns the row that was
 * already queued, which is what lets a browser retry a submission it never saw the answer to.
 * Sending the same key with different text is refused rather than queued, so a retry can never turn
 * into a second, different instruction.
 *
 * Failures map to status codes as follows, and each one is deliberately vague about the run so this
 * endpoint cannot be used to discover other people's runs:
 *
 * - 401 `steering_authentication_required` — no browser session. Checked before the body, so an
 *   unauthenticated caller is never told whether their body was also malformed.
 * - 400 `invalid_steering_request` — the run id is blank, or the body is not exactly the two
 *   accepted fields within their length limits.
 * - 404 `run_not_found` — the run does not exist, or it exists and the caller does not own it. The
 *   two are not distinguished.
 * - 409 `steering_idempotency_conflict` — this key was already used for different text.
 * - 409 `run_not_steerable` — the caller owns the run, but it is not in a state that accepts
 *   steering, or its resume command has already been sent.
 * - 503 `steering_unavailable` — the write threw. The instruction text is kept out of the log.
 *
 * Called by: `_CreateSteeringIngestRouter` (prisma-steering-ingest.router.ts), which
 * apps/opencrane/src/app/routes.ts mounts at /api/v1/me/runs.
 *
 * @param dependencies - Caller resolution, the steering queue, a clock, and a logger.
 * @returns An Express router exposing POST /:runId/steering.
 * @see SteeringRequestRepository for which status code each outcome produces.
 * @see _RuntimeSteeringOpenapiPaths in openapi.ts for the published request and response shapes.
 */
export function __CreateSteeringIngestRouter(dependencies: SteeringIngestRouterDependencies): Router
{
	const router = Router();

	router.post("/:runId/steering", async function _submit(request: Request, response: Response)
	{
		// 1. Establish the signed-in caller first. `_requireCaller` has already written the 401 by the
		// time it returns null, and the return below stops a second body-shaped answer being written
		// after it — that is what keeps the 401 free of any hint about the run or the body.
		const caller = _requireCaller(request, response, dependencies);
		const runId = request.params["runId"];
		const body = _body(request.body);
		if (caller === null) return;
		// 2. Reject anything the queue should never see. Doing it here means the repository can assume
		// a trimmed instruction within the length limit and a usable retry key.
		if (typeof runId !== "string" || !runId.trim() || body === null) { _respond(response, 400, "invalid_steering_request"); return; }

		try
		{
			// 3. Build the two digests the queue stores instead of the caller's own values. The retry
			// prefix identifies the attempt at submitting; the full digest also covers the text, so the
			// repository can tell an exact retry apart from a reused key carrying different words.
			const content = { text: body.text };
			const idempotencyDigest = _hash(body.idempotencyKey);
			// 4. Hand over only server-derived coordinates. The silo, the subject, and the time come from
			// the session and the injected clock; the run attempt is chosen inside the transaction.
			const result = await dependencies.requests.submitAtomically({ runId, siloId: caller.siloId, principalId: caller.principalId, subjectId: caller.subjectId, content, idempotencyDigest, digest: `${idempotencyDigest}:${_hash(content)}`, submittedAt: dependencies.clock.now() });
			// 5. Translate the queue's outcome into a status. 202 means this call created the row, 200
			// means an earlier identical call did, and a client can treat both as accepted.
			if (result.outcome === "queued") { response.status(202).json({ steeringRequestId: result.steeringRequestId, attempt: result.attempt, state: "pending" }); return; }
			if (result.outcome === "idempotent") { response.status(200).json({ steeringRequestId: result.steeringRequestId, attempt: result.attempt, state: "pending" }); return; }
			if (result.outcome === "idempotency_conflict") { _respond(response, 409, "steering_idempotency_conflict"); return; }
			if (result.outcome === "run_not_steerable") { _respond(response, 409, "run_not_steerable"); return; }
			// `not_found_or_not_owner` lands here, and an unowned run reads the same as a missing one.
			_respond(response, 404, "run_not_found");
		}
		catch (err)
		{
			// The instruction is the owner's own words, so the log records the run's silo and nothing
			// from the body.
			dependencies.logger.error({ err, operation: "runtime_steering.submit", siloId: caller.siloId }, "Runtime steering submission failed");
			_respond(response, 503, "steering_unavailable");
		}
	});

	return router;
}

/**
 * Return the caller from the session, or write a 401 that reveals nothing about the run.
 *
 * It writes the response itself rather than leaving that to the handler, so every unauthenticated
 * path answers with the same body no matter what else was wrong with the request.
 */
function _requireCaller(request: Request, response: Response, dependencies: SteeringIngestRouterDependencies): SteeringIngestCaller | null
{
	const caller = dependencies.resolveCaller(request);
	if (caller === null) _respond(response, 401, "steering_authentication_required");
	return caller;
}

/**
 * Accept only a body of `{ text, idempotencyKey }`, both non-blank and within their length limits.
 *
 * The key count has to be exactly two, so a caller cannot smuggle in a field this route does not
 * read — an extra `attempt` on the body must fail rather than be quietly ignored, which is what
 * `_rejectsCoordinates` in `__tests__/steering-ingest.router.test.ts` asserts. The published schema
 * says the same thing with `additionalProperties: false`.
 *
 * @param body - Whatever the JSON parser produced, including a non-object.
 * @returns The two trimmed fields, or null to answer 400. Trimming happens here so the queue stores
 * the same text the length limit was applied to.
 */
function _body(body: unknown): SteeringIngestRequestBody | null
{
	if (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 2) return null;
	const text = (body as Record<string, unknown>)["text"];
	const idempotencyKey = (body as Record<string, unknown>)["idempotencyKey"];
	if (typeof text !== "string" || typeof idempotencyKey !== "string") return null;
	const trimmed = text.trim();
	const key = idempotencyKey.trim();
	// The 128 here is the same limit the published schema states as `maxLength: 128` on
	// `idempotencyKey`; change both together.
	return trimmed && trimmed.length <= _MAX_STEERING_CHARACTERS && key && key.length <= 128 ? { text: trimmed, idempotencyKey: key } : null;
}

/**
 * Hash a retry key or an accepted instruction into the `sha256:<hex>` form the queue stores.
 *
 * The browser's own retry key is never kept — only its hash — so nothing a client chose ends up
 * readable in the database. Hashing is also what makes the stored digest a fixed-width two-part
 * string, which is how the repository can find an earlier attempt at the same key with a prefix
 * match instead of a second column.
 *
 * @param content - The retry key as a plain string, or the accepted `{ text }` instruction. The
 * instruction is serialised with `JSON.stringify` first, so the digest covers the field name too and
 * a text digest can never collide with a key digest.
 * @returns The digest, prefixed with the algorithm so a future change of algorithm stays readable.
 */
function _hash(content: string | { readonly text: string }): string
{
	const value = typeof content === "string" ? content : JSON.stringify(content);
	return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

/**
 * Write a JSON failure body carrying nothing but a stable `error` code.
 *
 * Every refusal from this route goes through here, so no failure can accidentally include the run's
 * state, the owner, or the caller's own text.
 */
function _respond(response: Response, status: number, error: string): void
{
	response.status(status).json({ error });
}
