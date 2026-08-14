import { Router, type Request, type Response } from "express";
import { __DecodeConversationProjectionCursor, __StreamConversationProjection, ConversationProjectionOutcomes } from "@opencrane/backend/conversations/projection";

import { _CreateExpressConversationLiveReplaySink } from "./express-conversation-live-replay-sink";
import type { SelfConversationReplayRouterDependencies } from "./self-conversation-replay.router.types";

/**
 * Build the `GET /:conversationId/events` route a signed-in user's browser subscribes to for
 * live conversation updates.
 *
 * The route resolves the caller from the session, decodes the resume cursor, and refuses a
 * cursor for a different conversation with 400 before any streaming starts. It then hands off
 * to `__StreamConversationLiveReplay` and stays out of the way.
 *
 * Because a stream is long-lived, the route wires an abort signal to three things — the
 * response closing, a response error, and process shutdown — and removes those listeners in a
 * `finally`, so a busy server does not accumulate listeners on the shutdown signal.
 *
 * Error handling depends on whether the response was opened. Before that, a revoked read
 * answers 404 and an unexpected failure answers 503 with JSON; after that, headers are already
 * sent and all the route can do is end the response.
 *
 * Called by: `_CreateSelfConversationReplayRouter`
 * (prisma-self-conversation-replay.router.ts), mounted at `/api/v1/me/conversations` by
 * apps/opencrane/src/app/routes.ts.
 *
 * @param dependencies - Caller resolver, replay repository, clock, limits, optional approval
 *   overlay reader, optional shutdown signal, and logger.
 * @returns An Express router carrying the single events route.
 * @see https://html.spec.whatwg.org/multipage/server-sent-events.html — the response is an SSE
 * stream, which is why `Last-Event-ID` is accepted as an alternative to the `cursor` query
 * parameter.
 */
export function __CreateSelfConversationReplayRouter(dependencies: SelfConversationReplayRouterDependencies): Router
{
	const router = Router();
	router.get("/:conversationId/events", async function _events(request: Request, response: Response)
	{
		const caller = dependencies.resolveCaller(request);
		const conversationId = request.params["conversationId"];
		const cursor = _cursor(request);
		if (caller === null) { response.status(401).json({ error: "conversation_authentication_required" }); return; }
		if (typeof conversationId !== "string" || !conversationId.trim() || cursor === undefined || (cursor !== null && cursor.conversationId !== conversationId)) { response.status(400).json({ error: "invalid_conversation_replay_request" }); return; }
		const abort = new AbortController();
		function _Abort(): void { abort.abort(); }
		response.once("close", _Abort);
		response.once("error", _Abort);
		dependencies.shutdownSignal?.addEventListener("abort", _Abort, { once: true });
		try
		{
			const outcome = await __StreamConversationProjection({ reader: dependencies.repository, ...(dependencies.interrupts === undefined ? {} : { interrupts: dependencies.interrupts }), clock: dependencies.clock, limits: dependencies.limits }, _CreateExpressConversationLiveReplaySink(response), { conversationId, siloId: caller.siloId, subjectId: caller.subjectId, cursor, signal: abort.signal });
			if (outcome === ConversationProjectionOutcomes.RevokedOrMissing && !response.headersSent) response.status(404).json({ error: "conversation_not_found" });
			else if (!response.writableEnded) response.end();
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "conversation_replay.self", siloId: caller.siloId }, "Self conversation replay failed");
			if (!response.headersSent) response.status(503).json({ error: "conversation_replay_unavailable" });
			else if (!response.writableEnded) response.end();
		}
		finally
		{
			response.removeListener("close", _Abort);
			response.removeListener("error", _Abort);
			dependencies.shutdownSignal?.removeEventListener("abort", _Abort);
		}
	});
	return router;
}

/**
 * Work out where to resume from, accepting the cursor either as a `cursor` query parameter or
 * as the `Last-Event-ID` header. When both are present they must be byte-identical — two
 * different resume points is a client bug, and guessing which one is meant could silently skip
 * events.
 *
 * @returns The decoded cursor to resume from; null to start from the beginning; or `undefined`
 *   meaning "reject this request", which the caller turns into 400. The three-way answer is
 *   why the return type is not just `cursor | null` — do not collapse `undefined` and null.
 */
function _cursor(request: Request)
{
	if (request.query["cursor"] !== undefined && typeof request.query["cursor"] !== "string") return undefined;
	const queryCursor = request.query["cursor"];
	const headerCursor = request.header("last-event-id");
	if (queryCursor !== undefined && headerCursor !== undefined && queryCursor !== headerCursor) return undefined;
	const rawCursor = queryCursor ?? headerCursor;
	if (rawCursor === undefined) return null;
	return __DecodeConversationProjectionCursor(rawCursor) ?? undefined;
}
