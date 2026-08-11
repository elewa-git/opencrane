import { Router, type Request, type Response } from "express";
import { __EncodeAgUiSseRecord, __ProjectAgUiEvent } from "@opencrane/contracts";

import { __DecodeConversationReplayCursor } from "./replay-cursor.js";
import { __ReadConversationReplay } from "./conversation-replay.js";
import type { SelfConversationReplayRouterDependencies } from "./self-conversation-replay.router.types.js";

/** Create the browser-session-authenticated replay surface for one authorised conversation. */
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
		try
		{
			const events = await __ReadConversationReplay(dependencies.repository, { conversationId, siloId: caller.siloId, subjectId: caller.subjectId, cursor, limit: 200 });
			response.status(200).set({ "cache-control": "no-store", connection: "keep-alive", "content-type": "text/event-stream" });
			for (const event of events) response.write(__EncodeAgUiSseRecord(__ProjectAgUiEvent(event)));
			response.end();
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "conversation_replay.self", siloId: caller.siloId }, "Self conversation replay failed");
			response.status(503).json({ error: "conversation_replay_unavailable" });
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
	return __DecodeConversationReplayCursor(rawCursor) ?? undefined;
}
