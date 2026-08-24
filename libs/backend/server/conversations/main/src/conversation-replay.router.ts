import { Router, type Request, type Response } from "express";

import { __DigestChannelInvocationContext } from "@opencrane/backend/server/agents/channel-targets";
import { __DecodeConversationProjectionCursor, __StreamConversationProjection, ConversationProjectionOutcomes } from "@opencrane/backend/conversations/projection";

import { _CreateExpressConversationLiveReplaySink } from "./express-conversation-live-replay-sink";
import type { ConversationReplayRouterDependencies } from "./conversation-replay.router.types";

/**
 * Build the internal replay route used by callers that hold a single-use context token instead
 * of a browser session.
 *
 * Authorisation works differently from the browser route: the caller presents a bearer token,
 * the route digests it and spends it via `consumeInvocationContextAtomically`, and the
 * conversation, silo, and subject are then read out of the CONSUMED context rather than from
 * the request. Spending is atomic and one-shot, so replaying the same token cannot open a
 * second stream. The context must also name the `events.read` action, and a supplied cursor
 * must belong to the context's own conversation.
 *
 * Every refusal answers 403 with the same body — bad token, spent token, wrong action, wrong
 * conversation, and lost access are not distinguished, so a caller cannot use the status to
 * probe. Note this route takes no approval-overlay reader: overlays are for the browser
 * surface only.
 *
 * Called by: apps/opencrane/src/app/runtime-composition.ts, which mounts it only when an
 * expected receiver id is configured.
 *
 * @param dependencies - Channel context authority, replay repository, clock, limits, optional
 *   shutdown signal, the receiver id the token must be addressed to, and the server clock.
 * @returns An Express router carrying the single replay route.
 */
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

/**
 * Read the raw cursor from either the `cursor` query parameter or the `Last-Event-ID` header.
 *
 * @returns The raw token; `undefined` when the client sent none; or null meaning "reject this
 *   request", used when the parameter is not a string or when the two sources disagree.
 *   Accepting a disagreement could silently resume from the wrong point.
 */
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
