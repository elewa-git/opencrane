import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

import type { Request, RequestHandler, Response } from "express";
import { ___DoWithTrace, ___MarkActiveSpanFailed } from "@opencrane/backend/observability";
import type { HistoryRecordedEvent, HistorySubscription } from "@opencrane/backend/server/infra/history-store";

import { _ConversationEventLimits, _CreateConversationEventAdmission } from "./self-conversation-events-limits";
import type { SelfConversationEventsDependencies, SelfConversationEventLimits } from "./self-conversation-events.types";
import type { SelfConversationHistoryResult } from "./self-conversation-history.types";
import type { ConversationCaller } from "./types/conversation-caller.types";

/** Creates the authenticated SSE handler without exposing Kurrent envelopes or accepting stream names. */
export function _CreateSelfConversationEventsHandler(dependencies: SelfConversationEventsDependencies): RequestHandler
{
	const limits = _ConversationEventLimits(dependencies.limits);
	const admit = _CreateConversationEventAdmission(limits);
	return function _Handle(request, response)
	{
		const caller = dependencies.resolveCaller(request);
		if (caller === null)
			return void response.status(401).json({ error: "unauthorized" });
		if (!_SameOrigin(request))
			return void response.status(403).json({ error: "same_origin_required" });
		const cursor = _Cursor(request);
		const conversationId = request.params["conversationId"];
		if (cursor === null || typeof conversationId !== "string" || !conversationId.trim())
			return void response.status(400).json({ error: "invalid_cursor" });
		const release = admit(JSON.stringify([caller.siloId, caller.subjectId]));
		if (release === null)
			return void response.status(429).set("Retry-After", "60").json({ error: "conversation_event_limit" });
		void ___DoWithTrace("conversation.events.stream", { siloId: caller.siloId, conversationId }, function _RunStream() { return _Stream(response, caller, conversationId, cursor, dependencies, limits); }).finally(release);
	};
}

/** Reauthorizes bounded history pages and uses one closeable subscription solely to wake the next read. */
async function _Stream(response: Response, caller: ConversationCaller, conversationId: string, cursor: bigint, dependencies: SelfConversationEventsDependencies, limits: SelfConversationEventLimits): Promise<void>
{
	const stop = new AbortController();
	let subscription: HistorySubscription | undefined;
	let close: Promise<void> | undefined;
	function _CloseSubscription(): Promise<void>
	{
		if (subscription !== undefined)
			close ??= subscription.close().catch(function _IgnoreClosedUpstream() {});
		return close ?? Promise.resolve();
	}
	function _Stop(): void
	{
		stop.abort();
		void _CloseSubscription();
		if (!response.writableEnded)
			response.end();
	}
	response.once("close", _Stop);
	dependencies.shutdownSignal.addEventListener("abort", _Stop, { once: true });
	const duration = setTimeout(_Stop, limits.durationMs);
	let idle = setTimeout(_Stop, limits.idleMs);
	let written = 0;
	let frames = 0;
	let operation = "history.read";
	function _Unavailable(error: string): void
	{
		const frame = `event: unavailable\ndata: ${JSON.stringify({ error })}\n\n`;
		if (!stop.signal.aborted && response.headersSent && !response.writableNeedDrain && Buffer.byteLength(frame, "utf8") <= limits.eventBytes && written + Buffer.byteLength(frame, "utf8") <= limits.responseBytes)
			response.write(frame);
	}
	try
	{
		if (dependencies.shutdownSignal.aborted)
			_Stop();
		const options = { maxCount: 1, maximumBytes: limits.eventBytes - 128, signal: stop.signal };
		let page = await dependencies.authority.read(caller, conversationId, cursor, options);
		stop.signal.throwIfAborted();
		if (page === null)
			return void response.status(404).json({ error: "conversation_unavailable" });
		const streamName = `conversation-${conversationId}`;
		operation = "subscription.open";
		subscription = await dependencies.historyStore.subscribe({ streamName, fromRevision: BigInt(page.nextPosition) + 1n });
		stop.signal.throwIfAborted();
		response.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" });
		response.flushHeaders();
		const iterator = subscription.events[Symbol.asyncIterator]();
		let next = iterator.next();
		// A subscription can fail while a bounded page is still being read; retain that rejection for the await below.
		void next.catch(function _ObservePendingRead() {});
		while (!stop.signal.aborted)
		{
			const position = BigInt(page.nextPosition);
			if (position > cursor)
			{
				operation = "frame.write";
				const frame = _Frame(page);
				const bytes = Buffer.byteLength(frame, "utf8");
				if (bytes > limits.eventBytes)
					throw new Error("Conversation history frame exceeds its byte budget");
				if (written + bytes > limits.responseBytes || frames >= limits.eventCount)
					break;
				written += bytes;
				frames += 1;
				await _Write(response, frame, stop.signal, limits.drainMs);
				cursor = position;
				if (frames >= limits.eventCount)
					break;
				clearTimeout(idle);
				idle = setTimeout(_Stop, limits.idleMs);
			}
			else
			{
				operation = "subscription.wait";
				const wake = await _Wake(next, stop.signal, limits.heartbeatMs);
				if (wake !== null)
				{
					if (wake.done)
						break;
					if (wake.value.streamName !== streamName || wake.value.metadata.siloId !== caller.siloId || wake.value.metadata.conversationId !== conversationId)
						throw new Error("Conversation wakeup has foreign coordinates");
					next = iterator.next();
					void next.catch(function _ObservePendingRead() {});
					if (wake.value.revision <= cursor)
						continue;
				}
				else
				{
					const heartbeat = ": keep-alive\n\n";
					if (written + heartbeat.length > limits.responseBytes)
						break;
					written += heartbeat.length;
					operation = "frame.write";
					await _Write(response, heartbeat, stop.signal, limits.drainMs);
				}
			}
			operation = "history.read";
			page = await dependencies.authority.read(caller, conversationId, cursor, options);
			stop.signal.throwIfAborted();
			if (page === null)
			{
				_Unavailable("conversation_unavailable");
				break;
			}
		}
	}
	catch (error)
	{
		if (!stop.signal.aborted && !(error instanceof Error && error.name === "AbortError"))
		{
			___MarkActiveSpanFailed();
			// Provider exceptions can carry private content; the operation and fixed error identify this failure safely.
			dependencies.logger.warn({ err: new Error("Conversation event stream failed"), failedOperation: operation, siloId: caller.siloId, conversationId }, "Conversation event stream ended after a failure");
		}
		if (!stop.signal.aborted && !response.headersSent)
			response.status(503).json({ error: "conversation_history_unavailable" });
		else
			_Unavailable("conversation_history_unavailable");
	}
	finally
	{
		clearTimeout(duration);
		clearTimeout(idle);
		stop.abort();
		response.removeListener("close", _Stop);
		dependencies.shutdownSignal.removeEventListener("abort", _Stop);
		await _CloseSubscription();
		if (!response.writableEnded)
			response.end();
	}
}

/** Produces a reconnectable participant frame containing only the existing authorized response shape. */
function _Frame(page: SelfConversationHistoryResult): string
{
	return `id: ${page.nextPosition}\nevent: history\ndata: ${JSON.stringify(page)}\n\n`;
}

/** Waits for socket capacity before another authorization or history read can produce output. */
async function _Write(response: Response, frame: string, signal: AbortSignal, drainMs: number): Promise<void>
{
	signal.throwIfAborted();
	if (response.write(frame))
		return;
	await once(response, "drain", { signal: AbortSignal.any([signal, AbortSignal.timeout(drainMs)]) });
}

/** Races one pending subscription delivery against a bounded authority-refresh heartbeat. */
async function _Wake(next: Promise<IteratorResult<HistoryRecordedEvent>>, signal: AbortSignal, heartbeatMs: number): Promise<IteratorResult<HistoryRecordedEvent> | null>
{
	const timer = new AbortController();
	try
	{
		return await Promise.race([next, delay(heartbeatMs, null, { signal: AbortSignal.any([signal, timer.signal]) })]);
	}
	finally
	{
		timer.abort();
	}
}

/** Requires same-origin browser evidence; the general session CSRF guard deliberately skips GET requests. */
function _SameOrigin(request: Request): boolean
{
	const site = request.get("sec-fetch-site");
	if (site !== undefined && site !== "same-origin")
		return false;
	const expected = `${request.protocol}://${request.get("host")}`;
	const origin = request.get("origin");
	if (origin !== undefined)
		return origin === expected;
	const referer = request.get("referer");
	if (referer !== undefined)
	{
		try { return new URL(referer).origin === expected; }
		catch { return false; }
	}
	return site === "same-origin";
}

/** Accepts one bounded unsigned stream revision and rejects ambiguous replay coordinates. */
function _Cursor(request: Request): bigint | null
{
	const header = request.get("last-event-id");
	const query = request.query["afterPosition"];
	// EventSource retains the original URL across reconnects, so its newer header overrides that cursor.
	const value = header ?? query ?? "0";
	if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(value))
		return null;
	const position = BigInt(value);
	return position < 18_446_744_073_709_551_615n ? position : null;
}
