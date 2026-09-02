import type { AgUiStreamState } from "@opencrane/state/conversation/ag-ui";
import type { ConversationModes } from "@opencrane/models/conversations";

/**
 * Reports where a conversation stream is in its lifecycle so browser state can distinguish a
 * temporary interruption from a terminal outcome.
 *
 * Implementations send these values through `StreamConversationEventsCommand.onUpdate`; they are
 * not stored or sent to the server. `Reconnecting` keeps the last accepted state usable, while
 * `Failed` and `Aborted` end the stream. Implementations must not emit values outside this closed
 * set because workspace presenters branch on each lifecycle state.
 */
export enum ConversationEventStreamStatuses
{
	/** The implementation is opening its first update channel; no live update has arrived yet. */
	Connecting = "connecting",
	/** The implementation is accepting validated updates and may continue changing the projection. */
	Live = "live",
	/** The update channel ended or failed temporarily; the caller keeps the last accepted state while the implementation resumes. */
	Reconnecting = "reconnecting",
	/** The caller aborted the stream; this is a successful terminal outcome and no more updates follow. */
	Aborted = "aborted",
	/** The implementation cannot continue; this is a terminal failure and `error` may hold display-safe detail. */
	Failed = "failed",
}

/**
 * Carries one lifecycle report with the last state the implementation accepted.
 *
 * Workspace state adopts these reports while `stream()` is pending, so an implementation must
 * keep the last valid projection when it reports reconnecting or failed rather than replacing it
 * with partially decoded data.
 */
export interface ConversationEventStreamUpdate
{
	/** Current connection phase. */
	readonly status: ConversationEventStreamStatuses;
	/** The last stream state that passed validation. */
	readonly state: AgUiStreamState;
	/** Consecutive reconnect attempt, starting at zero. */
	readonly reconnectAttempt: number;
	/** Browser time of the latest server heartbeat. */
	readonly lastHeartbeatAt: number | null;
	/** Display-safe failure message set only for the failed phase. */
	readonly error?: string;
}

/**
 * Supplies the conversation, cancellation, resume, retry, and observation inputs for one stream.
 *
 * The caller owns the abort signal and must abort it when the selected conversation or screen
 * lifetime changes. Passing `initialState` lets an implementation resume from the cursor that state
 * contains instead of replaying updates the browser already accepted.
 */
export interface StreamConversationEventsCommand
{
	/** Opaque conversation identifier. */
	readonly conversationId: string;
	/** Stops the stream when aborted. */
	readonly signal: AbortSignal;
	/** State from an earlier connection, including its resume cursor. */
	readonly initialState?: AgUiStreamState;
	/** Receives every phase change, heartbeat, and accepted event. */
	readonly onUpdate?: (update: ConversationEventStreamUpdate) => void;
	/** Consecutive failures allowed before the stream gives up; defaults to three. */
	readonly maximumReconnectAttempts?: number;
	/** Delay before reconnecting in milliseconds; defaults to 250. */
	readonly reconnectDelayMilliseconds?: number;
}

/** Carries one participant message through the transport already selected for its conversation. */
export interface SubmitConversationEventStreamMessageCommand
{
	/** Conversation selected by the active event stream. */
	readonly conversationId: string;
	/** Chooses the mode-owned public command frame without trusting a server-side default. */
	readonly mode: ConversationModes;
	/** Retry key the server uses to deduplicate uncertain submissions. */
	readonly idempotencyKey: string;
	/** Display-safe participant blocks retained unchanged for an exact retry. */
	readonly blocks: readonly { readonly id: string; readonly kind: string; readonly value: string }[];
}

/**
 * Reads one signed-in participant's conversation updates without prescribing a transport.
 *
 * Workspace state depends on this port so production and test adapters share the same lifecycle,
 * resume, and cancellation contract. The port grants no conversation access; a production adapter
 * must use the signed-in context supplied by its own boundary.
 *
 * Called by: `ConversationWorkspaceStore` through `CONVERSATION_WORKSPACE_EVENT_STREAM`. Implemented
 * by `OpenCraneConversationEventStream` in the browser app and by focused workspace test doubles.
 */
export interface ConversationEventStream
{
	/**
	 * Streams until the caller aborts or the implementation fails closed.
	 *
	 * Progress arrives through `command.onUpdate` while this promise is pending. A caller abort
	 * returns the last accepted state; an implementation failure first reports `Failed` and then
	 * rejects, leaving the last accepted state in that update.
	 *
	 * @param command - Conversation, cancellation, resume, retry, and observation inputs.
	 * @returns The last accepted state after the caller stops the stream.
	 * @throws Error when the implementation cannot continue without the caller changing something.
	 */
	stream(command: StreamConversationEventsCommand): Promise<AgUiStreamState>;
	/**
	 * Submits a participant message through the selected conversation's live transport.
	 *
	 * @param command - The selected conversation and retry-stable participant blocks.
	 * @returns A promise fulfilled only after the server acknowledges admission or replay.
	 * @throws ConversationEventStreamMessageError when the stream cannot safely submit the command.
	 */
	submit(command: SubmitConversationEventStreamMessageCommand): Promise<void>;
}
