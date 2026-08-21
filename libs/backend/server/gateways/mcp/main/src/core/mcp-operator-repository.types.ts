import type { AuthorizationContextRepository, CapabilityCatalogRepository, ManagedAuthorizationGrantRepository } from "@opencrane/backend/server/iam/authorization";

/** Persistence-neutral MCP catalog row. */
export interface McpOperatorServerRecord
{
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly publisher: string | null;
	readonly glyph: string | null;
	readonly serverType: string;
	readonly approvalStatus: string;
	readonly credentialSchema: unknown;
	readonly entitlementSummary: string | null;
}

/** Persistence-neutral per-principal install row. */
export interface McpOperatorInstallRecord
{
	readonly mcpServerId: string;
	readonly connectionStatus: string;
	readonly lastUsedAt: Date | null;
}

/** Stable group display projection. */
export interface McpOperatorGroupRecord { readonly id: string; readonly name: string; }
/** Stable principal display projection. */
export interface McpOperatorPrincipalRecord { readonly id: string; readonly email: string | null; readonly displayName: string | null; }

/** Transaction-scoped MCP catalog, install, directory, and audit persistence. */
export interface McpOperatorRepository
{
	listPublishedServers(siloId: string): Promise<readonly McpOperatorServerRecord[]>;
	listAllServers(siloId: string): Promise<readonly McpOperatorServerRecord[]>;
	findServer(siloId: string, serverId: string): Promise<McpOperatorServerRecord | null>;
	listInstalls(principalId: string): Promise<readonly McpOperatorInstallRecord[]>;
	upsertInstall(serverId: string, principalId: string, connectionStatus: string): Promise<McpOperatorInstallRecord>;
	deleteInstall(serverId: string, principalId: string): Promise<boolean>;
	setApprovalStatus(siloId: string, serverId: string, approvalStatus: string): Promise<McpOperatorServerRecord | null>;
	listGroups(siloId: string, groupIds?: readonly string[]): Promise<readonly McpOperatorGroupRecord[]>;
	listPrincipals(siloId: string, principalIds?: readonly string[]): Promise<readonly McpOperatorPrincipalRecord[]>;
	appendAudit(action: string, resource: string, message: string): Promise<void>;
}

/** All transaction-scoped authority ports used by one MCP operation. */
export interface McpOperatorTransaction
{
	readonly mcp: McpOperatorRepository;
	readonly authorization: AuthorizationContextRepository;
	readonly capabilityCatalog: CapabilityCatalogRepository;
	readonly managedGrants: ManagedAuthorizationGrantRepository;
}

/** Root transaction owner for MCP reads and mutations. */
export interface McpOperatorUnitOfWork
{
	execute<Result>(operation: (transaction: McpOperatorTransaction) => Promise<Result>): Promise<Result>;
}
