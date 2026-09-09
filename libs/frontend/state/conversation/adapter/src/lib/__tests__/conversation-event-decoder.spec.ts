import { describe, expect, it, vi } from "vitest";

import { _ReadConversationEventFrames } from "../conversation-event-decoder";
import { ConversationServerEvents } from "../conversation-event-transport.types";

/** Splits encoded bytes independently of lines and UTF-8 character boundaries. */
function _Body(text: string, fragmentSize = 1): ReadableStream<Uint8Array>
{
	const bytes = new TextEncoder().encode(text);
	return new ReadableStream({ start(controller)
	{
		for (let index = 0; index < bytes.length; index += fragmentSize)
			controller.enqueue(bytes.slice(index, index + fragmentSize));
		controller.close();
	} });
}

/** Collects the small test response through the production reader. */
async function _Frames(body: ReadableStream<Uint8Array>, signal = new AbortController().signal)
{
	const frames = [];
	for await (const frame of _ReadConversationEventFrames(body, signal))
		frames.push(frame);
	return frames;
}

describe("conversation SSE decoder", function _DescribeFrames()
{
	it("preserves fragmented UTF-8 and CRLF while joining data lines", async function _FragmentedUtf8()
	{
		const text = ': keep-alive\r\n\r\nevent: history\r\nid: 2\r\ndata: {"text":\r\ndata: "Héllo 🌍"}\r\n\r\n';
		await expect(_Frames(_Body(text))).resolves.toEqual([
			{ event: undefined, id: undefined, data: "" },
			{ event: ConversationServerEvents.History, id: "2", data: '{"text":\n"Héllo 🌍"}' }
		]);
	});

	it("rejects an oversized frame before buffering beyond the server cap", async function _FrameLimit()
	{
		await expect(_Frames(_Body(`event: history\ndata: ${"x".repeat(512 * 1_024)}\n\n`, 16_384))).rejects.toThrow("Conversation history is unavailable.");
	});

	it.each(["event: history\ndata: unfinished", "event: unknown\ndata: {}\n\n", "data: {}\n\n", "event: history\n\n"])("rejects incomplete or unsupported framing", async function _InvalidFrame(text)
	{
		await expect(_Frames(_Body(text))).rejects.toThrow("Conversation history is unavailable.");
	});

	it("rejects invalid UTF-8 instead of replacing bytes inside message text", async function _InvalidEncoding()
	{
		const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([0xff, 10, 10])); controller.close(); } });
		await expect(_Frames(body)).rejects.toThrow("Conversation history is unavailable.");
	});

	it("cancels a pending quiet read immediately when selection changes", async function _AbortRead()
	{
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({ cancel });
		const controller = new AbortController();
		const pending = _Frames(body, controller.signal);
		controller.abort();
		await expect(pending).resolves.toEqual([]);
		expect(cancel).toHaveBeenCalledOnce();
	});
});
