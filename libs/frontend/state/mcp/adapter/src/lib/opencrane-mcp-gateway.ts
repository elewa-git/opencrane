import { Injectable, inject } from "@angular/core";

import { ControlPlaneApiService, McpInstalledServer, McpServer } from "@opencrane/core";

import type { McpGateway } from "./mcp-gateway.types";
import { _MapInstalled, _MapServer } from "./mcp-mapper.util";

/**
 * Live {@link McpGateway} backed by the OpenCrane opencrane-ui MCP API.
 *
 * Issues real requests to `/api/v1/mcp/...` through the shared
 * {@link ControlPlaneApiService} (same cookie session + 401→login as the typed
 * client) and maps the responses onto the read models. WeOwnAI never imports
 * OpenCrane source; this network contract is the only coupling.
 *
 * Calls use the generated Control Plane operations. The mapper still validates
 * the credential requirement before adopting each server into browser state.
 * Bound in `live` mode by `provideControlPlaneGateways`.
 *
 * Credential-bearing operations are intentionally absent until a verified
 * custody boundary is composed.
 */
@Injectable()
export class OpenCraneMcpGateway implements McpGateway
{
	/** Shared opencrane-ui client (base URL, cookie session, 401 handling). */
	private readonly _api = inject(ControlPlaneApiService);

	/** @inheritdoc */
	public async listEntitledCatalogue(): Promise<McpServer[]>
	{
		const { data, error } = await this._api.client.GET("/mcp/catalog");
		if (error !== undefined || data === undefined)
			throw new Error("The MCP catalogue could not be loaded.");
		return data.map(_MapServer);
	}

	/** @inheritdoc */
	public async listInstalled(): Promise<McpInstalledServer[]>
	{
		const { data, error } = await this._api.client.GET("/mcp/installed");
		if (error !== undefined || data === undefined)
			throw new Error("Installed MCP servers could not be loaded.");
		return data.map(_MapInstalled);
	}

	/** @inheritdoc */
	public async install(serverId: string): Promise<McpInstalledServer>
	{
		const { data, error } = await this._api.client.POST("/mcp/installed", { body: { serverId } });
		if (error !== undefined || data === undefined)
			throw new Error("The MCP server could not be installed.");
		return _MapInstalled(data);
	}

	/** @inheritdoc */
	public async uninstall(serverId: string): Promise<void>
	{
		const { error } = await this._api.client.DELETE("/mcp/installed/{serverId}", { params: { path: { serverId } } });
		if (error !== undefined)
			throw new Error("The MCP server could not be uninstalled.");
	}

	// --- Admin ---

	/** @inheritdoc */
	public async listCatalogue(): Promise<McpServer[]>
	{
		const { data, error } = await this._api.client.GET("/mcp/servers");
		if (error !== undefined || data === undefined)
			throw new Error("MCP governance servers could not be loaded.");
		return data.map(_MapServer);
	}

	/** @inheritdoc */
	public async approve(serverId: string): Promise<McpServer>
	{
		const { data, error } = await this._api.client.POST("/mcp/servers/{id}/approve", { params: { path: { id: serverId } } });
		if (error !== undefined || data === undefined)
			throw new Error("The MCP server could not be approved.");
		return _MapServer(data);
	}

	/** @inheritdoc */
	public async publish(serverId: string): Promise<McpServer>
	{
		const { data, error } = await this._api.client.POST("/mcp/servers/{id}/publish", { params: { path: { id: serverId } } });
		if (error !== undefined || data === undefined)
			throw new Error("The MCP server could not be published.");
		return _MapServer(data);
	}

	/** @inheritdoc */
	public async reject(serverId: string): Promise<McpServer>
	{
		const { data, error } = await this._api.client.POST("/mcp/servers/{id}/reject", { params: { path: { id: serverId } } });
		if (error !== undefined || data === undefined)
			throw new Error("The MCP server could not be rejected.");
		return _MapServer(data);
	}

	/** @inheritdoc */
	public async setEnabled(serverId: string, enabled: boolean): Promise<McpServer>
	{
		const { data, error } = await this._api.client.POST("/mcp/servers/{id}/enabled", { params: { path: { id: serverId } }, body: { enabled } });
		if (error !== undefined || data === undefined)
			throw new Error("The MCP server availability could not be changed.");
		return _MapServer(data);
	}

}
