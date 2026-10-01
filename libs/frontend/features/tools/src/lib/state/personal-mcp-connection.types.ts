import type { McpConnectionCredentialKinds } from "@opencrane/contracts";

import type { ToolConnectionCoordinate } from "./tools-inventory.types";

/**
 * Selects the browser command retained for an identical retry.
 *
 * These values exist only in route-scoped state. They are never persisted or sent over the API.
 */
export enum PersonalMcpConnectionOperations
{
	/** The attempt creates or replaces the current personal connection generation. */
	Activate = "activate",
	/** The attempt revokes the current personal connection generation. */
	Revoke = "revoke"
}

/** Coordinates one admitted browser command until it resolves or becomes stale. */
export interface PersonalMcpConnectionAttempt
{
	/** Command path that must be repeated after an uncertain response. */
	readonly operation: PersonalMcpConnectionOperations;
	/** Opaque request key reused only for this identical command. */
	readonly idempotencyKey: string;
	/** Credential shape frozen when activation first starts. */
	readonly credentialKind: McpConnectionCredentialKinds;
	/** Server-owned installation coordinates observed before the command. */
	readonly coordinate: ToolConnectionCoordinate;
	/** Whether transport failed without proving the command was rejected. */
	readonly ambiguous: boolean;
}

/** Route-scoped private state for one installed server connection control. */
export interface PersonalMcpConnectionTargetState
{
	/** Ephemeral write-only bearer value; empty for credentialless and revoke commands. */
	readonly draft: string;
	/** Whether the user deliberately opened a fresh replacement form. */
	readonly replacing: boolean;
	/** Exact command coordinates retained through an ambiguous result. */
	readonly attempt: PersonalMcpConnectionAttempt | null;
	/** Fixed browser-safe command failure text. */
	readonly error: string | null;
}
