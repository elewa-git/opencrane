import { _IsMcpRecord } from "./mcp-json.validator";
import { McpProtocolError } from "./mcp-protocol.types";

/**
 * Incrementally decodes one bounded JSON or request-scoped SSE response.
 * @see https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http — response framing and notifications.
 */
export class McpResponseDecoder
{
	/** Decodes UTF-8 and rejects malformed byte sequences. */
	private readonly decoder = new TextDecoder("utf-8", { fatal: true });
	/** Selects JSON or request-scoped SSE framing. */
	private readonly mediaType: "json" | "sse";
	/** Matches the response to the originating request. */
	private readonly expectedId: string;
	/** Caps all bytes accepted across pushes. */
	private readonly maximumBytes: number;
	/** Counts bytes without retaining duplicate chunks. */
	private byteCount = 0;
	/** Holds decoded JSON or an incomplete SSE line. */
	private text = "";
	/** Joins the data fields in the current SSE event. */
	private eventData: string[] = [];
	/** Stores the matched response until the caller finishes or cancels the stream. */
	private terminal: unknown;
	/** Prevents a matched response from being emitted by `push` more than once. */
	private emitted = false;
	/** Prevents writes after the stream has finished. */
	private finished = false;

	/** Creates a decoder for one HTTP response. */
	constructor(contentType: string | undefined, expectedId: string, maximumBytes: number)
	{
		const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
		if (mediaType !== "application/json" && mediaType !== "text/event-stream")
			throw new McpProtocolError("MCP response content type was unsupported");
		if (expectedId.length === 0 || expectedId.length > 256 || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1)
			throw new McpProtocolError("MCP response decoder options were invalid");
		this.mediaType = mediaType === "application/json" ? "json" : "sse";
		this.expectedId = expectedId;
		this.maximumBytes = maximumBytes;
	}

	/** Adds bytes and returns the matching SSE response as soon as it is complete. */
	push(chunk: Uint8Array): unknown | undefined
	{
		if (this.finished || this.terminal !== undefined)
			throw new McpProtocolError("MCP response continued after completion");
		this.byteCount += chunk.byteLength;
		if (this.byteCount > this.maximumBytes)
			throw new McpProtocolError("MCP response exceeded its byte limit");
		try { this.text += this.decoder.decode(chunk, { stream: true }); }
		catch { throw new McpProtocolError("MCP response was not valid UTF-8"); }
		if (this.mediaType === "sse")
			this._ReadSseLines(false);
		if (this.terminal !== undefined && !this.emitted)
		{
			this.emitted = true;
			return this.terminal;
		}
		return undefined;
	}

	/** Finishes decoding and requires one matching response. */
	finish(): unknown
	{
		if (this.finished)
			throw new McpProtocolError("MCP response decoder already finished");
		this.finished = true;
		try { this.text += this.decoder.decode(); }
		catch { throw new McpProtocolError("MCP response was not valid UTF-8"); }
		if (this.mediaType === "json")
			this.terminal = this._Response(this._ParseJson(this.text));
		else
			this._ReadSseLines(true);
		if (this.terminal === undefined)
			throw new McpProtocolError("MCP SSE response ended without a matching result");
		return this.terminal;
	}

	/** Reads every complete SSE line and optionally dispatches the final event at EOF. */
	private _ReadSseLines(atEnd: boolean): void
	{
		while (true)
		{
			const boundary = _LineBoundary(this.text, atEnd);
			if (boundary === null)
				break;
			const line = this.text.slice(0, boundary.index);
			this.text = this.text.slice(boundary.index + boundary.width);
			this._ReadSseLine(line);
		}
		if (atEnd && this.eventData.length > 0)
			throw new McpProtocolError("MCP SSE response ended with an incomplete event");
	}

	/** Applies the SSE data and comment rules for one line. */
	private _ReadSseLine(line: string): void
	{
		if (line.length === 0)
		{
			if (this.eventData.length > 0)
				this._DispatchSseEvent();
			return;
		}
		if (line.startsWith(":"))
			return;
		const separator = line.indexOf(":");
		const field = separator === -1 ? line : line.slice(0, separator);
		let value = separator === -1 ? "" : line.slice(separator + 1);
		if (value.startsWith(" "))
			value = value.slice(1);
		if (field === "data")
			this.eventData.push(value);
	}

	/** Parses one SSE event and accepts progress or logging before the final response. */
	private _DispatchSseEvent(): void
	{
		const data = this.eventData.join("\n");
		this.eventData = [];
		const payload = this._ParseJson(data);
		if (!_IsMcpRecord(payload))
			throw new McpProtocolError("MCP SSE event was not a JSON-RPC object");
		if (!Object.hasOwn(payload, "id"))
		{
			if (payload["jsonrpc"] !== "2.0" || payload["method"] !== "notifications/progress" && payload["method"] !== "notifications/message" || Object.hasOwn(payload, "result") || Object.hasOwn(payload, "error"))
				throw new McpProtocolError("MCP SSE notification was not permitted");
			return;
		}
		if (this.terminal !== undefined)
			throw new McpProtocolError("MCP SSE response contained multiple results");
		this.terminal = this._Response(payload);
	}

	/** Checks the JSON-RPC fields shared by JSON and SSE terminal responses. */
	private _Response(payload: unknown): Record<string, unknown>
	{
		if (!_IsMcpRecord(payload) || payload["id"] !== this.expectedId || payload["jsonrpc"] !== "2.0" || Object.hasOwn(payload, "method") || Object.hasOwn(payload, "result") === Object.hasOwn(payload, "error"))
			throw new McpProtocolError("MCP response did not match the request");
		return payload;
	}

	/** Parses JSON without exposing a native parser error or peer-controlled text. */
	private _ParseJson(text: string): unknown
	{
		try { return JSON.parse(text) as unknown; }
		catch { throw new McpProtocolError("MCP response contained malformed JSON"); }
	}
}

/** Locates one LF, CRLF, or CR line ending without consuming a split CRLF pair. */
function _LineBoundary(text: string, atEnd: boolean): { readonly index: number; readonly width: number } | null
{
	for (let index = 0; index < text.length; index += 1)
	{
		if (text[index] === "\n")
			return { index, width: 1 };
		if (text[index] !== "\r")
			continue;
		if (index + 1 < text.length)
			return { index, width: text[index + 1] === "\n" ? 2 : 1 };
		return atEnd ? { index, width: 1 } : null;
	}
	return atEnd && text.length > 0 ? { index: text.length, width: 0 } : null;
}
