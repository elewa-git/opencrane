import type { McpConnectionManagedServiceResolver } from "./mcp-connection.types";

/** Constructs a current managed-service reader on one transaction attempt. */
export interface PrismaMcpConnectionManagedServiceResolverFactory<Transaction>
{
	/** Bind the existing managed-service identity reader to this transaction. */
	create(transaction: Transaction): McpConnectionManagedServiceResolver;
}
