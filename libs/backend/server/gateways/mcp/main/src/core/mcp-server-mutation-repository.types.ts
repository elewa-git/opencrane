/** One credential metadata row to persist beneath an MCP server. */
export interface McpServerCredentialWrite
{
	/** Human-readable label returned to the user; secret material never enters this boundary. */
	readonly displayName: string;
}

/** Canonical persisted values for a new MCP server. */
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
	/** Canonical capability labels. */
	readonly capabilities: readonly string[];
	/** Optional upstream source identifier. */
	readonly sourceId?: string;
	/** Optional last successful synchronization time. */
	readonly lastSyncedAt?: Date;
	/** Credential metadata that must become durable with the parent server. */
	readonly credentials: readonly McpServerCredentialWrite[];
}

/** Canonical values that may change on an existing MCP server. */
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
	/** Complete replacement credential set. */
	readonly credentials: readonly McpServerCredentialWrite[];
}

/** Result returned after a durable MCP server mutation. */
export interface McpServerMutationWriteResult
{
	/** Stable MCP server identifier. */
	readonly id: string;
}

/** Repository contract for the MCP server aggregate and its child credential metadata. */
export interface McpServerMutationRepository
{
	/** Creates an MCP server aggregate. */
	createServer(input: CreateMcpServerWrite): Promise<McpServerMutationWriteResult>;
	/** Updates an MCP server aggregate. */
	updateServer(input: UpdateMcpServerWrite): Promise<void>;
	/** Deletes an MCP server aggregate. */
	deleteServer(serverId: string): Promise<void>;
}

/** Unit-of-work contract that commits an MCP aggregate and its audit record together. */
export interface McpServerMutationUnitOfWork extends McpServerMutationRepository
{
	/** Each mutation persists the parent, credential children, and corresponding audit record atomically. */
}
