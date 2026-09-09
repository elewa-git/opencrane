import type { McpInstalledServer, McpServer } from "@opencrane/core";
import { ToolCatalogueFilters, type InstalledToolRow, type ToolCatalogueFilter } from "./tools-inventory.types";

/** Filters only the catalogue already admitted by the server. */
export function _FilterCatalogue(servers: readonly McpServer[], query: string, type: ToolCatalogueFilter): McpServer[]
{
	const term = query.trim().toLowerCase();
	return servers.filter(function _Matches(server)
	{
		return (type === ToolCatalogueFilters.All || server.type === type) &&
			(term === "" || server.name.toLowerCase().includes(term) || server.description.toLowerCase().includes(term));
	});
}

/** Omits installed records whose description is no longer entitled to this caller. */
export function _InstalledToolRows(servers: readonly McpServer[], installed: readonly McpInstalledServer[]): InstalledToolRow[]
{
	const byId = new Map(servers.map(server => [server.id, server]));
	return installed.flatMap(function _Join(record)
	{
		const server = byId.get(record.serverId);
		return server === undefined ? [] : [{ server, installed: record }];
	});
}
