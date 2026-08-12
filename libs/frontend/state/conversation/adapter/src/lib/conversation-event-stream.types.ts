import type { AgUiStreamState } from "@opencrane/state/conversation/ag-ui";

/**
 * Where the stream is in its connect/reconnect loop.
 *
 * `Reconnecting` is routine and expected — the server ends each response after a while, so a
 * healthy stream cycles Live → Reconnecting → Live. Do not show it as an error. `Failed` is the
 * only terminal failure; `Aborted` means the caller stopped it deliberately.
 */
export enum ConversationEventStreamStatuses
{
	/** The first cookie-authenticated request is being opened. */
	Connecting = "connecting",
	/** Incremental SSE bytes are currently being consumed. */
	Live = "live",
	/** A bounded server response ended or a transient request failed and will resume. */
	Reconnecting = "reconnecting",
	/** The caller aborted the stream. */
	Aborted = "aborted",
	/** The stream failed closed after its bounded retry allowance. */
	Failed = "failed",
}

/** One progress report from the stream, passed to `onUpdate`. */
export interface ConversationEventStreamUpdate
{
	/** Current connection phase. */
	readonly status: ConversationEventStreamStatuses;
	/** The stream state as of this update; render from this. */
	readonly state: AgUiStreamState;
	/** Consecutive reconnect attempt, starting at zero for the initial connection. */
	readonly reconnectAttempt: number;
	/** Browser time of the latest server heartbeat. */
	readonly lastHeartbeatAt: number | null;
	/** Failure message, set only on the final Failed update; safe to show to the user. */
	readonly error?: string;
}

/**
 * What to pass to {@link ConversationEventStream.stream}.
 *
 * `conversationId` and `signal` are required; everything else has a default. Aborting the signal is
 * the only way to stop the stream cleanly. To resume a stream the browser has already read, pass
 * the state it returned as `initialState` — that is what carries the cursor.
 */
export interface StreamConversationEventsCommand
{
	/** Conversation id; treat it as an opaque string. */
	readonly conversationId: string;
	/** Abort this to stop the stream; it is the only clean way to end it. */
	readonly signal: AbortSignal;
	/** State from an earlier run of this stream, to resume from. Its cursor is what avoids replaying old events. */
	readonly initialState?: AgUiStreamState;
	/** Called on every phase change, heartbeat and accepted event. Without it the caller sees nothing until the stream ends. */
	readonly onUpdate?: (update: ConversationEventStreamUpdate) => void;
	/** How many failures in a row before the stream gives up and throws. Defaults to 3. Reset whenever a response delivers an event. */
	readonly maximumReconnectAttempts?: number;
	/** Milliseconds to wait before reconnecting. Defaults to 250. */
	readonly reconnectDelayMilliseconds?: number;
}

/**
 * Reads one conversation's live event stream for the signed-in user.
 *
 * The only port a UI needs for live conversation state. It handles connecting, resuming after a
 * dropped connection, and folding events into {@link AgUiStreamState}; the caller supplies an
 * AbortSignal and, if it wants progress, an `onUpdate` callback.
 *
 * @see OpenCraneConversationEventStream
 * @see AG-UI protocol docs — the events carried on the stream: https://docs.ag-ui.com
 */
export interface ConversationEventStream
{
	/**
	 * Streams the conversation until the caller aborts, or until it gives up.
	 *
	 * Runs a reconnect loop. It reconnects on a retryable HTTP status, resuming from the cursor in
	 * the state so far, and resets the attempt counter whenever a response delivered at least one
	 * event. It stops for good, by throwing, when the stream contradicts itself, when the status is
	 * not retryable, when access is revoked, or after `maximumReconnectAttempts` consecutive
	 * failures. A 404 is treated as access loss, not a missing resource.
	 *
	 * Progress arrives through `command.onUpdate`, which is called on every phase change and every
	 * accepted event — a caller that only awaits the promise sees nothing until the very end.
	 *
	 * Called by: no production caller yet; exercised by
	 * opencrane-conversation-event-stream.spec.ts.
	 *
	 * @param command - Which conversation to read, the abort signal, optional prior state to resume
	 *   from, and the optional progress callback.
	 * @returns The final state once the caller aborts. This is the value to keep and pass back as
	 *   `initialState` to resume later.
	 * @throws Error when access to the conversation is revoked; the returned state is cleared.
	 * @throws _ConversationEventProtocolError when the framing or event data is invalid — do not
	 *   retry this.
	 * @throws _ConversationEventHttpError when the status is not retryable, or after the reconnect
	 *   allowance runs out.
	 */
	stream(command: StreamConversationEventsCommand): Promise<AgUiStreamState>;
}
