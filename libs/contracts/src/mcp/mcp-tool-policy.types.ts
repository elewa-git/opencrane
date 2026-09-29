/** Selects one closed serialized policy value; the mode never grants IAM authority. */
export enum McpToolPolicyModes
{
	/** Permit eligible calls, including the first eligible write, without an approval pause. */
	Auto = "auto",
	/** Pause eligible calls for the existing approval workflow. */
	Ask = "ask",
	/** Refuse eligible calls before workload creation. */
	Block = "block",
}

/** Identifies one exact installed server and immutable tool revision without duplicating authority. */
export interface McpToolPolicyTarget
{
	/** The installed MCP server row whose owner and silo are resolved by the server. */
	installId: string;
	/** The immutable published tool revision governed by this policy. */
	toolRevisionId: string;
}

/** Requests one optimistic, idempotent policy change for an exact installed tool revision. */
export interface McpToolPolicyChangeCommand
{
	/** The server-resolved install and immutable tool revision coordinate. */
	target: McpToolPolicyTarget;
	/** The requested execution preference; omitted policy is never silently accepted as another mode. */
	mode: McpToolPolicyModes;
	/** The UUID used to replay the same command safely after an uncertain response. */
	idempotencyKey: string;
	/** The observed policy revision, or null when the caller expects no saved policy yet. */
	expectedRevision: number | null;
}

/** Reports the current policy projection for one exact installed tool revision. */
export interface McpToolPolicyProjection
{
	/** The server-resolved install and immutable tool revision coordinate. */
	target: McpToolPolicyTarget;
	/** The saved execution preference; an absent policy is represented only by Ask. */
	mode: McpToolPolicyModes;
	/** The positive saved policy revision, or null only for the absent Ask projection. */
	revision: number | null;
	/** The saved update timestamp, or null only for the absent Ask projection. */
	updatedAt: string | null;
}

/** Selects one closed serialized result value without inventing actor evidence or authority. */
export enum McpToolPolicyChangeOutcomes
{
	/** The command was admitted and produced the returned projection. */
	Admitted = "admitted",
	/** The same command key was already applied and its prior projection is returned. */
	Replayed = "replayed",
	/** The expected revision did not match; no projection is claimed by this result. */
	Conflict = "conflict",
	/** Server-owned authority denied the change; no projection is claimed by this result. */
	Denied = "denied",
}

/** Returns persisted policy evidence only for an admitted or replayed command. */
export interface McpToolPolicyChangeResult
{
	/** The flat durable command outcome. */
	outcome: McpToolPolicyChangeOutcomes;
	/** The saved projection for admitted/replayed outcomes, otherwise null. */
	projection: McpToolPolicyProjection | null;
}
