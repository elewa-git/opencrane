import { Type } from "@sinclair/typebox";

/**
 * TypeBox schemas for the OpenClaw Gateway v4 WebSocket protocol.
 *
 * These mirror `packages/gateway-protocol/src/schema/` in the official OpenClaw
 * repo (https://docs.openclaw.ai/gateway/protocol). The frame envelope is
 * validated strictly; per-event payloads are validated tolerantly because the
 * protocol defines many event families and we only read the fields we render.
 */

/** Client → gateway request frame. */
export const ReqFrameSchema = Type.Object({
	type: Type.Literal("req"),
	id: Type.String(),
	method: Type.String(),
	params: Type.Optional(Type.Unknown())
});

/** Gateway → client response frame. */
export const ResFrameSchema = Type.Object({
	type: Type.Literal("res"),
	id: Type.String(),
	ok: Type.Boolean(),
	payload: Type.Optional(Type.Unknown()),
	error: Type.Optional(Type.Object({
		code: Type.Optional(Type.String()),
		message: Type.String()
	}))
});

/**
 * Known server-pushed event families (https://docs.openclaw.ai/gateway/protocol).
 * The envelope accepts any string `event` (below) so unrecognised families are
 * never dropped as invalid; this list documents the ones we may switch on.
 */
export const KNOWN_GATEWAY_EVENTS = [
	"chat",
	"session.message",
	"session.operation",
	"session.tool",
	"presence",
	"tick",
	"health",
	"heartbeat",
	"cron",
	"shutdown"
] as const;

/** Event family signalling the pod is going away / the connection is ending. */
export const GATEWAY_SHUTDOWN_EVENT = "shutdown";

/** Event family the gateway emits as a periodic liveness ping. */
export const GATEWAY_HEARTBEAT_EVENT = "heartbeat";

/** Event family carrying the pod/session health snapshot. */
export const GATEWAY_HEALTH_EVENT = "health";

/** Event family carrying long-running operation status for the open session. */
export const GATEWAY_OPERATION_EVENT = "session.operation";

/**
 * Gateway → client event frame. `event` is left open (`Type.String()`): the
 * protocol has many families (chat, session.*, presence, tick, approvals,
 * …) and a strict union would reject — and so silently drop — valid
 * frames we don't specifically handle.
 */
export const EventFrameSchema = Type.Object({
	type: Type.Literal("event"),
	event: Type.String(),
	payload: Type.Optional(Type.Unknown()),
	seq: Type.Optional(Type.Number()),
	stateVersion: Type.Optional(Type.Number())
});

/** Any inbound frame from the gateway (plus outbound req for symmetry). */
export const FrameSchema = Type.Union([ReqFrameSchema, ResFrameSchema, EventFrameSchema]);

// ---------------------------------------------------------------------------
// connect handshake (https://docs.openclaw.ai/gateway/protocol)
// ---------------------------------------------------------------------------

/**
 * Pre-connect challenge the gateway pushes before the `connect` request.
 *
 * The gateway emits this on every socket (https://docs.openclaw.ai/gateway/protocol),
 * so it stays the trigger for sending `connect`. Under trusted-proxy auth the client
 * does NOT sign the `nonce` — identity comes from the proxy-injected `X-Forwarded-User`
 * header — so the nonce is read for completeness but not used. See `openclaw-connection.ts`.
 */
export const ConnectChallengeSchema = Type.Object({
	nonce: Type.String(),
	ts: Type.Optional(Type.Number())
}, { additionalProperties: true });

/**
 * `hello-ok` payload returned once the `connect` handshake succeeds. Tolerant —
 * the gateway also returns `server`/`features`/`snapshot`/`policy`, which we do not
 * read. `auth.scopes` is the server-granted scope set (a device-less trusted-proxy
 * session is granted scopes server-side from its pinned owner identity, not from the
 * client's request — https://docs.openclaw.ai/gateway/trusted-proxy-auth).
 */
export const HelloOkSchema = Type.Object({
	auth: Type.Optional(Type.Object({
		role: Type.Optional(Type.String()),
		scopes: Type.Optional(Type.Array(Type.String()))
	}, { additionalProperties: true })),
	protocol: Type.Optional(Type.Number())
}, { additionalProperties: true });

// ---------------------------------------------------------------------------
// chat event — streaming assistant output (protocol v4)
// ---------------------------------------------------------------------------

/** One content part of an assistant message (v2026.x `message.content[]`). */
export const ChatContentPartSchema = Type.Object({
	type: Type.Optional(Type.String()),
	text: Type.Optional(Type.String())
}, { additionalProperties: true });

/**
 * The cumulative assistant message OBJECT a `chat` event carries in openclaw
 * v2026.x: `{ role, content: [{ type: "text", text }], stopReason, timestamp }`.
 * `content` is normally an array of typed parts but tolerates a bare string.
 * Completion is signalled by a non-empty `stopReason` (e.g. "stop") — there is
 * no separate `done`/`final` boolean on this shape.
 */
export const ChatMessageObjectSchema = Type.Object({
	role: Type.Optional(Type.String()),
	content: Type.Optional(Type.Union([Type.String(), Type.Array(ChatContentPartSchema)])),
	stopReason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	timestamp: Type.Optional(Type.Number())
}, { additionalProperties: true });

/**
 * Payload of a `chat` event. TWO shapes are accepted (verified against a live
 * openclaw@2026.6.9 gateway frame):
 *  - v2026.x (LIVE): a cumulative `message` OBJECT (see {@link ChatMessageObjectSchema})
 *    keyed by `runId`/`idempotencyKey`; the turn closes on a non-empty `message.stopReason`.
 *  - legacy/flat: incremental `deltaText` + a `message` STRING snapshot with `done`/`final`
 *    booleans (kept for older gateway builds and the mock gateway).
 * `message` is therefore a string-or-object union — the previous string-only schema
 * REJECTED every live frame (object `message`), so `_DecodeChatEvent` dropped the reply
 * and nothing rendered. Tolerant (`additionalProperties`) — only rendered fields are typed.
 */
export const ChatEventSchema = Type.Object({
	deltaText: Type.Optional(Type.String()),
	replace: Type.Optional(Type.Boolean()),
	seq: Type.Optional(Type.Number()),
	messageId: Type.Optional(Type.String()),
	runId: Type.Optional(Type.String()),
	idempotencyKey: Type.Optional(Type.String()),
	message: Type.Optional(Type.Union([Type.String(), ChatMessageObjectSchema])),
	role: Type.Optional(Type.String()),
	done: Type.Optional(Type.Boolean()),
	final: Type.Optional(Type.Boolean())
}, { additionalProperties: true });

/**
 * Payload of a `session.tool` event — tool-call activity for the open session.
 * The granular shape is not pinned in the docs, so this is tolerant; we surface
 * a name/status when present.
 */
export const SessionToolEventSchema = Type.Object({
	name: Type.Optional(Type.String()),
	tool: Type.Optional(Type.String()),
	status: Type.Optional(Type.String()),
	messageId: Type.Optional(Type.String())
}, { additionalProperties: true });

// ---------------------------------------------------------------------------
// chat.history — bounded recent-window fetch (request/response).
// ---------------------------------------------------------------------------

/**
 * Params for the `chat.history` method (verbatim from the gateway schema,
 * `packages/gateway-protocol/src/schema/logs-chat.ts`).
 *
 * IMPORTANT — this is a bounded *recent window*, not cursor pagination. `limit`
 * (≤1000) returns the most-recent rows and `maxChars` (≤500k) caps the payload;
 * the gateway exposes no `before`/`after`/cursor param, so history older than
 * the returned window cannot be paged through here. Individual older rows are
 * fetched on demand via `chat.message.get` by `messageId`. See docs/architecture.md §3.3.
 */
export const ChatHistoryParamsSchema = Type.Object({
	sessionKey: Type.String(),
	agentId: Type.Optional(Type.String()),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
	maxChars: Type.Optional(Type.Integer({ minimum: 1, maximum: 500_000 }))
});

/**
 * A single display-normalised transcript row from `chat.history`.
 *
 * The exact row shape is not pinned in the published docs, so this is tolerant
 * (`additionalProperties: true`) and only asserts the fields we read; reconcile
 * with the generated JSON Schema when pinned.
 */
export const HistoryMessageSchema = Type.Object({
	id: Type.Optional(Type.String()),
	role: Type.Optional(Type.String()),
	text: Type.Optional(Type.String()),
	// Assistant rows carry `content` as the SAME typed-parts array the live `chat`
	// event uses (`[{ type: "text", text }]`), not a string — so it must be decoded
	// through the shared content readers, not read as a string. See _HistoryRowContent.
	content: Type.Optional(Type.Unknown()),
	createdAt: Type.Optional(Type.Unknown()),
	timestamp: Type.Optional(Type.Unknown())
}, { additionalProperties: true });

// ---------------------------------------------------------------------------
// chat.abort — interrupt an in-flight run (verified: openclaw@2026.6.9,
// gateway/server-methods; params { sessionKey, agentId? }).
// ---------------------------------------------------------------------------

/** Params for the `chat.abort` method — stop the running turn for a session. */
export const ChatAbortParamsSchema = Type.Object({
	sessionKey: Type.String(),
	agentId: Type.Optional(Type.String())
});

// ---------------------------------------------------------------------------
// chat.message.get — fetch one transcript message by id (verified: openclaw
// @2026.6.9, chat handlers; params { sessionKey, messageId, allowResetArchiveFallback? }).
// This is a POINT lookup, NOT cursor pagination — the gateway exposes no
// before/after cursor, so it can't page arbitrarily far back.
// ---------------------------------------------------------------------------

/** Params for the `chat.message.get` single-message fetch. */
export const ChatMessageGetParamsSchema = Type.Object({
	sessionKey: Type.String(),
	messageId: Type.String(),
	allowResetArchiveFallback: Type.Optional(Type.Boolean())
});

// ---------------------------------------------------------------------------
// models.list / agents.list — catalogue reads for the picker (verified:
// openclaw@2026.6.9; responses wrap the rows under `models` / `agents`).
// ---------------------------------------------------------------------------

/** A model catalogue row. Tolerant — only the picker-relevant fields are typed. */
export const ModelInfoSchema = Type.Object({
	id: Type.Optional(Type.String()),
	name: Type.Optional(Type.String()),
	label: Type.Optional(Type.String()),
	provider: Type.Optional(Type.String())
}, { additionalProperties: true });

/** An agent catalogue row. Tolerant — only the picker-relevant fields are typed. */
export const AgentInfoSchema = Type.Object({
	id: Type.Optional(Type.String()),
	name: Type.Optional(Type.String()),
	identity: Type.Optional(Type.Object({
		name: Type.Optional(Type.String()),
		theme: Type.Optional(Type.String())
	}, { additionalProperties: true }))
}, { additionalProperties: true });

// ---------------------------------------------------------------------------
// lifecycle + operation events (payloads tolerant — only rendered fields typed).
// ---------------------------------------------------------------------------

/**
 * Payload of a `session.operation` event — status of a long-running operation on
 * the open session (e.g. compaction). Shapes vary across operations, so this is
 * tolerant; we surface a label/status/phase when present and treat a terminal
 * status ("done"/"complete"/"error"/"failed"/"cancelled") as clearing it.
 */
export const SessionOperationEventSchema = Type.Object({
	operation: Type.Optional(Type.String()),
	kind: Type.Optional(Type.String()),
	label: Type.Optional(Type.String()),
	status: Type.Optional(Type.String()),
	phase: Type.Optional(Type.String()),
	done: Type.Optional(Type.Boolean())
}, { additionalProperties: true });

/**
 * Payload of a `health` event — the pod/session health snapshot. Tolerant; we read
 * an `ok`/`status` signal to drive a degraded indicator.
 */
export const HealthEventSchema = Type.Object({
	ok: Type.Optional(Type.Boolean()),
	status: Type.Optional(Type.String())
}, { additionalProperties: true });

/**
 * Payload of a `shutdown` event — the pod is going away (redeploy, idle-suspend,
 * scale-down). Tolerant; the presence of the event is the signal, `reason` is
 * surfaced when present.
 */
export const ShutdownEventSchema = Type.Object({
	reason: Type.Optional(Type.String())
}, { additionalProperties: true });
