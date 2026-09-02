import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";

import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";

import { ConversationSocketFrameKinds, ___ParticipantInputBlocksSchema } from "@opencrane/models/conversations";
import { __DecodeConversationProjectionCursor, __StreamConversationProjection, ConversationProjectionOutcomes, type ConversationProjectionDependencies, type ConversationProjectionSink } from "@opencrane/backend/conversations/projection";

import { ConversationAuthorityOutcomes, ConversationWriteDenialReasons } from "./types/conversation-authority-result.types";
import type { SelfConversationSocketDependencies, SelfConversationSocketServer } from "./self-conversation-socket.types";
import type { ConversationCaller } from "./types/conversation-caller.types";

/** Limits one connection's buffered frames before projection waits for the peer to catch up. */
const _MAXIMUM_BUFFERED_BYTES = 1_048_576;

/** Describes the validated conversation and optional replay cursor from a socket request. */
type _ConversationSocketSelection = {
	/** Identifies the conversation selected by the socket path. */
	readonly conversationId: string;
	/** Carries the browser's last received projection position when it reconnects. */
	readonly cursor: string | null;
};

/** Validates direct and group participant message submissions. */
const _MessageCommandSchema = z.object({
	type: z.literal(ConversationSocketFrameKinds.MessageSubmit),
	requestId: z.string().uuid(),
	idempotencyKey: z.string().trim().min(1).max(128),
	blocks: ___ParticipantInputBlocksSchema,
	agentTarget: z.object({ agentServiceId: z.string().trim().min(1).max(128) }).strict().optional(),
}).strict();

/** Validates one AgentSession text input before it reaches immutable ConversationComputer history. */
const _ComputerInputCommandSchema = z.object({
	type: z.literal(ConversationSocketFrameKinds.ComputerInputSubmit),
	requestId: z.string().uuid(),
	inputId: z.string().uuid(),
	text: z.string().trim().min(1).max(64 * 1024),
}).strict();

/** Accepts exactly the two public submission frames that their separate authorities own. */
const _CommandSchema = z.discriminatedUnion("type", [_MessageCommandSchema, _ComputerInputCommandSchema]);

/**
 * Builds a WebSocket endpoint for one participant's projection and input submissions.
 *
 * The HTTP listener receives every upgrade, so this boundary rejects unrelated paths before `ws`
 * takes a socket. It authenticates the request, then passes that caller to the replay, direct/group
 * message, and AgentSession input authorities; no frame can choose a participant or conversation.
 * `attach` may be called once; `close` asks active sockets to reconnect while the process drains.
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
				const selection = _SelectConversationSocket(request);
				if (selection === null)
				{
					socket.destroy();
					return;
				}

				// Node does not await upgrade listeners, so the detached handler owns cleanup.
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

/**
 * Selects a valid conversation socket request from the HTTP listener's upgrade events.
 *
 * The listener also receives unrelated upgrades; returning `null` lets it close them before
 * authentication or `ws` ownership. A supplied cursor must decode before it reaches the projection
 * reader.
 */
function _SelectConversationSocket(request: IncomingMessage): _ConversationSocketSelection | null
{
	const host = request.headers.host;
	if (host === undefined) return null;

	let url: URL;
	try
	{
		url = new URL(request.url ?? "", `https://${host}`);
	}
	catch
	{
		return null;
	}

	const match = /^\/api\/v1\/me\/conversations\/([^/]+)\/socket$/u.exec(url.pathname);
	if (match === null) return null;

	let conversationId: string;
	try
	{
		conversationId = decodeURIComponent(match[1] ?? "").trim();
	}
	catch
	{
		return null;
	}

	const cursor = url.searchParams.get("cursor");
	if (conversationId.length === 0) return null;
	if (cursor !== null && __DecodeConversationProjectionCursor(cursor) === null) return null;

	return { conversationId, cursor };
}

/** Authenticate the upgrade before allowing the WebSocket server to take ownership of its socket. */
async function _UpgradeConversation(socketServer: WebSocketServer, dependencies: SelfConversationSocketDependencies, request: IncomingMessage, socket: Duplex, head: Buffer, conversationId: string, rawCursor: string | null): Promise<void>
{
	let caller: ConversationCaller | null;
	try
	{
		caller = await dependencies.authenticator.authenticate(request);
	}
	catch (error)
	{
		dependencies.logger.error({ err: error, operation: "conversation.socket.authenticate" }, "Conversation socket authentication failed");
		socket.destroy();
		return;
	}

	if (caller === null)
	{
		socket.destroy();
		return;
	}

	const cursor = rawCursor === null ? null : __DecodeConversationProjectionCursor(rawCursor);
	if (cursor === null && rawCursor !== null)
	{
		socket.destroy();
		return;
	}

	if (cursor !== null && cursor.conversationId !== conversationId)
	{
		socket.destroy();
		return;
	}

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

/** Runs one projection tail and serializes its caller's direct/group messages or AgentSession input. */
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
		if (isBinary)
		{
			socket.close(1003, "binary_commands_are_not_supported");
			return;
		}

		commands = commands.then(function _Submit()
		{
			return __SubmitSelfConversationSocketCommand(socket, dependencies, caller, conversationId, data.toString());
		});
	});
	try
	{
		const outcome = await __StreamConversationProjection(_ProjectionOptions(dependencies), _SocketSink(socket), { conversationId, siloId: caller.siloId, subjectId: caller.subjectId, cursor, signal: abort.signal });
		if (socket.readyState !== WebSocket.OPEN) return;
		if (outcome === ConversationProjectionOutcomes.RevokedOrMissing)
		{
			socket.close(1008, "conversation_unavailable");
			return;
		}

		socket.close(1000, "reconnect");
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

/** Pass the socket's shared ports and configured interrupt reader to the projection loop. */
function _ProjectionOptions(dependencies: SelfConversationSocketDependencies): ConversationProjectionDependencies
{
	const required = { reader: dependencies.repository, clock: dependencies.clock, limits: dependencies.limits };
	if (dependencies.interrupts === undefined) return required;

	return { ...required, interrupts: dependencies.interrupts };
}

/**
 * Submits one validated participant frame and returns its correlated result to that socket only.
 *
 * Called by: `_ServeConversationSocket` and the socket-command contract test.
 */
export async function __SubmitSelfConversationSocketCommand(socket: WebSocket, dependencies: SelfConversationSocketDependencies, caller: ConversationCaller, conversationId: string, raw: string): Promise<void>
{
	const command = _CommandSchema.safeParse(_Json(raw));
	if (!command.success)
	{
		_Send(socket, { type: ConversationSocketFrameKinds.MessageRejected, requestId: _RequestId(raw), error: "invalid_conversation_message" });
		return;
	}

	try
	{
		if (command.data.type === ConversationSocketFrameKinds.MessageSubmit)
		{
			const result = await dependencies.authority.submitMessage(caller, conversationId, command.data);
			if (result.outcome === ConversationAuthorityOutcomes.Denied)
			{
				_Send(socket, { type: ConversationSocketFrameKinds.MessageRejected, requestId: command.data.requestId, error: result.reason });
				return;
			}

			_Send(socket, { type: ConversationSocketFrameKinds.MessageAccepted, requestId: command.data.requestId, outcome: result.outcome });
			return;
		}

		if (dependencies.computerInputs === null)
		{
			_Send(socket, { type: ConversationSocketFrameKinds.ComputerInputRejected, requestId: command.data.requestId, error: "conversation_computer_unavailable" });
			return;
		}
		const result = await dependencies.computerInputs.admit(caller, conversationId, { inputId: command.data.inputId, text: command.data.text });
		if (result === null)
		{
			_Send(socket, { type: ConversationSocketFrameKinds.ComputerInputRejected, requestId: command.data.requestId, error: "conversation_unavailable" });
			return;
		}
		_Send(socket, { type: ConversationSocketFrameKinds.ComputerInputAccepted, requestId: command.data.requestId, outcome: result.outcome, inputEntryId: result.inputEntryId });
	}
	catch (error)
	{
		dependencies.logger.error({ err: error, operation: "conversation.socket.command.submit", siloId: caller.siloId }, "Conversation socket command submission failed");
		const type = command.data.type === ConversationSocketFrameKinds.MessageSubmit ? ConversationSocketFrameKinds.MessageRejected : ConversationSocketFrameKinds.ComputerInputRejected;
		_Send(socket, { type, requestId: command.data.requestId, error: ConversationWriteDenialReasons.PersistenceUnavailable });
	}
}

/** Parse untrusted WebSocket text without letting malformed JSON escape its callback. */
function _Json(raw: string): unknown
{
	try
	{
		return JSON.parse(raw) as unknown;
	}
	catch
	{
		return null;
	}
}

/** Recover a correlation id from malformed data when possible, without reflecting arbitrary fields. */
function _RequestId(raw: string): string | null
{
	const value = _Json(raw);
	if (typeof value !== "object" || value === null) return null;

	const requestId = (value as Record<string, unknown>)["requestId"];
	return typeof requestId === "string" ? requestId : null;
}

/** Serializes a response frame only while its peer remains open. */
function _Send(socket: WebSocket, value: unknown): void
{
	if (socket.readyState !== WebSocket.OPEN) return;
	try { socket.send(JSON.stringify(value)); }
	catch { socket.close(1011, "socket_write_failed"); }
}

/**
 * Translates the projection loop's SSE records into WebSocket frames and relays backpressure.
 *
 * The projection loop stops reading more authorized rows when `write` returns `false`, so this
 * adapter waits for the `ws` send callback after the buffered-byte limit is reached.
 */
function _SocketSink(socket: WebSocket): ConversationProjectionSink
{
	let drain: Promise<void> | null = null;
	return {
		open(): void {},
		write(value: string): boolean
		{
			if (socket.readyState !== WebSocket.OPEN) return false;
			const frame = _SocketProjectionFrame(value);
			if (frame === null)
			{
				socket.close(1011, "projection_encoding_failed");
				return false;
			}

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

/** Resolve an in-flight frame when `ws` sends it or rejects the write synchronously. */
function _FlushSocketFrame(socket: WebSocket, frame: Record<string, unknown>): Promise<void>
{
	return new Promise<void>(function _Flush(resolve)
	{
		try
		{
			socket.send(JSON.stringify(frame), function _Sent()
			{
				resolve();
			});
		}
		catch
		{
			resolve();
		}
	});
}

/** Stop waiting for a congested peer when the projection owner has cancelled its stream. */
function _DrainSocket(signal: AbortSignal, drain: Promise<void>): Promise<void>
{
	if (signal.aborted) return Promise.resolve();
	return new Promise<void>(function _Drain(resolve)
	{
		function _Aborted(): void
		{
			signal.removeEventListener("abort", _Aborted);
			resolve();
		}

		signal.addEventListener("abort", _Aborted, { once: true });
		drain.finally(function _Flushed()
		{
			signal.removeEventListener("abort", _Aborted);
			resolve();
		});
	});
}

/**
 * Converts the projection loop's SSE records into the JSON frame protocol.
 *
 * The same loop also serves SSE transports, so the socket accepts complete `ag-ui` records before
 * parsing their `data` field.
 */
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
	if (event !== "ag-ui" || data === undefined) return null;
	if (id !== undefined && (id.length === 0 || /[\r\n]/u.test(id))) return null;

	try
	{
		return { type: "conversation.event", ...(id === undefined ? {} : { id }), event, data: JSON.parse(data) as unknown };
	}
	catch
	{
		return null;
	}
}
