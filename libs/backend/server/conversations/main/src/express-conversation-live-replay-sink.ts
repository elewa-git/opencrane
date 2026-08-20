import type { Response } from "express";
import type { ConversationProjectionSink } from "@opencrane/backend/conversations/projection";

/**
 * Wrap an Express response as a replay sink.
 *
 * `open` is what commits the response to being a stream: it sends 200 with the SSE content
 * type, `cache-control: no-store` so nothing is stored, and `x-accel-buffering: no` so an
 * nginx-style proxy forwards each frame instead of holding them until the response ends —
 * without that last header a live stream arrives in one lump at the end.
 *
 * Called by: `__CreateConversationReplayRouter` (conversation-replay.router.ts).
 *
 * @param response - The response to stream into. Not touched until `open` is called.
 * @returns The sink the streaming loop writes through.
 * @see https://html.spec.whatwg.org/multipage/server-sent-events.html — defines the
 * `text/event-stream` framing these headers set up.
 */
export function _CreateExpressConversationLiveReplaySink(response: Response): ConversationProjectionSink
{
	return {
		open: function _Open(): void
		{
			response.status(200).set({ "cache-control": "no-store", connection: "keep-alive", "content-type": "text/event-stream", "x-accel-buffering": "no" });
			response.flushHeaders();
		},
		write: function _Write(value): boolean { return response.write(value); },
		drain: function _Drain(signal): Promise<void> { return _AwaitDrain(response, signal); },
	};
}

/** Resolve when the socket can take more bytes, or immediately if the request is aborted, destroyed, or already ended. Never rejects, and removes all four listeners on the way out. */
function _AwaitDrain(response: Response, signal: AbortSignal): Promise<void>
{
	if (signal.aborted || response.destroyed || response.writableEnded) return Promise.resolve();
	return new Promise<void>(function _UntilWritable(resolve)
	{
		function _Finish(): void
		{
			response.removeListener("drain", _Finish);
			response.removeListener("close", _Finish);
			response.removeListener("error", _Finish);
			signal.removeEventListener("abort", _Finish);
			resolve();
		}
		response.once("drain", _Finish);
		response.once("close", _Finish);
		response.once("error", _Finish);
		signal.addEventListener("abort", _Finish, { once: true });
	});
}
