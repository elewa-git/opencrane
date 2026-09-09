/** Selects read feedback independently of the server's assistant-work lifecycle. */
export enum ConversationActivityReadStates
{
	/** The current read completed; an empty row list is authoritative. */
	Ready = "ready",
	/** The first read for this scope is pending and has no rows to display. */
	Loading = "loading",
	/** A read is pending while the last accepted same-scope rows remain visible. */
	Refreshing = "refreshing",
	/** The read failed; previous rows are removed and a read retry may be offered. */
	Error = "error",
}
