import { ConversationTransportError } from "./conversation-event-transport.errors";
import { ConversationServerEvents, ConversationTransportFailureKinds, type ConversationServerFrame } from "./conversation-event-transport.types";

/** Matches the server's maximum encoded event size, including SSE field names and delimiters. */
const _MAXIMUM_FRAME_BYTES = 512 * 1_024;

/**
 * Decodes UTF-8 frames across arbitrary network chunks without buffering more than one event.
 * Abort cancels the reader even while a quiet connection has no bytes; incomplete EOF is rejected.
 * @throws ConversationTransportError when framing, encoding, or frame size is invalid.
 */
export async function* _ReadConversationEventFrames(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<ConversationServerFrame>
{
	const reader = body.getReader();
	const bytes = new Uint8Array(_MAXIMUM_FRAME_BYTES);
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let length = 0;
	let lineLength = 0;
	function _Abort(): void
	{
		void reader.cancel().catch(function _AlreadyClosed() { /* Cancellation can race the server closing its response. */ });
	}
	signal.addEventListener("abort", _Abort, { once: true });
	try
	{
		while (!signal.aborted)
		{
			const chunk = await reader.read();
			if (signal.aborted)
				return;
			if (chunk.done)
			{
				if (length > 0)
					throw new ConversationTransportError(ConversationTransportFailureKinds.InvalidResponse);
				return;
			}
			for (const byte of chunk.value)
			{
				if (length === bytes.length)
					throw new ConversationTransportError(ConversationTransportFailureKinds.InvalidResponse);
				bytes[length++] = byte;
				if (byte === 10)
				{
					if (lineLength === 0)
					{
						let text: string;
						try { text = decoder.decode(bytes.subarray(0, length)); }
						catch { throw new ConversationTransportError(ConversationTransportFailureKinds.InvalidResponse); }
						length = 0;
						yield _Frame(text);
						if (signal.aborted)
							return;
					}
					lineLength = 0;
				}
				else if (byte !== 13)
					lineLength += 1;
			}
		}
	}
	finally
	{
		signal.removeEventListener("abort", _Abort);
		await reader.cancel().catch(function _AlreadyClosed() { /* The fetch abort may have already closed the reader. */ });
		reader.releaseLock();
	}
}

/** Interprets the endpoint's SSE fields before its data is validated as a history or error body. */
function _Frame(text: string): ConversationServerFrame
{
	let event: ConversationServerEvents | undefined;
	let id: string | undefined;
	const data: string[] = [];
	for (const line of text.split(/\r?\n/u))
	{
		if (line.length === 0 || line.startsWith(":"))
			continue;
		const separator = line.indexOf(":");
		const field = separator < 0 ? line : line.slice(0, separator);
		const value = separator < 0 ? "" : line.slice(separator + 1).replace(/^ /u, "");
		if (field === "event")
		{
			if (value !== ConversationServerEvents.History && value !== ConversationServerEvents.Unavailable)
				throw new ConversationTransportError(ConversationTransportFailureKinds.InvalidResponse);
			event = value;
		}
		else if (field === "id")
			id = value;
		else if (field === "data")
			data.push(value);
	}
	if ((event === undefined && (id !== undefined || data.length > 0)) || (event !== undefined && data.length === 0))
		throw new ConversationTransportError(ConversationTransportFailureKinds.InvalidResponse);
	return { event, id, data: data.join("\n") };
}
