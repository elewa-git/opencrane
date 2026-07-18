import { ErrorHandler, Injectable, Signal, computed, inject, signal } from "@angular/core";

import { AgentOption, ControlPlaneApiService, MessageCardKind, MessageDelivery, ModelOption, SessionSummary, ThreadData, ThreadMessage } from "@opencrane/core";
import { CONVERSATION_CACHE, ConnectionStatus, ConversationGateway, SessionStore } from "@opencrane/state/core";

import { OpenClawConnection, _DecodeAgentList, _DecodeChatEvent, _DecodeHealth, _DecodeHistory, _DecodeModelList, _DecodeSessionOperation, _DecodeSessionTool, _IsSecureGatewayUrl } from "./openclaw-connection";
import { _ChatEventAttachments, _ChatEventDelivery, _ChatEventDone, _ChatEventId, _ChatEventIsSnapshot, _ChatEventRole, _ChatEventText, _ChatEventThinking, _ChatEventToolResults, _ChatEventTools, _HistoryRowContent } from "./chat-event.util";
import { _BuildAssistantCards, _FoldHistoryToolResults, _HasRenderableCards, _LocateToolResultTarget, _MergeToolCard, _MergeToolResults, HistoryBuilt } from "./assistant-cards.util";
import { _IsHistoryExhausted, _MergeLiveTail } from "./history.util";
import { _OperationLabel, _OperationIsTerminal } from "./operation.util";
import { _PodTokenFailureStatus } from "./pod-token.util";
import { _ReconnectDelayMs } from "./reconnect.util";
import { _MapSessionSummaries } from "./session-list.util";
import { GATEWAY_HEALTH_EVENT, GATEWAY_HEARTBEAT_EVENT, GATEWAY_OPERATION_EVENT, GATEWAY_SHUTDOWN_EVENT } from "./gateway-protocol.schema";
import { ChatEvent, ChatHistoryParams, EventFrame, HistoryMessage, SessionToolEvent } from "./gateway-protocol.types";

/**
 * Connection coordinates returned by OpenCrane's broker (`POST /auth/pod-token`).
 *
 * Under trusted-proxy gateway auth (CONN.4) the browser holds no credential — the
 * gateway socket is authorised at the ingress against the OIDC session — so the
 * broker returns only the gateway URL, no token. All fields optional — defensive
 * against a stale/partial body.
 */
interface PodConnectionResponse
{
	/** Gateway WebSocket URL (`wss://…`); falls back to `wss://<ingressHost>`. */
	gatewayUrl?: string;

	/** Tenant (pod) name, for thread metadata. */
	tenant?: string;

	/** Host to reach the tenant's OpenClaw pod, when `gatewayUrl` is absent. */
	ingressHost?: string;
}

/** Most-recent history rows to load on open. */
const _DEFAULT_HISTORY_LIMIT = 200;

/** Rows added to the window each time the user scrolls up to load older. */
const _HISTORY_PAGE = 200;

/** Hard ceiling on the history window — the gateway returns no more than this. */
const _HISTORY_MAX = 1000;

/** Payload-size cap sent on `chat.history` (gateway max 500_000). */
const _HISTORY_MAX_CHARS = 200_000;

/**
 * Live `ConversationGateway` backed by an OpenClaw pod over the validated
 * Gateway v4 WebSocket connection.
 *
 * Resolves the caller's pod (`SessionStore.currentTenant.ingressHost`) and its
 * gateway URL (`POST /auth/pod-token`), opens a TypeBox-validated
 * `OpenClawConnection`, and maps each agent chunk onto the conversation signals.
 *
 * Not the default provider yet — swap it in for `MockConversationGateway` once
 * the pod transport is reachable (the WS path, auth, and subscribe/send method
 * names marked ASSUMPTION below need confirmation).
 */
@Injectable()
export class OpenClawConversationGateway implements ConversationGateway
{
	private readonly _api = inject(ControlPlaneApiService);
	private readonly _session = inject(SessionStore);
	/** Angular's application error boundary for rejected gateway frames. */
	private readonly _errorHandler = inject(ErrorHandler);
	private readonly _cache = inject(CONVERSATION_CACHE, { optional: true });

	private readonly _status = signal<ConnectionStatus>(ConnectionStatus.Idle);
	private readonly _thread = signal<ThreadData>(this._buildThread(""));
	private readonly _messages = signal<ThreadMessage[]>([]);
	private readonly _typing = signal<boolean>(false);
	private readonly _loadingHistory = signal<boolean>(false);
	private readonly _historyExhausted = signal<boolean>(false);
	private readonly _operation = signal<string | null>(null);
	private readonly _selectedAgentId = signal<string | null>(null);
	private readonly _sessions = signal<SessionSummary[]>([]);

	/** True between `open()` and a deliberate teardown — gates auto-reconnect. */
	private _wantOpen = false;

	/** True when the next close is our own (thread switch) and must not reconnect. */
	private _deliberateClose = false;

	/** Consecutive reconnect attempts, for the backoff curve; reset on `hello-ok`. */
	private _reconnectAttempts = 0;

	/** Pending reconnect timer, or null. */
	private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	/** Id of the assistant message currently being streamed into, if any. */
	private _currentAssistantId: string | null = null;

	/**
	 * Whether a user turn is in flight — set when the user sends, cleared when the
	 * turn's `done` event lands (or the socket closes). Gates the typing indicator
	 * so it shows the whole time the assistant is working (from send, through the
	 * pre-token "thinking" gap, to `done`) and a stray trailing frame can't leave
	 * it stuck on after the turn has closed.
	 */
	private _turnActive = false;

	/** Monotonic source for `chat.send` idempotency keys. */
	private _sendSeq = 0;

	/** Monotonic source for locally-minted message ids. */
	private _localSeq = 0;

	/**
	 * Ids of locally-originated messages (optimistic sends, in-flight stream)
	 * that are not yet part of the server transcript. Used to preserve them
	 * across a history rebuild without guessing from the id string — the server
	 * controls history-row ids and could collide with any prefix heuristic.
	 */
	private readonly _localIds = new Set<string>();

	/** Current history window size (grows as the user scrolls up). */
	private _historyLimit = _DEFAULT_HISTORY_LIMIT;

	/** Row count from the previous history fetch, to detect the true start. */
	private _lastRowCount = -1;

	/** The open thread/session id. */
	private _threadId = "";

	/** The validated gateway connection. */
	private readonly _conn = new OpenClawConnection({
		onOpen: this._onOpen.bind(this),
		onClose: this._onClose.bind(this),
		onEvent: this._onEvent.bind(this),
		onInvalid: this._onInvalid.bind(this)
	});

	/** @inheritdoc */
	public readonly status: Signal<ConnectionStatus> = this._status.asReadonly();

	/** @inheritdoc */
	public readonly thread: Signal<ThreadData> = this._thread.asReadonly();

	/** @inheritdoc */
	public readonly messages: Signal<ThreadMessage[]> = this._messages.asReadonly();

	/** @inheritdoc */
	public readonly typing: Signal<boolean> = this._typing.asReadonly();

	/** @inheritdoc */
	public readonly operation: Signal<string | null> = this._operation.asReadonly();

	/** @inheritdoc */
	public readonly selectedAgentId: Signal<string | null> = this._selectedAgentId.asReadonly();

	/** @inheritdoc */
	public readonly sessions: Signal<SessionSummary[]> = this._sessions.asReadonly();

	/** @inheritdoc */
	public readonly loadingHistory: Signal<boolean> = this._loadingHistory.asReadonly();

	/** @inheritdoc */
	public readonly hasMoreHistory: Signal<boolean> = computed((): boolean =>
	{
		return !this._historyExhausted();
	});

	/**
	 * @inheritdoc
	 *
	 * The gateway answers `sessions.list` with `{ sessions: [...] }` (openclaw
	 * @2026.6.9); rows are normalised defensively through `_MapSessionSummaries`.
	 *
	 * Enumeration needs an open socket. The socket comes up when a thread is opened
	 * OR eagerly via {@link ensureConnected} (the sidebar reads the live
	 * {@link sessions} signal, which `_onOpen` refreshes — this promise form is kept
	 * for callers that want a one-shot). Resolves `[]` when the socket is not open.
	 */
	public async listSessions(): Promise<SessionSummary[]>
	{
		return this._refreshSessions();
	}

	/**
	 * Fetch `sessions.list`, publish it to the {@link sessions} signal, and return
	 * it. No-ops to the current value when the socket is not open (best-effort — a
	 * failure leaves the sidebar as-is rather than breaking the workspace shell).
	 */
	private async _refreshSessions(): Promise<SessionSummary[]>
	{
		if (!this._conn.isOpen)
		{
			return this._sessions();
		}
		try
		{
			const res = await this._conn.request("sessions.list");
			if (!res.ok)
			{
				return this._sessions();
			}
			const payload = res.payload;
			const rows = payload && typeof payload === "object" && "sessions" in payload
				? (payload as { sessions: unknown }).sessions
				: payload;
			const mapped = _MapSessionSummaries(rows);
			this._sessions.set(mapped);
			const key = this._tenantKey();
			if (key)
			{
				void this._cache?.saveSessions(key, mapped);
			}
			return mapped;
		}
		catch
		{
			return this._sessions();
		}
	}

	/** Stable local-cache key for the current tenant's session list (pod owner). */
	private _tenantKey(): string | null
	{
		return this._session.currentTenant()?.name ?? null;
	}

	/**
	 * Paint the last-seen session list from the local cache so the sidebar is
	 * populated instantly on load — before the socket opens and `sessions.list`
	 * returns. Only applies while the list is still empty (never clobbers live data)
	 * and the tenant hasn't changed under the async load.
	 */
	private async _restoreSessionsFromCache(): Promise<void>
	{
		const key = this._tenantKey();
		if (!this._cache || !key)
		{
			return;
		}
		const cached = await this._cache.loadSessions(key);
		if (cached && cached.length > 0 && this._sessions().length === 0 && this._tenantKey() === key)
		{
			this._sessions.set(cached);
		}
	}

	/**
	 * @inheritdoc
	 *
	 * Bring the gateway socket up WITHOUT opening a specific thread, so the sidebar
	 * can enumerate sessions on any route (e.g. the blank new-session root, where no
	 * thread — and so no connection — otherwise exists). No-op when already open or
	 * coming up; refreshes the session list when a socket is already live.
	 */
	public ensureConnected(): void
	{
		// Paint the cached session list immediately, then reconcile once the socket opens.
		void this._restoreSessionsFromCache();
		if (this._conn.isOpen)
		{
			void this._refreshSessions();
			return;
		}
		const status = this._status();
		if (status === ConnectionStatus.Connecting || status === ConnectionStatus.Reconnecting)
		{
			return;
		}
		this._wantOpen = true;
		this._status.set(ConnectionStatus.Connecting);
		void this._openAsync();
	}

	/** @inheritdoc */
	public open(threadId: string): void
	{
		this._threadId = threadId;
		this._currentAssistantId = null;
		this._turnActive = false;
		this._typing.set(false);
		this._operation.set(null);
		this._historyLimit = _DEFAULT_HISTORY_LIMIT;
		this._lastRowCount = -1;
		this._historyExhausted.set(false);
		this._localIds.clear();
		this._messages.set([]);
		this._thread.set(this._buildThread(threadId));
		// We intend to stay connected to this thread; a drop should auto-reconnect.
		// The imminent socket swap's close is ours (deliberate), not a real drop.
		this._wantOpen = true;
		this._deliberateClose = true;
		this._reconnectAttempts = 0;
		this._clearReconnectTimer();
		this._status.set(ConnectionStatus.Connecting);
		void this._restoreFromCache(threadId);
		void this._restoreSessionsFromCache();
		void this._openAsync();
	}

	/**
	 * Paint the cached transcript immediately so the thread is readable before
	 * the gateway connects. Only applies if we are still on the same thread and
	 * no live data has landed yet — the fresh `chat.history` fetch supersedes it.
	 */
	private async _restoreFromCache(threadId: string): Promise<void>
	{
		if (!this._cache)
		{
			return;
		}
		const cached = await this._cache.load(threadId);
		if (cached && this._threadId === threadId && this._messages().length === 0)
		{
			this._messages.set(cached.messages);
		}
	}

	/** Persist the current window to the local cache (best-effort, fire-and-forget). */
	private _persist(): void
	{
		void this._cache?.save(this._threadId, this._messages());
	}

	/** @inheritdoc */
	public send(text: string): void
	{
		const trimmed = text.trim();
		if (!trimmed)
		{
			return;
		}
		const now = this._now();
		const id = this._newLocalId("u");
		this._messages.update(function appendUser(current: ThreadMessage[]): ThreadMessage[]
		{
			return [...current, { id, role: "user", author: "You", time: now, cards: [{ type: MessageCardKind.Text, content: trimmed }] }];
		});
		// The turn is now in flight: show the typing indicator immediately, through
		// the pre-token "thinking" gap, until the assistant's `done` event lands.
		this._turnActive = true;
		this._typing.set(true);
		this._persist();
		// `chat.send` params per packages/gateway-protocol/src/schema/logs-chat.ts:
		// { sessionKey, message, idempotencyKey } (+ optional agentId/attachments/…).
		const agentId = this._selectedAgentId();
		this._conn.send("chat.send", { sessionKey: this._threadId, message: trimmed, idempotencyKey: `idem-${this._threadId}-${Date.now()}-${this._sendSeq++}`, ...(agentId ? { agentId } : {}) });
	}

	/** @inheritdoc */
	public abort(): void
	{
		if (!this._turnActive && !this._typing())
		{
			return;
		}
		const agentId = this._selectedAgentId();
		// Best-effort server abort; a browser can't read a fire-and-forget result.
		this._conn.send("chat.abort", { sessionKey: this._threadId, ...(agentId ? { agentId } : {}) });
		// Close the turn locally so the composer frees up immediately rather than
		// waiting on the server — the in-flight assistant bubble keeps its partial text.
		this._turnActive = false;
		this._typing.set(false);
		this._currentAssistantId = null;
	}

	/** @inheritdoc */
	public sendCanvasAction(action: unknown): void
	{
		if (!this._conn.isOpen || !this._threadId)
		{
			return;
		}
		// A2UI canvas return path: forward the user action to the agent. The `canvas.action`
		// method name is our best guess and is verified against a live pod (opencrane #28);
		// the send is fire-and-forget (a browser can't read a WS upgrade/handler result).
		this._conn.send("canvas.action", { sessionKey: this._threadId, action });
	}

	/** @inheritdoc */
	public async listModels(): Promise<ModelOption[]>
	{
		if (!this._conn.isOpen)
		{
			return [];
		}
		try
		{
			const res = await this._conn.request("models.list");
			if (!res.ok)
			{
				return [];
			}
			return _DecodeModelList(res.payload)
				.filter((row): row is typeof row & { id: string } => typeof row.id === "string" && row.id.length > 0)
				.map((row) => ({ id: row.id, name: row.name ?? row.label ?? row.id, provider: row.provider }));
		}
		catch
		{
			return [];
		}
	}

	/** @inheritdoc */
	public async listAgents(): Promise<AgentOption[]>
	{
		if (!this._conn.isOpen)
		{
			return [];
		}
		try
		{
			const res = await this._conn.request("agents.list");
			if (!res.ok)
			{
				return [];
			}
			return _DecodeAgentList(res.payload)
				.filter((row): row is typeof row & { id: string } => typeof row.id === "string" && row.id.length > 0)
				.map((row) => ({ id: row.id, name: row.name ?? row.identity?.name ?? row.id }));
		}
		catch
		{
			return [];
		}
	}

	/** @inheritdoc */
	public selectAgent(agentId: string | null): void
	{
		this._selectedAgentId.set(agentId && agentId.length > 0 ? agentId : null);
	}

	/** @inheritdoc */
	public async getMessage(messageId: string): Promise<ThreadMessage | null>
	{
		if (!this._conn.isOpen || !this._threadId || !messageId)
		{
			return null;
		}
		try
		{
			const res = await this._conn.request("chat.message.get", { sessionKey: this._threadId, messageId });
			if (!res.ok)
			{
				return null;
			}
			// The response may be the row directly or wrapped under `message`.
			const raw = res.payload && typeof res.payload === "object" && "message" in res.payload
				? (res.payload as { message: unknown }).message
				: res.payload;
			const rows = _DecodeHistory(Array.isArray(raw) ? raw : [raw]);
			return rows.length > 0 ? this._mapHistoryRow(rows[0], 0) : null;
		}
		catch
		{
			return null;
		}
	}

	/** Mint a unique, tracked id for a locally-originated message. */
	private _newLocalId(prefix: string): string
	{
		const id = `local-${prefix}-${this._localSeq++}`;
		this._localIds.add(id);
		return id;
	}

	/** @inheritdoc */
	public history(): Promise<void>
	{
		this._historyLimit = _DEFAULT_HISTORY_LIMIT;
		this._lastRowCount = -1;
		this._historyExhausted.set(false);
		return this._fetchHistory();
	}

	/** @inheritdoc */
	public loadOlder(): Promise<void>
	{
		// Don't rebuild the transcript out from under an in-flight stream.
		if (this._loadingHistory() || this._historyExhausted() || this._typing())
		{
			return Promise.resolve();
		}
		this._historyLimit = Math.min(this._historyLimit + _HISTORY_PAGE, _HISTORY_MAX);
		return this._fetchHistory();
	}

	/**
	 * Re-fetch the current window and rebuild `messages`.
	 *
	 * The gateway has no cursor, so each call asks for the last `_historyLimit`
	 * rows. Locally-originated tail messages (tracked in `_localIds`) are
	 * preserved after the fetched rows. The window is marked exhausted once a
	 * grown limit reveals no new older rows (the true start, robust to the
	 * gateway's `maxChars` truncation) or the hard ceiling is hit.
	 */
	private async _fetchHistory(): Promise<void>
	{
		if (!this._conn.isOpen || !this._threadId)
		{
			return;
		}
		this._loadingHistory.set(true);
		try
		{
			const params: ChatHistoryParams = { sessionKey: this._threadId, limit: this._historyLimit, maxChars: _HISTORY_MAX_CHARS };
			const res = await this._conn.request("chat.history", params);
			if (!res.ok)
			{
				return;
			}
			const rows = _DecodeHistory(res.payload);
			// Map each row, then fold standalone tool-RESULT rows into the preceding assistant's
			// tool card (openclaw emits the call and result in separate messages). Finally drop
			// assistant rows that project to nothing (announce/system/redacted-only turns) so they
			// never render as blank bubbles. User rows are always kept; `rows.length` (raw) still
			// drives exhaustion below.
			const built = rows.map((row, index) => this._buildHistoryRow(row, index));
			const mapped = _FoldHistoryToolResults(built)
				.filter((message) => message.role === "user" || _HasRenderableCards(message.cards));
			this._messages.set(_MergeLiveTail(mapped, this._messages(), this._localIds));
			if (_IsHistoryExhausted(rows.length, this._lastRowCount, this._historyLimit, _HISTORY_MAX))
			{
				this._historyExhausted.set(true);
			}
			this._lastRowCount = rows.length;
			this._persist();
		}
		catch
		{
			// History is best-effort; live streaming works without a backfill.
		}
		finally
		{
			this._loadingHistory.set(false);
		}
	}

	/**
	 * Broker the OpenClaw connection coordinates (`POST /auth/pod-token`) and open
	 * the connection. The `connect` handshake itself runs inside `OpenClawConnection`.
	 *
	 * Contract (the live handler, `infra/auth/auth.router.ts`): the response is
	 * `{ gatewayUrl, tenant, ingressHost }`. We prefer the explicit `gatewayUrl` and
	 * fall back to `wss://<ingressHost>` (the same fallback OpenCrane uses in
	 * the control plane's ingress-host-derived connection broker).
	 *
	 * SECURITY: under trusted-proxy gateway auth (CONN.9/CONN.10) the browser holds no
	 * credential — the identity-routing proxy authorises the socket against the OIDC
	 * session and injects the verified `X-Forwarded-User` — and any non-`wss://` URL
	 * is refused so the socket is never opened over cleartext.
	 *
	 * Failure handling keys off the broker's machine-readable `code` (a browser cannot
	 * read the status of a failed WS upgrade), not the bare HTTP status — the backend
	 * reuses 409 for two very different outcomes:
	 *   - `POD_NOT_READY` → the tenant resolved but its pod is still being provisioned:
	 *     a *transient* `Provisioning` state the user can retry, never "ask an admin".
	 *   - `NO_TENANT` / `AMBIGUOUS_TENANT` (and 403) → no/ambiguous workspace for the
	 *     session email: a terminal `Refused` ("no workspace for this account").
	 * 401 is already redirected to login by the api-client middleware; 429 (rate limit)
	 * and other transport failures back off as `Closed`.
	 */
	private async _openAsync(): Promise<void>
	{
		try
		{
			const { data, error, response } = await this._api.client.POST("/auth/pod-token");
			if (!response.ok)
			{
				// 401 → the api-client 401 middleware has already redirected to login.
				// Otherwise classify by the error body's `code` (see _PodTokenFailureStatus).
				const code = (error as { code?: string } | undefined)?.code;
				this._status.set(_PodTokenFailureStatus(response.status, code));
				return;
			}
			const broker = data as unknown as PodConnectionResponse | undefined;
			const url = typeof broker?.gatewayUrl === "string" && broker.gatewayUrl.length > 0
				? broker.gatewayUrl
				: broker?.ingressHost ? `wss://${broker.ingressHost}` : undefined;
			if (!url || !_IsSecureGatewayUrl(url))
			{
				this._status.set(ConnectionStatus.Closed);
				return;
			}
			// Trusted-proxy (CONN.9/CONN.10): the proxy authorises the socket and injects
			// the verified identity, so the browser presents no token and signs nothing.
			this._conn.connect({ url });
		}
		catch
		{
			// The broker itself was unreachable (network). While we still intend to be
			// connected, treat it as a transient drop and keep retrying with backoff.
			if (this._wantOpen)
			{
				this._status.set(ConnectionStatus.Reconnecting);
				this._scheduleReconnect();
			}
			else
			{
				this._status.set(ConnectionStatus.Closed);
			}
		}
	}

	/** Socket opened — mark live, subscribe to the session stream, backfill history. */
	private _onOpen(): void
	{
		this._deliberateClose = false;
		this._reconnectAttempts = 0;
		this._clearReconnectTimer();
		this._status.set(ConnectionStatus.Open);
		// Enumerate sessions for the sidebar as soon as the socket is live (drives the
		// `sessions` signal); independent of whether a thread is open.
		void this._refreshSessions();
		// A bare enumeration connection (ensureConnected, no thread) has nothing to
		// subscribe to or backfill — only wire the transcript stream for a real thread.
		if (this._threadId)
		{
			// `sessions.messages.subscribe` toggles transcript/message events for one
			// session; `key` is the session key (logs-chat.ts / sessions.ts).
			this._conn.send("sessions.messages.subscribe", { key: this._threadId });
			void this.history();
		}
	}

	/**
	 * Socket closed. A deliberate close (thread switch) settles to `Closed`; an
	 * unexpected drop while we still intend to be connected flips to `Reconnecting`
	 * and schedules a backed-off retry (keeping the transcript on screen).
	 */
	private _onClose(): void
	{
		this._turnActive = false;
		this._typing.set(false);
		this._operation.set(null);
		if (this._deliberateClose)
		{
			// Our own close during a thread switch — `open()` has already set the new
			// Connecting state, so leave status alone rather than flashing Closed.
			this._deliberateClose = false;
			return;
		}
		if (this._wantOpen)
		{
			this._status.set(ConnectionStatus.Reconnecting);
			this._scheduleReconnect();
			return;
		}
		this._status.set(ConnectionStatus.Closed);
	}

	/** Schedule a backed-off reconnect for the open thread. */
	private _scheduleReconnect(): void
	{
		this._clearReconnectTimer();
		const delay = _ReconnectDelayMs(this._reconnectAttempts++);
		this._reconnectTimer = setTimeout(() =>
		{
			this._reconnectTimer = null;
			if (this._wantOpen && this._threadId)
			{
				void this._openAsync();
			}
		}, delay);
	}

	/** Cancel any pending reconnect timer. */
	private _clearReconnectTimer(): void
	{
		if (this._reconnectTimer !== null)
		{
			clearTimeout(this._reconnectTimer);
			this._reconnectTimer = null;
		}
	}

	/**
	 * Route a validated event frame. `chat` carries streaming assistant output;
	 * `session.tool` carries tool-call activity. Other families
	 * (presence/tick/health/session.message/…) are ignored for now but no longer
	 * dropped as invalid (the envelope accepts any `event`).
	 */
	private _onEvent(frame: EventFrame): void
	{
		if (frame.event === "chat")
		{
			const ev = _DecodeChatEvent(frame.payload);
			if (ev)
			{
				this._applyChatEvent(ev);
			}
		}
		else if (frame.event === "session.tool")
		{
			const ev = _DecodeSessionTool(frame.payload);
			if (ev)
			{
				this._applyToolEvent(ev);
			}
		}
		else if (frame.event === GATEWAY_OPERATION_EVENT)
		{
			this._applyOperationEvent(frame.payload);
		}
		else if (frame.event === GATEWAY_SHUTDOWN_EVENT)
		{
			// The pod is going away (redeploy / idle-suspend). Flip to Reconnecting
			// proactively; the socket close that follows schedules the retry.
			this._applyShutdownEvent();
		}
		else if (frame.event === GATEWAY_HEALTH_EVENT)
		{
			this._applyHealthEvent(frame.payload);
		}
		else if (frame.event === GATEWAY_HEARTBEAT_EVENT)
		{
			// Liveness ping — consumed (not dropped as invalid); the socket's own
			// close event is what drives reconnect, so no watchdog is needed here.
		}
	}

	/** Surface a `session.operation` event as the inline operation-status line. */
	private _applyOperationEvent(payload: unknown): void
	{
		const ev = _DecodeSessionOperation(payload);
		if (!ev)
		{
			return;
		}
		if (_OperationIsTerminal(ev))
		{
			this._operation.set(null);
			return;
		}
		this._operation.set(_OperationLabel(ev) ?? null);
	}

	/** React to a pod `shutdown` event — mark reconnecting ahead of the socket close. */
	private _applyShutdownEvent(): void
	{
		if (this._wantOpen)
		{
			this._operation.set(null);
			this._status.set(ConnectionStatus.Reconnecting);
		}
	}

	/** React to a `health` event — a not-ok snapshot clears any stale operation line. */
	private _applyHealthEvent(payload: unknown): void
	{
		const ev = _DecodeHealth(payload);
		if (ev && ev.ok === false)
		{
			this._operation.set(null);
		}
	}

	/** Log validation failures without crashing the stream. */
	private _onInvalid(raw: unknown, reason: string): void
	{
		this._errorHandler.handleError(new Error(`OpenClaw gateway dropped an invalid frame: ${reason}`, { cause: raw }));
	}

	/**
	 * Fold a `chat` event into the assistant message.
	 *
	 * Handles both live shapes via the {@link _ChatEventText}/… readers: the v2026.x
	 * cumulative `message` object (`content[].text`, closed by `stopReason`) and the
	 * legacy flat `deltaText`/string-`message` stream (closed by `done`/`final`). The
	 * turn is keyed by `messageId`/`runId`/`idempotencyKey` so streamed chunks of one
	 * run coalesce into a single assistant bubble.
	 */
	private _applyChatEvent(ev: ChatEvent): void
	{
		const role = _ChatEventRole(ev);
		if (role === "user" || role === "toolResult" || role === "tool")
		{
			// A tool RESULT arrives in its OWN message (OpenClaw: role "toolResult" with a
			// toolCallId; some providers: role "tool"/"user" with tool_result parts). Fold it into
			// the in-flight assistant's matching tool card rather than rendering a bubble. A plain
			// user frame with no results is an echo of our own send (already covered optimistically).
			const results = _ChatEventToolResults(ev);
			if (results.length > 0)
			{
				this._applyToolResults(results);
			}
			return;
		}
		const id = _ChatEventId(ev) ?? this._currentAssistantId ?? this._newLocalId("a");
		this._localIds.add(id);
		this._currentAssistantId = id;
		const done = _ChatEventDone(ev);
		if (done)
		{
			this._turnActive = false;
		}
		// Typing shows only while a turn is genuinely in flight: a stray non-`done`
		// frame after the turn has closed (`_turnActive` false) can't re-open it.
		this._typing.set(this._turnActive && !done);
		// Only a closed turn carries a delivery outcome (Truncated/Error); a clean
		// stop leaves it undefined so no badge shows.
		const delivery = done ? _ChatEventDelivery(ev) : undefined;
		this._upsertAssistant(id, ev, delivery);
		if (done)
		{
			this._currentAssistantId = null;
			this._persist();
		}
	}

	/**
	 * Insert or update assistant message `id` from a chat event, folding its
	 * reasoning ("thinking"), tool calls, and prose into an ordered card stack (see
	 * {@link _BuildAssistantCards}). A cumulative snapshot rebuilds the stack; a
	 * legacy delta appends to the prose.
	 */
	private _upsertAssistant(id: string, ev: ChatEvent, delivery?: MessageDelivery): void
	{
		const now = this._now();
		const update = {
			text: _ChatEventText(ev),
			thinking: _ChatEventThinking(ev),
			tools: _ChatEventTools(ev),
			toolResults: _ChatEventToolResults(ev),
			attachments: _ChatEventAttachments(ev),
			isSnapshot: _ChatEventIsSnapshot(ev)
		};
		this._messages.update(function apply(current: ThreadMessage[]): ThreadMessage[]
		{
			const index = current.findIndex(function byId(message: ThreadMessage): boolean
			{
				return message.id === id;
			});
			const existing = index >= 0 ? current[index] : null;
			const cards = _BuildAssistantCards(existing?.cards ?? [], update);
			const next: ThreadMessage = { id, role: "assistant", time: existing?.time ?? now, cards, ...(delivery ? { delivery } : existing?.delivery ? { delivery: existing.delivery } : {}) };
			if (index >= 0)
			{
				const copy = [...current];
				copy[index] = next;
				return copy;
			}
			return [...current, next];
		});
	}

	/** Surface a `session.tool` event as a tool chip on the current assistant message. */
	private _applyToolEvent(ev: SessionToolEvent): void
	{
		const name = ev.name ?? ev.tool;
		if (!name)
		{
			return;
		}
		const id = this._currentAssistantId ?? this._newLocalId("a");
		this._localIds.add(id);
		this._currentAssistantId = id;
		const status = ev.status;
		this._messages.update(function apply(current: ThreadMessage[]): ThreadMessage[]
		{
			const index = current.findIndex(function byId(message: ThreadMessage): boolean
			{
				return message.id === id;
			});
			if (index < 0)
			{
				return [...current, { id, role: "assistant", time: "", cards: [{ type: MessageCardKind.Tool, label: name, status }] }];
			}
			const existing = current[index];
			const copy = [...current];
			copy[index] = { ...existing, cards: _MergeToolCard(existing.cards, name, status) };
			return copy;
		});
	}

	/**
	 * Fold tool RESULTS (arriving in their own toolResult/tool frame) into the tool card that
	 * carries the matching call-id — searched across ALL messages, not just the in-flight one, so a
	 * result still pairs with its call when the agent batched several calls into earlier messages
	 * before their results (see {@link _LocateToolResultTarget}). An id-less result (or one whose
	 * call has not been seen) falls back to the current assistant message.
	 */
	private _applyToolResults(results: ReturnType<typeof _ChatEventToolResults>): void
	{
		if (results.length === 0)
		{
			return;
		}
		const currentId = this._currentAssistantId;
		this._messages.update(function apply(current: ThreadMessage[]): ThreadMessage[]
		{
			const copy = [...current];
			const fallback = currentId ? copy.findIndex((message) => message.id === currentId) : -1;
			for (const result of results)
			{
				const target = _LocateToolResultTarget(copy, [result], fallback);
				if (target >= 0)
				{
					copy[target] = { ...copy[target], cards: _MergeToolResults(copy[target].cards, [result]) };
				}
			}
			return copy;
		});
	}

	/** Minimal thread metadata until the pod supplies it. */
	private _buildThread(threadId: string): ThreadData
	{
		const tenant = this._session.currentTenant();
		return {
			title: threadId || "session",
			synced: this._status() === ConnectionStatus.Open,
			pod: tenant?.name ?? "—",
			dept: tenant?.email ?? "",
			deptColor: "#7A6AA0",
			contractVersion: "v2.3.1",
			messages: []
		};
	}

	/**
	 * Map a `chat.history` row onto a thread message.
	 *
	 * Assistant rows carry `content` as the SAME typed-parts array a live `chat`
	 * event does — reading it as a string dropped every assistant reply from
	 * history (blank bubbles). {@link _HistoryRowContent} decodes it through the
	 * shared readers, and assistant rows are rebuilt with the same reasoning/tool/
	 * prose card stack as the live path so history and live render identically.
	 */
	private _mapHistoryRow(row: HistoryMessage, index: number): ThreadMessage
	{
		return this._buildHistoryRow(row, index).message;
	}

	/**
	 * Map a history row to a message AND classify it for cross-row folding: a row that carries
	 * only tool RESULTS (no call/prose/media) is a carrier whose output belongs to a `tool_use`
	 * in an earlier assistant row (see {@link _FoldHistoryToolResults}). Openclaw emits the call
	 * and the result in separate messages, so the fold re-unites them.
	 */
	private _buildHistoryRow(row: HistoryMessage, index: number): HistoryBuilt
	{
		const id = row.id ?? `h-${index}`;
		const time = this._formatTime(row.createdAt ?? (row as { timestamp?: unknown }).timestamp);
		const { text, thinking, tools, toolResults, attachments } = _HistoryRowContent(row);
		const isUserTurn = row.role === "user" && toolResults.length === 0;
		const isCarrier = toolResults.length > 0 && tools.length === 0 && !text.trim() && attachments.length === 0;
		const message: ThreadMessage = isUserTurn
			? { id, role: "user", time, cards: [{ type: MessageCardKind.Text, content: text }] }
			: { id, role: "assistant", time, cards: _BuildAssistantCards([], { text, thinking, tools, toolResults, attachments, isSnapshot: true }) };
		return { message, toolResults, isCarrier };
	}

	/** Format a row timestamp (epoch ms or ISO string) as HH:mm, falling back to now. */
	private _formatTime(createdAt: unknown): string
	{
		const ms = typeof createdAt === "number"
			? createdAt
			: typeof createdAt === "string" ? Date.parse(createdAt) : Number.NaN;
		const date = Number.isNaN(ms) ? new Date() : new Date(ms);
		return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	}

	/** Current wall-clock time as HH:mm. */
	private _now(): string
	{
		return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	}
}
