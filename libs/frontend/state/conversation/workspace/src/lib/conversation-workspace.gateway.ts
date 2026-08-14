import { InjectionToken } from "@angular/core";

import type { ConversationEventStream } from "@opencrane/state/conversation/stream";

import type { ConversationWorkspaceGateway } from "./conversation-workspace.types";

/**
 * Port for every conversation read and command the workspace makes for the signed-in participant.
 *
 * Inject this rather than an HTTP client. The stores in this package are not allowed to depend on a
 * concrete adapter, so they only ever see the {@link ConversationWorkspaceGateway} methods and the
 * one error type described below; an app binds the token to a real implementation at startup.
 *
 * An implementation owes the callers three things that the method signatures do not state:
 *
 * 1. Check the server payload against the workspace models before returning it, using the
 *    validators this package exports (`_ParseConversationDetail` and its siblings). Both stores
 *    assign a returned value straight into a signal, so whatever the port hands back is treated as
 *    already checked and is rendered as-is.
 * 2. Throw `ConversationWorkspaceGatewayError` and nothing else. Both stores test the failure with
 *    `instanceof` and show `error.message` to the participant; any other error type falls back to a
 *    generic sentence and the store can no longer tell access loss apart from a conflict.
 * 3. Leave the HTTP status code and the response body out of that error. The `message` is displayed,
 *    so it holds display copy only, and the status is reduced to a
 *    `ConversationWorkspaceGatewayErrorKinds` value instead.
 *
 * The kind chosen for a failure decides what the store does next, so the wrong kind is a visible
 * bug rather than a cosmetic one. `AccessChanged` on a conversation that was already on screen makes
 * `ConversationWorkspaceStore` clear the snapshot, the live stream state, run state and the draft
 * before the access-changed route appears; the same kind for a conversation the participant never
 * had open only lands on the unavailable route. `Conflict` and `Recoverable` leave the route alone and
 * just show the message, so the participant can try the same action again — which is why a payload the
 * validators reject is reported as `Recoverable` rather than as a hard failure.
 *
 * The token declares no factory, so an app that forgets the provider fails when a store is first
 * constructed instead of at the first request.
 *
 * Called by: `ConversationWorkspaceStore` for directory, list, open, create, send, archive and
 * close, and `ConversationRunStore` for run, steer, cancel and retry. Bound to the web app's
 * adapter in `provideConversationWorkspaceComposition`.
 *
 * @see ConversationWorkspaceGateway for what each method does and returns.
 * @see OpenCraneConversationWorkspaceGateway — the generated-client implementation the web app
 *   provides for this token.
 * @see ConversationWorkspaceGatewayError for the failure categories a caller branches on.
 */
export const CONVERSATION_WORKSPACE_GATEWAY = new InjectionToken<ConversationWorkspaceGateway>("CONVERSATION_WORKSPACE_GATEWAY");

/**
 * Port that reads the live event stream for whichever conversation is selected.
 *
 * This token binds the {@link ConversationEventStream} port owned by `conversation/stream`; the
 * workspace deliberately does not define a second stream contract, so a change to reconnect or
 * cursor behaviour is made once and every screen gets it.
 *
 * `ConversationWorkspaceStore` opens the bounded snapshot through
 * {@link CONVERSATION_WORKSPACE_GATEWAY} first, then starts this stream for the same conversation
 * and passes the state it already holds as `initialState`, because that state carries the cursor
 * that stops old events replaying. It also passes an `AbortSignal`, which is the only clean way to
 * stop a stream, and aborts it whenever the selection changes or the component is destroyed.
 *
 * Two outcomes matter to the caller, and an implementation must keep them apart. A `Reconnecting`
 * update is normal — the server ends each response after a while — so the store leaves the
 * conversation on screen. A thrown failure or a state with `accessRevoked` set is not: the store
 * clears the snapshot, run state and draft on revoked access, and on any other failure keeps the
 * last good snapshot visible and asks the participant to reopen the conversation.
 *
 * The token declares no factory, so an app that forgets the provider fails when the store is first
 * constructed instead of when a conversation is opened.
 *
 * Called by: `ConversationWorkspaceStore` only, from its `_StartStream` step after a snapshot loads.
 * Bound to the web app's adapter in `provideConversationWorkspaceComposition`.
 *
 * @see ConversationEventStream for the reconnect lifecycle and every field of the command and the
 *   progress update.
 * @see OpenCraneConversationEventStream — the implementation the web app provides for this token.
 */
export const CONVERSATION_WORKSPACE_EVENT_STREAM = new InjectionToken<ConversationEventStream>("CONVERSATION_WORKSPACE_EVENT_STREAM");
