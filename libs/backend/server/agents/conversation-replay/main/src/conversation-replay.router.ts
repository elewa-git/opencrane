import { Router, type Request, type Response } from "express";
import { __EncodeAgUiSseRecord, __ProjectAgUiEvent } from "@opencrane/contracts";

import { __DecodeConversationReplayCursor } from "./replay-cursor.js";
import { __ReadConversationReplay } from "./conversation-replay.js";
import type { ConversationReplayRouterDependencies } from "./conversation-replay.router.types.js";

/** Create the internal snapshot replay route. */
export function __CreateConversationReplayRouter(dependencies: ConversationReplayRouterDependencies): Router
{
	const router = Router();
	router.get("/", async function _replay(request: Request, response: Response)
	{
		const token = _Bearer(request.header("authorization"));
		const suppliedCursor = _SuppliedCursor(request);
		if (suppliedCursor === null) { response.status(400).json({ error: "invalid_replay_request" }); return; }
		const cursor = __DecodeConversationReplayCursor(suppliedCursor);
		if (token === null || (suppliedCursor !== undefined && cursor === null)) { response.status(400).json({ error: "invalid_replay_request" }); return; }
		const consumed = await dependencies.contexts.consumeInvocationContextAtomically({ digest: token, expectedRouteId: dependencies.expectedRouteId, nowEpochMs: dependencies.nowEpochMs() });
		if (consumed.status !== "consumed" || consumed.context.action !== "events.read" || consumed.context.runId !== null) { response.status(403).json({ error: "replay_denied" }); return; }
		const events = await __ReadConversationReplay(dependencies.repository, { threadId: consumed.context.threadId, siloId: consumed.context.siloId, subjectId: consumed.context.subjectId, cursor, limit: 200 });
		response.status(200).set({ "cache-control": "no-store", connection: "keep-alive", "content-type": "text/event-stream" });
		for (const event of events)
		{
			response.write(__EncodeAgUiSseRecord(__ProjectAgUiEvent(event)));
		}
		response.end();
	});
	return router;
}

/** Resolve the one permitted upstream resume cursor without accepting conflicting coordinates. */
function _SuppliedCursor(request: Request): string | undefined | null
{
	if (request.query.cursor !== undefined && typeof request.query.cursor !== "string") return null;
	const queryCursor = request.query.cursor;
	const headerCursor = request.header("last-event-id");
	if (queryCursor !== undefined && headerCursor !== undefined && queryCursor !== headerCursor) return null;
	return queryCursor ?? headerCursor;
}

/** Parse one unambiguous bearer context. */
function _Bearer(value: string | undefined): string | null
{
	const match = /^Bearer ([^\s,]+)$/u.exec(value ?? "");
	return match?.[1] ?? null;
}
