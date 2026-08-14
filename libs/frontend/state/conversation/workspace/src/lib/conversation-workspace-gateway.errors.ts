/**
 * Why a workspace read or command failed, said in the only terms the browser is allowed to know.
 *
 * The adapter never hands a server response body to the UI, so this kind is all a store has to
 * decide what to do next. Each value asks for a different reaction: `AccessChanged` means stop and
 * throw the local copy away, `Conflict` means re-read before the participant tries again,
 * `Recoverable` means resend the same request with the same idempotency key, and `Unavailable` means
 * nothing is known, so show the failure and change nothing.
 *
 * `ConversationWorkspaceStore._HandleFailure` is the only place that branches on a member today; it
 * looks for `AccessChanged` and treats every other kind as "show the message". `ConversationRunStore`
 * reads only the message. Nothing persists these values and nothing sends them to the server, so the
 * string values are private to the browser and can be renamed without a migration or an API change.
 *
 * The set is closed in practice: values are only ever built by `_Failure` and `_InvalidResponse` in
 * `OpenCraneConversationWorkspaceGateway`, and `_Failure` maps every status it does not recognise to
 * `Unavailable`, so an unmapped HTTP status cannot leak through as an unknown kind.
 */
export enum ConversationWorkspaceGatewayErrorKinds
{
	/**
	 * The server answered 401, 403, or 404 for a conversation this participant could reach before,
	 * so the session ended or membership was withdrawn. Sending the same request again will fail the
	 * same way. A caller must stop treating the conversation as its own: when the conversation was
	 * already on screen, `ConversationWorkspaceStore` purges the snapshot, the stream, the draft, and
	 * the run state and moves the route to `AccessChanged`; when it was never visible, the route goes
	 * to `Unavailable` instead. Terminal for that conversation until the participant signs in again.
	 */
	AccessChanged = "access_changed",
	/**
	 * The server answered 409, so newer authoritative state already exists — usually the
	 * `expectedAttempt` sent with a cancel or retry no longer matches the run's current attempt.
	 * Resending the same command unchanged will be refused again, so the caller must re-read the
	 * conversation or run and let the participant decide against the newer state.
	 */
	Conflict = "conflict",
	/**
	 * The request timed out, was rate-limited, hit a 5xx, or came back in a shape the response
	 * validator rejected. The server may or may not have applied the command, so the caller must
	 * resend it with the *same* idempotency key rather than a fresh one — this is the case
	 * `ConversationRunStore._PendingSteeringCommand` keeps a command around for.
	 */
	Recoverable = "recoverable",
	/**
	 * The failure carried no status the adapter recognises, including the case where there was no
	 * HTTP response at all and the request never reached the server. Nothing is known about whether
	 * the command applied, so a caller must not silently retry it and must not conclude that access
	 * changed; show the failure and let the participant choose.
	 */
	Unavailable = "unavailable"
}

/**
 * A workspace gateway failure whose `message` is already written for a participant to read.
 *
 * The adapter builds one of these instead of letting a transport error through, so no server
 * response body, status line, or stack detail reaches the UI. That is why both stores use
 * `error.message` directly as on-screen copy and fall back to their own wording for anything that is
 * not this class: `ConversationWorkspaceStore._Message` and `ConversationRunStore._Message`.
 *
 * Called by: `_Failure` and `_InvalidResponse` in `OpenCraneConversationWorkspaceGateway`
 * (`state/conversation/workspace/adapter`), which every method of that gateway throws through.
 * @see ConversationWorkspaceGatewayErrorKinds for what a caller must do per kind.
 */
export class ConversationWorkspaceGatewayError extends Error
{
	/** Which reaction this failure calls for. Branch on this, never on the message text. */
	public readonly kind: ConversationWorkspaceGatewayErrorKinds;

	/**
	 * Builds a failure the UI can show as it stands.
	 *
	 * @param kind - The reaction this failure calls for.
	 * @param message - Copy written for a participant. It is rendered as given, so it must not
	 *   contain a server response body, an identifier, or any other detail the browser should not see.
	 */
	public constructor(kind: ConversationWorkspaceGatewayErrorKinds, message: string)
	{
		super(message);
		// A class extending Error inherits the name "Error", so set it here to make this class
		// recognisable in logs and in anything that reads `error.name`.
		this.name = "ConversationWorkspaceGatewayError";
		this.kind = kind;
	}
}
