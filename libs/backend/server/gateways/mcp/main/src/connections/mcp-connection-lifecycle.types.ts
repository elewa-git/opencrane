import { McpConnectionStates } from "./mcp-connection.types";

/** Commands that can move a durable connection generation between lifecycle states. */
export enum McpConnectionLifecycleEvents
{
	/** Exact credential custody committed. */
	CustodyBound = "custody-bound",
	/** Custody cannot be proved safe after a create or read attempt. */
	CustodyUncertain = "custody-uncertain",
	/** Authenticated discovery and its immutable revision committed. */
	DiscoveryCompleted = "discovery-completed",
	/** A definite authentication or protocol result rejected activation. */
	DiscoveryFailed = "discovery-failed",
	/** Current authority admitted revocation before cleanup. */
	Revoke = "revoke",
}

/** Result of applying one lifecycle event to a stored generation. */
export enum McpConnectionLifecycleActions
{
	/** Move to the table's target state. */
	Advance = "advance",
	/** The stored winner already reflects this event. */
	NoOp = "no-op",
	/** This event conflicts with the stored winner. */
	Deny = "deny",
}

/** One exhaustive lifecycle table decision. */
export interface McpConnectionLifecycleDecision
{
	/** Whether persistence advances, returns the saved winner, or rejects the event. */
	readonly action: McpConnectionLifecycleActions;
	/** Stored state after an accepted or already-applied event. */
	readonly state: McpConnectionStates;
}
