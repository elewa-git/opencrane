import type { McpConnectionStatus } from "./mcp-operator.types";

/** Authentication material accepted only by the write-only MCP connection command. */
export enum McpConnectionCredentialKinds
{
	/** Activates a server explicitly registered as requiring no credential. */
	None = "none",
	/** Supplies one bearer token to the exact admitted immutable Secret generation. */
	Bearer = "bearer",
}

/** Safe failure categories that disclose neither provider responses nor credential coordinates. */
export enum McpConnectionFailureCodes
{
	/** Current membership, installation, service identity or permission no longer permits activation. */
	AuthorityEnded = "authority-ended",
	/** The registered endpoint no longer matches the admitted command. */
	EndpointChanged = "endpoint-changed",
	/** The expected immutable Secret conflicts with the observed object. */
	CredentialConflict = "credential-conflict",
	/** The expected credential could not be established or read safely. */
	CredentialUnavailable = "credential-unavailable",
	/** The server did not accept the admitted authentication material. */
	AuthenticationRejected = "authentication-rejected",
	/** The peer does not support the pinned MCP protocol. */
	UnsupportedProtocol = "unsupported-protocol",
	/** The complete bounded discovery exchange did not produce valid tool definitions. */
	DiscoveryRejected = "discovery-rejected",
	/** The saved activation workflow exhausted its bounded retry allowance. */
	WorkflowExhausted = "workflow-exhausted",
}

/**
 * Ephemeral material accepted by connection writes and never included in a read response.
 *
 * A bearer token must be used only for the admitted custody operation. A browser may hold it in
 * an ephemeral form or identical-retry draft, cleared when the command resolves, access ends or
 * the form is destroyed. It cannot enter workflow input, model/tool arguments, conversation
 * history, browser storage, read projections or diagnostics.
 */
export type McpConnectionCredential =
	| { readonly kind: McpConnectionCredentialKinds.None }
	| { readonly kind: McpConnectionCredentialKinds.Bearer; readonly token: string };

/**
 * Requests connection setup against the generation the caller observed.
 * The server selects the owner, endpoint and next generation. An identical retry keeps the
 * original expected generation so a delayed request cannot replace newer connection work.
 */
export interface McpConnectionCommand
{
	/** Caller key that returns the same admitted generation after an uncertain response. */
	readonly idempotencyKey: string;
	/** Generation observed before this command, or null when no generation had been admitted. */
	readonly expectedGeneration: number | null;
	/** Write-only material matching the registered server's explicit credential requirement. */
	readonly credential: McpConnectionCredential;
}

/** Caller-safe connection state, without connection identity, endpoint, Secret coordinates or material. */
export interface McpConnectionProjection
{
	/** Current connection outcome; this display value never authorizes execution. */
	readonly connectionStatus: McpConnectionStatus;
	/** Current admitted generation, or null before any connection command. */
	readonly connectionGeneration: number | null;
	/** Time exact credential custody committed, or null when no credential was stored. */
	readonly credentialUpdatedAt: string | null;
	/** Bounded failure category, or null when there is no failure to report. */
	readonly failureCode: McpConnectionFailureCodes | null;
}
