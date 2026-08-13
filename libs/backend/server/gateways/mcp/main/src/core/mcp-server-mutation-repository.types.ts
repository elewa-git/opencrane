/**
 * One credential label to store as a child row of an MCP server.
 *
 * Only the label travels through this type. The real secret is held by the Obot gateway, which
 * hands back an opaque reference; there is no field here that could carry a key, so a caller
 * cannot get a secret into the database through the MCP write path even by accident.
 *
 * @see {@link CreateMcpServerWrite.credentials} and {@link UpdateMcpServerWrite.credentials}
 *      for how these rows get attached to a server.
 */
export interface McpServerCredentialWrite
{
	/** Label shown to the operator. No secret value is ever accepted on this type. */
	readonly displayName: string;
}

/**
 * Everything needed to store a brand-new MCP server row plus its credential labels.
 *
 * The scope, transport and status strings here are already the Prisma enum MEMBER names, not the
 * lowercase wire values the route accepts — `createMcpServer` in `mcp-servers.logic.ts` converts
 * them through `_PRISMA_SCOPE_BY_ROUTE_SCOPE` and its siblings first. The repository writes them
 * straight through, so passing a raw wire value here produces a Prisma enum error.
 *
 * @see https://modelcontextprotocol.io/specification/2025-06-18 — the MCP revision this platform
 *      pins (`_MCP_PROTOCOL_VERSION` in
 *      libs/backend/server/infra/obot-custody/src/http-obot-mcp-invocation.ts); `endpoint` and
 *      `transport` record how the upstream MCP server is reached.
 */
export interface CreateMcpServerWrite
{
	/** Operator-facing server name. */
	readonly name: string;
	/** Operator-facing server description. */
	readonly description: string;
	/** Upstream MCP endpoint. */
	readonly endpoint: string;
	/** Prisma-compatible organizational scope. */
	readonly scope: string;
	/** Prisma-compatible MCP transport. */
	readonly transport: string;
	/** Prisma-compatible lifecycle status. */
	readonly status: string;
	/** Capability labels shown in the UI, already trimmed and de-duplicated by the caller. */
	readonly capabilities: readonly string[];
	/** Optional upstream source identifier. */
	readonly sourceId?: string;
	/** Optional last successful synchronization time. */
	readonly lastSyncedAt?: Date;
	/** Credential labels written as child rows in the same transaction as the server row. */
	readonly credentials: readonly McpServerCredentialWrite[];
}

/**
 * The fields an update may change on an existing MCP server, plus its credential labels.
 *
 * Every scalar is optional and an omitted one is left alone in the database. `credentials` is the
 * exception: it is required and it is a REPLACEMENT, not a merge — every existing credential row
 * for the server is deleted first, so passing an empty list wipes them all. `sourceId` and
 * `lastSyncedAt` accept null (rather than only being optional) so a caller can clear a stored
 * value as well as change it.
 *
 * @see {@link McpServerMutationRepository.updateServer} for the write itself.
 */
export interface UpdateMcpServerWrite
{
	/** Existing MCP server identifier. */
	readonly id: string;
	/** Optional replacement name. */
	readonly name?: string;
	/** Optional replacement description. */
	readonly description?: string;
	/** Optional replacement endpoint. */
	readonly endpoint?: string;
	/** Optional replacement scope. */
	readonly scope?: string;
	/** Optional replacement transport. */
	readonly transport?: string;
	/** Optional replacement lifecycle status. */
	readonly status?: string;
	/** Optional replacement capability labels. */
	readonly capabilities?: readonly string[];
	/** Optional replacement upstream source identifier. */
	readonly sourceId?: string | null;
	/** Optional replacement synchronization time. */
	readonly lastSyncedAt?: Date | null;
	/**
	 * The full credential set the server should have after the update. This replaces rather than
	 * merges: every existing credential row is deleted first, so an empty list removes them all.
	 */
	readonly credentials: readonly McpServerCredentialWrite[];
}

/**
 * What a create returns: the new server's id, and nothing else.
 *
 * Kept deliberately narrow so a write never serialises server fields or credential rows back to
 * the caller. The route answers `{ id, status: "created" }`; call `getMcpServer` when you actually
 * need the stored row.
 */
export interface McpServerMutationWriteResult
{
	/** Stable MCP server identifier. */
	readonly id: string;
}

/**
 * The write side of the MCP server catalogue: create, change, and delete a server together with
 * its credential label rows.
 *
 * It is a separate interface so `mcp-servers.logic.ts` can be tested against a fake, and so the
 * decision about which database transaction the writes run in belongs to the composition root
 * rather than to the logic. Every implementation must write the server row, its credential rows,
 * and one audit row as a single unit — see {@link McpServerMutationUnitOfWork}.
 *
 * No method here accepts a secret value. Credentials are label-only; the real secret lives in the
 * Obot gateway.
 *
 * Called by: `createMcpServer`, `updateMcpServer` and `deleteMcpServer` in
 * libs/backend/server/gateways/mcp/main/src/core/mcp-servers.logic.ts. Implemented by
 * `PrismaMcpServerMutationRepository` (runs inside a transaction someone else opened) and
 * `PrismaMcpServerMutationUnitOfWork` (opens one per call).
 */
export interface McpServerMutationRepository
{
	/**
	 * Store a new server and its credential label rows.
	 *
	 * @param input - Server fields already converted to Prisma enum member names, plus the labels.
	 * @returns The new server's id only. Re-read the server if you need the rest of the row.
	 * @throws Whatever the database client throws. The whole call is rolled back, so a server row
	 *         without its credential rows or its audit row can never be left behind.
	 */
	createServer(input: CreateMcpServerWrite): Promise<McpServerMutationWriteResult>;
	/**
	 * Change an existing server, and REPLACE its credential rows with the supplied list.
	 *
	 * @param input - The server id plus only the fields to change; `credentials` always replaces.
	 * @throws Whatever the database client throws when no server has that id — the route does not
	 *         check the row exists first.
	 */
	updateServer(input: UpdateMcpServerWrite): Promise<void>;
	/**
	 * Delete a server together with its credential rows.
	 *
	 * @param serverId - The server to delete.
	 * @throws Whatever the database client throws when no server has that id — the route does not
	 *         check the row exists first.
	 */
	deleteServer(serverId: string): Promise<void>;
}

/**
 * The same three writes as {@link McpServerMutationRepository}, except each call opens and commits
 * its own database transaction.
 *
 * Use this where nobody else owns a transaction — a route handler, a bootstrap step. Use the plain
 * {@link McpServerMutationRepository} from code that is already running inside one. Keeping the two
 * apart stops a route from nesting transactions and makes it obvious which layer decides when the
 * commit happens.
 *
 * Called by: `mcpServersRouter` in
 * libs/backend/server/gateways/mcp/main/src/routes/mcp-servers.ts, which builds one
 * `PrismaMcpServerMutationUnitOfWork` and passes it in as the repository for every mutation route.
 */
export interface McpServerMutationUnitOfWork extends McpServerMutationRepository
{
	/**
	 * Each call writes the server row, its credential rows, and the audit row together. If any one of
	 * them fails none of them is written, so the catalogue can never show a server whose credential
	 * rows or audit trail are missing.
	 */
}
