/**
 * Chooses which read feedback and retained data a reporting component may render.
 *
 * These closed states live in browser memory, not in an API or database. Reporting mappers supply
 * them to the audit, usage and budget views. They describe a read result and never grant access;
 * unknown values must hide data until the owning store supplies a supported state.
 */
export enum GovernanceReadStates
{
	/** The first read is pending; no previous values may be shown. */
	Loading = "loading",
	/** The latest read succeeded; an empty response does not prove there are no hidden records. */
	Ready = "ready",
	/** A new read is pending while previously returned values remain visible. */
	Refreshing = "refreshing",
	/** No usable response exists; the user may request another read. */
	Unavailable = "unavailable",
	/** A refresh failed; retained values must be labelled as potentially out of date. */
	RetainedError = "retained-error",
	/** The server refused this read; even supplied stale values must disappear. */
	Forbidden = "forbidden",
	/** No current authenticated session is available; hide values and ask the user to sign in again. */
	Unauthenticated = "unauthenticated"
}

/** Supplies display-safe read feedback without transport errors or authorization decisions. */
export interface GovernanceReadFeedback
{
	/** Selects the supported read state that the mapper has adopted. */
	readonly state: GovernanceReadStates;
	/** Gives a display-safe explanation when a read failed, without private diagnostics. */
	readonly error: string | null;
}
