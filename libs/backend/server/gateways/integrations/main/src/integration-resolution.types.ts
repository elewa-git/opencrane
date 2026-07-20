/** Request to resolve one immutable integration assignment for runtime preparation. */
export interface ResolveIntegrationAssignmentCommand
{
	/** Silo that owns the AgentRevision and integration. */
	readonly siloId: string;
	/** Immutable revision selecting the integration. */
	readonly agentRevisionId: string;
	/** Exact integration selected by the revision. */
	readonly integrationId: string;
}

/** Credential-free result returned only for an active assigned integration. */
export interface ResolvedIntegrationAssignment
{
	/** Silo-scoped integration identity. */
	readonly integrationId: string;
	/** Obot catalogue entry selected by the product authority. */
	readonly obotCatalogEntryId: string;
	/** Opaque Obot-issued custody handle; it is not credential material. */
	readonly obotCustodyReference: string;
	/** Explicit revision-scoped tool allow-list. */
	readonly allowedTools: readonly string[];
}

/** Credential-free integration assignment resolution outcome. */
export type ResolveIntegrationAssignmentResult =
	| { readonly outcome: "resolved"; readonly assignment: ResolvedIntegrationAssignment }
	| { readonly outcome: "unavailable"; readonly reason: "not_found" | "inactive" | "revoked" | "expired" };

/** Read-only authority boundary for runtime integration preparation. */
export interface IntegrationAuthorityRepository
{
	/** Resolves only an active same-silo revision assignment and its usable opaque custody reference. */
	resolveAssignment(command: ResolveIntegrationAssignmentCommand): Promise<ResolveIntegrationAssignmentResult>;
}

/** Clock owned by the server authority rather than its runtime caller. */
export interface IntegrationAuthorityClock
{
	/** Returns the current trusted instant for custody expiry evaluation. */
	now(): Date;
}
