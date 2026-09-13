/**
 * Selects whether the connection control renders a write-only bearer field.
 *
 * The tools presentation mapper creates this value; it is never stored or sent to the server.
 * Called by: `PersonalMcpConnectionControlComponent` and its tools-page presenter.
 */
export enum PersonalMcpCredentialInputKinds
{
	/** The connection command carries no credential and therefore renders no secret field. */
	None = "none",
	/** The connection command needs a bearer value that the browser may submit but never read back. */
	Bearer = "bearer"
}

/**
 * Selects one finite interaction state for the personal MCP connection control.
 *
 * The tools presentation mapper derives this browser-only state from authoritative installation,
 * connection, and pending-command evidence. It is neither persisted nor sent over the API.
 * Called by: `PersonalMcpConnectionControlComponent` and its tools-page presenter.
 */
export enum PersonalMcpConnectionControlStates
{
	/** No usable generation exists and the user may start a connection command. */
	Connect = "connect",
	/** The server accepted activation and no second activation may start. */
	Activating = "activating",
	/** The current generation is usable and may be replaced or revoked when permitted. */
	Active = "active",
	/** The user deliberately opened a fresh write-only replacement command. */
	Replace = "replace",
	/** The current generation needs authorized revocation before another connection can start. */
	RecoveryRequired = "recovery-required",
	/** A write may have committed, so only the exact retained command may be retried. */
	Ambiguous = "ambiguous",
	/** Installation removal is settling and every connection action is unavailable. */
	Removing = "removing"
}

/**
 * Supplies browser-safe text and categorical state to one personal MCP connection control.
 *
 * `draft` is controlled write-only input owned by the parent store. `controlId` must be stable and
 * unique in the rendered page so helper and error text remain associated with the right field.
 * Called by: the tools-page presenter and `PersonalMcpConnectionControlComponent`.
 */
export interface PersonalMcpConnectionControlView
{
	/** Stable page-unique prefix for input, helper, and error associations. */
	controlId: string;
	/** Browser-safe server name used in visible copy and accessible labels. */
	serverName: string;
	/** Finite interaction state selected by the parent presenter. */
	state: PersonalMcpConnectionControlStates;
	/** Whether the current command needs a write-only access-token field. */
	credentialInput: PersonalMcpCredentialInputKinds;
	/** Controlled unsaved or exact-retry value held only by the parent store. */
	draft: string;
	/** Whether the active projection permits opening a fresh replacement form. */
	canReplace: boolean;
	/** Whether the current projection permits a disconnect command. */
	canRevoke: boolean;
	/** Fixed browser-safe lifecycle explanation, when the durable state needs one. */
	failureMessage: string | null;
}
