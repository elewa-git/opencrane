import type { McpInstallStates } from "@opencrane/contracts";

/** Internal planning events for a retained MCP installation; these values are not stored or sent. */
export enum McpInstallLifecycleEvents
{
	/** The personal owner requested removal when no generation exists. */
	UninstallWithoutConnection = "uninstall-without-connection",
	/** The personal owner requested removal while a retained generation exists. */
	UninstallWithConnection = "uninstall-with-connection",
	/** Every retained connection generation finished execution and Secret cleanup. */
	CleanupCompleted = "cleanup-completed",
	/** The personal owner explicitly installed the retained server again. */
	Reinstall = "reinstall",
}

/** Internal planning actions for install events; these values are not stored or sent. */
export enum McpInstallLifecycleActions
{
	/** Persist the target state selected by the lifecycle table. */
	Advance = "advance",
	/** The stored state already represents this event's durable outcome. */
	NoOp = "no-op",
	/** The event cannot run from the stored state. */
	Deny = "deny",
}

/** Exhaustive decision for one stored install state and event. */
export interface McpInstallLifecycleDecision
{
	/** Whether persistence advances, returns the saved winner, or rejects the event. */
	readonly action: McpInstallLifecycleActions;
	/** Stored lifecycle after an accepted or already-applied event. */
	readonly state: McpInstallStates;
}
