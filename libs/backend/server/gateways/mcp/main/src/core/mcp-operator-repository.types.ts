import type { AuthorizationContextRepository, CapabilityCatalogRepository, ManagedAuthorizationGrantRepository } from "@opencrane/backend/server/iam/authorization";

/**
 * Carries the MCP catalog fields that operator flows project into contract responses.
 *
 * The Prisma adapter selects this shape instead of exposing database rows, so the core mapping can
 * stay independent of persistence while it decides which optional values to send to clients.
 */
export interface McpOperatorServerRecord
{
	/** Identifies the catalog server for installs, grants, and management actions. */
	readonly id: string;
	/** Gives the server name shown in catalog and governance responses. */
	readonly name: string;
	/** Gives the server description shown with its catalog entry. */
	readonly description: string;
	/** Identifies the publisher when the catalog row records one. */
	readonly publisher: string | null;
	/** Holds the optional glyph that a client may show for this server. */
	readonly glyph: string | null;
	/** Carries the persisted server type that selects the install connection status. */
	readonly serverType: string;
	/** Carries the persisted approval state that controls catalog visibility. */
	readonly approvalStatus: string;
	/** Holds credential data that the core validates before returning it to a client. */
	readonly credentialSchema: unknown;
	/** Gives the optional entitlement summary exposed in catalog responses. */
	readonly entitlementSummary: string | null;
}

/**
 * Carries one principal's persisted installation of an MCP server.
 *
 * Install and uninstall flows use this limited projection so callers receive connection state
 * without depending on the database install model.
 */
export interface McpOperatorInstallRecord
{
	/** Identifies the catalog server that this principal installed. */
	readonly mcpServerId: string;
	/** Carries the persisted connection state mapped into the installed-server response. */
	readonly connectionStatus: string;
	/** Records when the installed server was last used, when that usage has been recorded. */
	readonly lastUsedAt: Date | null;
}

/** Carries the group fields required to build an MCP access-policy or directory response. */
export interface McpOperatorGroupRecord
{
	/** Identifies the local group used in an authorization subject. */
	readonly id: string;
	/** Gives the group name shown to an access-policy editor. */
	readonly name: string;
}

/** Carries the principal fields required to build an MCP access-policy or directory response. */
export interface McpOperatorPrincipalRecord
{
	/** Identifies the local principal used in an authorization subject. */
	readonly id: string;
	/** Gives the principal email when the directory has one. */
	readonly email: string | null;
	/** Gives the principal display name when the directory has one. */
	readonly displayName: string | null;
}

/**
 * Defines the MCP persistence work that one operator operation performs inside a transaction.
 *
 * The operator logic reads catalog and directory data through this port, then writes installs,
 * approval changes, and audit entries through the same {@link McpOperatorTransaction}. An
 * implementation must retain the passed silo boundary and the absence signals because callers use
 * them to avoid returning or changing rows from another silo.
 */
export interface IMcpOperatorRepository
{
	/**
	 * Lists newest-first published servers in the requested silo for entitlement checks.
	 *
	 * Called by: `listEntitledCatalog` before it evaluates each server's grants.
	 * @param siloId - Identifies the silo whose published catalog the caller may consider.
	 * @returns Published catalog rows in descending creation order; no unpublished row is included.
	 */
	listPublishedServers(siloId: string): Promise<readonly McpOperatorServerRecord[]>;
	/**
	 * Lists newest-first catalog servers in the requested silo, regardless of approval state.
	 *
	 * Called by: `listAllServers` for the governance view.
	 * @param siloId - Identifies the silo whose catalog the caller may administer.
	 * @returns All catalog rows in descending creation order, including unpublished rows.
	 */
	listAllServers(siloId: string): Promise<readonly McpOperatorServerRecord[]>;
	/**
	 * Finds a server only when its identifier belongs to the requested silo.
	 *
	 * Called by: install, access-policy, and approval flows before they act on a server.
	 * @param siloId - Keeps the lookup inside the authenticated caller's silo.
	 * @param serverId - Identifies the catalog server to find.
	 * @returns The server row, or `null` when no server with this ID belongs to the silo.
	 */
	findServer(siloId: string, serverId: string): Promise<McpOperatorServerRecord | null>;
	/**
	 * Lists a principal's installed servers from oldest to newest.
	 *
	 * Called by: `listInstalled` before it maps persisted connection states into the API response.
	 * @param principalId - Identifies the principal whose installations the caller needs.
	 * @returns Installation rows in ascending creation order; an empty array means no installations.
	 */
	listInstalls(principalId: string): Promise<readonly McpOperatorInstallRecord[]>;
	/**
	 * Creates an installation when absent, or returns the existing installation without changing it.
	 *
	 * Called by: `installServer` after authorization succeeds, so repeated installation requests keep
	 * one row for the server and principal pair.
	 * @param serverId - Identifies the server to install.
	 * @param principalId - Identifies the principal receiving the installation.
	 * @param connectionStatus - Sets the connection state when this method creates the row.
	 * @returns The new or existing installation row.
	 */
	upsertInstall(serverId: string, principalId: string, connectionStatus: string): Promise<McpOperatorInstallRecord>;
	/**
	 * Deletes a principal's installation of one server.
	 *
	 * Called by: `uninstallServer`, which appends an audit entry only after this method reports a
	 * deletion.
	 * @param serverId - Identifies the server whose installation should be removed.
	 * @param principalId - Identifies the principal whose installation should be removed.
	 * @returns `true` when an installation existed and was removed; otherwise `false`.
	 */
	deleteInstall(serverId: string, principalId: string): Promise<boolean>;
	/**
	 * Changes a server's approval state when the server belongs to the requested silo.
	 *
	 * Called by: approval and enablement flows before they append their governance audit entry.
	 * @param siloId - Keeps the update inside the authenticated caller's silo.
	 * @param serverId - Identifies the server whose approval state should change.
	 * @param approvalStatus - Supplies the persisted approval state to write.
	 * @returns The updated server row, or `null` when no server with this ID belongs to the silo.
	 */
	setApprovalStatus(siloId: string, serverId: string, approvalStatus: string): Promise<McpOperatorServerRecord | null>;
	/**
	 * Lists groups in the requested silo, optionally restricted to the supplied group IDs.
	 *
	 * Called by: directory and access-policy flows; omitting `groupIds` builds the full directory,
	 * while supplying it checks the proposed or stored group subjects.
	 * @param siloId - Identifies the silo whose groups the caller may read.
	 * @param groupIds - Restricts the result to these group IDs when supplied.
	 * @returns Name-sorted group rows; an empty array means no requested group was found.
	 */
	listGroups(siloId: string, groupIds?: readonly string[]): Promise<readonly McpOperatorGroupRecord[]>;
	/**
	 * Lists principals in the requested silo, optionally restricted to the supplied principal IDs.
	 *
	 * Called by: directory and access-policy flows; omitting `principalIds` builds the full
	 * directory, while supplying it checks the proposed or stored principal subjects.
	 * @param siloId - Identifies the silo whose principals the caller may read.
	 * @param principalIds - Restricts the result to these principal IDs when supplied.
	 * @returns ID-sorted principal rows; an empty array means no requested principal was found.
	 */
	listPrincipals(siloId: string, principalIds?: readonly string[]): Promise<readonly McpOperatorPrincipalRecord[]>;
	/**
	 * Appends an MCP operation to the audit log owned by the current transaction.
	 *
	 * Called by: install, uninstall, approval, and access-policy mutation flows after their primary
	 * storage action completes, so the audit row commits or rolls back with that action.
	 * @param action - Records the action category for the audit entry.
	 * @param resource - Identifies the MCP resource affected by the action.
	 * @param message - Records the human-readable audit detail.
	 * @returns Resolves after the audit entry has been added to the transaction.
	 */
	appendAudit(action: string, resource: string, message: string): Promise<void>;
}

/**
 * Groups the repositories that one MCP operator operation must use within the same transaction.
 *
 * The core combines catalog rows with authorization decisions and managed grants, then appends its
 * audit record. Holding these ports together prevents a successful MCP write from being committed
 * separately from the access-policy work that justified it.
 */
export interface McpOperatorTransaction
{
	/** Reads and changes MCP catalog, install, directory, and audit records. */
	readonly mcp: IMcpOperatorRepository;
	/** Resolves the caller's principal and group subjects for entitlement decisions. */
	readonly authorization: AuthorizationContextRepository;
	/** Finds the MCP-use capability required to evaluate entitlement grants. */
	readonly capabilityCatalog: CapabilityCatalogRepository;
	/** Reads and reconciles the grant set owned by the MCP access editor. */
	readonly managedGrants: ManagedAuthorizationGrantRepository;
}

/**
 * Starts the transaction that bounds one MCP operator read or mutation.
 *
 * Every MCP operator flow receives these repositories through this boundary. The Prisma
 * implementation runs the callback through its database transaction, so a result is returned only
 * after the callback's catalog, authorization, and audit work can commit together.
 */
export interface McpOperatorUnitOfWork
{
	/**
	 * Runs an MCP operation with repositories attached to the same transaction.
	 *
	 * Called by: every exported MCP operator flow before it reads or mutates authority data.
	 * @param operation - Receives the transaction-scoped repositories and returns the caller's result.
	 * @returns The operation result after the transaction completes successfully.
	 * @throws Rejects when the operation or its transaction cannot complete.
	 */
	execute<Result>(operation: (transaction: McpOperatorTransaction) => Promise<Result>): Promise<Result>;
}
