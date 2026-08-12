import { Router, type Request, type Response } from "express";
import { __DecodeConversationProjectionCursor, __StreamConversationProjection, ConversationProjectionOutcomes } from "@opencrane/backend/conversations/projection";

import { _CreateExpressConversationLiveReplaySink } from "./express-conversation-live-replay-sink.js";
import type { SelfConversationReplayRouterDependencies } from "./self-conversation-replay.router.types.js";

/** Create the browser-session-authenticated snapshot-to-live surface. */
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

/** Decode only one unambiguous, canonical replay cursor. */
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
