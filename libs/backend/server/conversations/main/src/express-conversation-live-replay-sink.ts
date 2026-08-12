import type { Response } from "express";

import type { ConversationLiveReplaySink } from "./conversation-live-replay.types.js";

/** Adapt one Express response into the awaitable bounded replay sink contract. */
export function _CreateExpressConversationLiveReplaySink(response: Response): ConversationLiveReplaySink
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

/** Wait until Node's writable buffer accepts more bytes or the request is no longer writable. */
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
