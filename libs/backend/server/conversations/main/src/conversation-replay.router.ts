import { Router, type Request, type Response } from "express";

import { __DigestChannelInvocationContext } from "@opencrane/backend/server/agents/channel-targets";
import { __DecodeConversationProjectionCursor, __StreamConversationProjection, ConversationProjectionOutcomes } from "@opencrane/backend/conversations/projection";

import { _CreateExpressConversationLiveReplaySink } from "./express-conversation-live-replay-sink.js";
import type { ConversationReplayRouterDependencies } from "./conversation-replay.router.types.js";

/** Create the internal consumed-context-authorized snapshot-to-live route. */
export function __CreateConversationReplayRouter(dependencies: ConversationReplayRouterDependencies): Router
{
	const router = Router();
	router.get("/", async function _replay(request: Request, response: Response)
	{
		const token = _Bearer(request.header("authorization"));
		const suppliedCursor = _SuppliedCursor(request);
		if (suppliedCursor === null) { response.status(400).json({ error: "invalid_replay_request" }); return; }
		const cursor = __DecodeConversationProjectionCursor(suppliedCursor);
		if (token === null || (suppliedCursor !== undefined && cursor === null)) { response.status(400).json({ error: "invalid_replay_request" }); return; }
		const consumed = await dependencies.contexts.consumeInvocationContextAtomically({ digest: __DigestChannelInvocationContext(token), expectedReceiverId: dependencies.expectedReceiverId, nowEpochMs: dependencies.nowEpochMs() });
		if (consumed.status !== "consumed" || consumed.context.action !== "events.read") { response.status(403).json({ error: "replay_denied" }); return; }
		if (cursor !== null && cursor.conversationId !== consumed.context.conversationId) { response.status(403).json({ error: "replay_denied" }); return; }
		const abort = new AbortController();
		function _Abort(): void { abort.abort(); }
		response.once("close", _Abort);
		response.once("error", _Abort);
		dependencies.shutdownSignal?.addEventListener("abort", _Abort, { once: true });
		try
		{
			const outcome = await __StreamConversationProjection({ reader: dependencies.repository, clock: dependencies.clock, limits: dependencies.limits }, _CreateExpressConversationLiveReplaySink(response), { conversationId: consumed.context.conversationId, siloId: consumed.context.siloId, subjectId: consumed.context.subjectId, cursor, signal: abort.signal });
			if (outcome === ConversationProjectionOutcomes.RevokedOrMissing && !response.headersSent) response.status(403).json({ error: "replay_denied" });
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

function _SuppliedCursor(request: Request): string | undefined | null
{
	if (request.query.cursor !== undefined && typeof request.query.cursor !== "string") return null;
	const queryCursor = request.query.cursor;
	const headerCursor = request.header("last-event-id");
	if (queryCursor !== undefined && headerCursor !== undefined && queryCursor !== headerCursor) return null;
	return queryCursor ?? headerCursor;
}

function _Bearer(value: string | undefined): string | null
{
	const match = /^Bearer ([^\s,]+)$/u.exec(value ?? "");
	return match?.[1] ?? null;
}
