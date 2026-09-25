import type { McpInstalledServer, McpServer, McpServerType } from "@opencrane/core";

/** Selects all connection types without adding a server-owned connection category. */
export enum ToolCatalogueFilters
{
	/** Includes every entitled server type. */
	All = "all"
}

/** Catalogue filter chosen in the browser. */
export type ToolCatalogueFilter = McpServerType | ToolCatalogueFilters.All;

/** Joins an install to its currently entitled catalogue description. */
export interface InstalledToolRow
{
	/** Browser-safe catalogue details. */
	readonly server: McpServer;
	/** Current install and connection state. */
	readonly installed: McpInstalledServer;
}

/** Server-owned coordinates captured before a connection command starts. */
export interface ToolConnectionCoordinate
{
	/** Installation lifecycle that must still select the same command path. */
	readonly lifecycleState: McpInstalledServer["lifecycleState"];
	/** Current generation, or null before the first connection is admitted. */
	readonly connectionGeneration: number | null;
}
