import type { IncomingMessage, Server } from "node:http";

import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";

import { ___ParticipantInputBlocksSchema } from "@opencrane/models/conversations";
import { __DecodeConversationProjectionCursor, __StreamConversationProjection, ConversationProjectionOutcomes, type ConversationProjectionSink } from "@opencrane/backend/conversations/projection";

import { ConversationAuthorityOutcomes, ConversationWriteDenialReasons } from "./types/conversation-authority-result.types";
import type { SelfConversationSocketDependencies, SelfConversationSocketServer } from "./self-conversation-socket.types";
import type { ConversationCaller } from "./types/conversation-caller.types";

/** Limits one connection's buffered frames before projection waits for the peer to catch up. */
const _MAXIMUM_BUFFERED_BYTES = 1_048_576;

/** Accepts the single browser-to-server command that belongs on the conversation socket. */
const _CommandSchema = z.object({
	type: z.literal("conversation.message.submit"),
	requestId: z.string().uuid(),
	idempotencyKey: z.string().trim().min(1).max(128),
	blocks: ___ParticipantInputBlocksSchema,
	agentTarget: z.object({ agentServiceId: z.string().trim().min(1).max(128) }).strict().optional(),
}).strict();

/**
 * Builds the public-listener WebSocket endpoint for one participant's conversation projection and
 * message commands.
 *
 * The endpoint accepts no arbitrary upgrade: it first selects the one conversation-socket path,
 * then the supplied authenticator establishes the participant from trusted request facts. The same
 * authenticated connection replays safe projections and submits idempotent participant messages,
 * so browser workspace traffic does not fall back to the removed public SSE route. `attach` may be
 * called once; `close` ends active sockets while the process drains.
 *
 * Called by: `_CreatePrismaSelfConversationSocketServer`, composed by `apps/opencrane/src/index.ts`.
 *
 * @param dependencies - The authentication, conversation authority, projection reader, lifecycle,
 *   and logging seams that remain owned by the server process.
 * @returns An unattached endpoint for the app lifecycle to connect to its public HTTP server.
 */
export function __CreateSelfConversationSocketServer(dependencies: SelfConversationSocketDependencies): SelfConversationSocketServer
{
	const socketServer = new WebSocketServer({ noServer: true, maxPayload: 1_048_576, perMessageDeflate: false });
	let attached = false;
	return {
		attach(server: Server): void
		{
			if (attached) throw new Error("conversation socket server is already attached");
			attached = true;
			server.on("upgrade", function _Upgrade(request, socket, head)
			{
				const selection = _Selection(request);
				if (selection === null)
				{
					socket.destroy();
					return;
				}
				// Node's upgrade listener cannot await this work; _UpgradeConversation owns failure cleanup.
				void _UpgradeConversation(socketServer, dependencies, request, socket, head, selection.conversationId, selection.cursor);
			});
		},
		close(): void
		{
			socketServer.clients.forEach(function _Close(client)
			{
				client.close(1001, "server_shutdown");
			});
		}
	};
}

/** Parse the sole public socket address and reject every malformed or unrelated upgrade. */
function _Selection(request: IncomingMessage): { readonly conversationId: string; readonly cursor: string | null } | null
{
	const host = request.headers.host;
	if (host === undefined) return null;
	let url: URL;
	try { url = new URL(request.url ?? "", `https://${host}`); }
	catch { return null; }
	const match = /^\/api\/v1\/me\/conversations\/([^/]+)\/socket$/u.exec(url.pathname);
	if (match === null) return null;
	let conversationId: string;
	try { conversationId = decodeURIComponent(match[1] ?? "").trim(); }
	catch { return null; }
	const cursor = url.searchParams.get("cursor");
	return conversationId.length === 0 || (cursor !== null && __DecodeConversationProjectionCursor(cursor) === null) ? null : { conversationId, cursor };
}

/** Authenticate the upgrade before allowing the WebSocket server to take ownership of its socket. */
async function _UpgradeConversation(socketServer: WebSocketServer, dependencies: SelfConversationSocketDependencies, request: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer, conversationId: string, rawCursor: string | null): Promise<void>
{
	let caller: ConversationCaller | null;
	try { caller = await dependencies.authenticator.authenticate(request); }
	catch (error) { dependencies.logger.error({ err: error, operation: "conversation.socket.authenticate" }, "Conversation socket authentication failed"); socket.destroy(); return; }
	if (caller === null) { socket.destroy(); return; }
	const cursor = rawCursor === null ? null : __DecodeConversationProjectionCursor(rawCursor);
	if (cursor === null && rawCursor !== null) { socket.destroy(); return; }
	if (cursor !== null && cursor.conversationId !== conversationId) { socket.destroy(); return; }
	try
	{
		socketServer.handleUpgrade(request, socket, head, function _Connected(connection)
		{
			socketServer.emit("connection", connection, request);
			void _ServeConversationSocket(connection, dependencies, caller, conversationId, cursor);
		});
	}
	catch (error)
	{
		dependencies.logger.error({ err: error, operation: "conversation.socket.upgrade" }, "Conversation socket upgrade failed");
		socket.destroy();
	}
}

/** Run the projection tail and receive idempotent participant messages on one authenticated socket. */
async function _ServeConversationSocket(socket: WebSocket, dependencies: SelfConversationSocketDependencies, caller: ConversationCaller, conversationId: string, cursor: ReturnType<typeof __DecodeConversationProjectionCursor>): Promise<void>
{
	const abort = new AbortController();
	function _Abort(): void { abort.abort(); }
	socket.once("close", _Abort);
	socket.once("error", _Abort);
	dependencies.shutdownSignal?.addEventListener("abort", _Abort, { once: true });
	let commands = Promise.resolve();
	socket.on("message", function _Message(data, isBinary)
	{
		if (isBinary) { socket.close(1003, "binary_commands_are_not_supported"); return; }
		commands = commands.then(function _Submit() { return _SubmitMessage(socket, dependencies, caller, conversationId, data.toString()); });
	});
	try
	{
		const outcome = await __StreamConversationProjection({ reader: dependencies.repository, ...(dependencies.interrupts === undefined ? {} : { interrupts: dependencies.interrupts }), clock: dependencies.clock, limits: dependencies.limits }, _SocketSink(socket), { conversationId, siloId: caller.siloId, subjectId: caller.subjectId, cursor, signal: abort.signal });
		if (outcome === ConversationProjectionOutcomes.RevokedOrMissing && socket.readyState === WebSocket.OPEN) socket.close(1008, "conversation_unavailable");
		else if (socket.readyState === WebSocket.OPEN) socket.close(1000, "reconnect");
	}
	catch (error)
	{
		if (!abort.signal.aborted) dependencies.logger.error({ err: error, operation: "conversation.socket.replay", siloId: caller.siloId }, "Conversation socket replay failed");
		if (socket.readyState === WebSocket.OPEN) socket.close(1011, "conversation_unavailable");
	}
	finally
	{
		socket.removeListener("close", _Abort);
		socket.removeListener("error", _Abort);
		dependencies.shutdownSignal?.removeEventListener("abort", _Abort);
	}
}

/** Submit a parsed participant command and answer only its caller with a correlation id. */
async function _SubmitMessage(socket: WebSocket, dependencies: SelfConversationSocketDependencies, caller: ConversationCaller, conversationId: string, raw: string): Promise<void>
{
	const command = _CommandSchema.safeParse(_Json(raw));
	if (!command.success) { _Send(socket, { type: "conversation.message.rejected", requestId: _RequestId(raw), error: "invalid_conversation_message" }); return; }
	try
	{
		const result = await dependencies.authority.submitMessage(caller, conversationId, command.data);
		if (result.outcome === ConversationAuthorityOutcomes.Denied) { _Send(socket, { type: "conversation.message.rejected", requestId: command.data.requestId, error: result.reason }); return; }
		_Send(socket, { type: "conversation.message.accepted", requestId: command.data.requestId, outcome: result.outcome });
	}
	catch (error)
	{
		dependencies.logger.error({ err: error, operation: "conversation.socket.message.submit", siloId: caller.siloId }, "Conversation socket message submission failed");
		_Send(socket, { type: "conversation.message.rejected", requestId: command.data.requestId, error: ConversationWriteDenialReasons.PersistenceUnavailable });
	}
}

/** Parse JSON without throwing from a WebSocket callback. */
function _Json(raw: string): unknown { try { return JSON.parse(raw) as unknown; } catch { return null; } }

/** Recover a correlation id from malformed data when possible, without reflecting arbitrary fields. */
function _RequestId(raw: string): string | null
{
	const value = _Json(raw);
	return typeof value === "object" && value !== null && typeof (value as Record<string, unknown>)["requestId"] === "string" ? (value as Record<string, unknown>)["requestId"] as string : null;
}

/** Send a protocol object when the peer is still attached. */
function _Send(socket: WebSocket, value: unknown): void
{
	if (socket.readyState !== WebSocket.OPEN) return;
	try { socket.send(JSON.stringify(value)); }
	catch { socket.close(1011, "socket_write_failed"); }
}

/** Adapt backpressure-aware projection writes to WebSocket frames. */
function _SocketSink(socket: WebSocket): ConversationProjectionSink
{
	let drain: Promise<void> | null = null;
	return {
		open(): void {},
		write(value: string): boolean
		{
			if (socket.readyState !== WebSocket.OPEN) return false;
			const frame = _SocketProjectionFrame(value);
			if (frame === null) { socket.close(1011, "projection_encoding_failed"); return false; }
			const flushed = _FlushSocketFrame(socket, frame);
			if (socket.bufferedAmount < _MAXIMUM_BUFFERED_BYTES) return true;
			drain ??= flushed;
			return false;
		},
		drain: async function _Drain(signal: AbortSignal): Promise<void>
		{
			if (signal.aborted || drain === null) return;
			await _DrainSocket(signal, drain);
			drain = null;
		}
	};
}

/** Finish a queued frame when the socket writes it or the peer disconnects. */
function _FlushSocketFrame(socket: WebSocket, frame: Record<string, unknown>): Promise<void>
{
	return new Promise<void>(function _Flush(resolve)
	{
		try { socket.send(JSON.stringify(frame), function _Sent() { resolve(); }); }
		catch { resolve(); }
	});
}

/** Stop waiting for a congested peer when the projection owner has cancelled its stream. */
function _DrainSocket(signal: AbortSignal, drain: Promise<void>): Promise<void>
{
	if (signal.aborted) return Promise.resolve();
	return new Promise<void>(function _Drain(resolve)
	{
		function _Aborted(): void { signal.removeEventListener("abort", _Aborted); resolve(); }
		signal.addEventListener("abort", _Aborted, { once: true });
		drain.finally(function _Flushed() { signal.removeEventListener("abort", _Aborted); resolve(); });
	});
}

/** Translate the projection engine's internal SSE serializer into a structured WebSocket frame. */
function _SocketProjectionFrame(value: string): Record<string, unknown> | null
{
	if (value.trim().startsWith(":")) return { type: "conversation.heartbeat" };
	const fields = new Map<string, string>();
	for (const line of value.replaceAll("\r\n", "\n").trimEnd().split("\n"))
	{
		const separator = line.indexOf(":");
		if (separator <= 0 || fields.has(line.slice(0, separator))) return null;
		fields.set(line.slice(0, separator), line.slice(separator + 1).trimStart());
	}
	const event = fields.get("event");
	const data = fields.get("data");
	const id = fields.get("id");
	if (event !== "ag-ui" || data === undefined || (id !== undefined && (id.length === 0 || /[\r\n]/u.test(id)))) return null;
	try { return { type: "conversation.event", ...(id === undefined ? {} : { id }), event, data: JSON.parse(data) as unknown }; }
	catch { return null; }
}
