import { Injectable, inject } from "@angular/core";

import { ControlPlaneApiService, McpInstalledServer, McpServer, type McpConnectionProjection } from "@opencrane/core";

import type { McpConnectionCommand, McpGateway } from "./mcp-gateway.types";
import { _McpConnectionCommandError, _ReadMcpConnectionResponse, _RequireMcpConnectionAccess } from "./mcp-connection-command.error";
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
 * Personal connection writes use server custody. This adapter retains no request, token or
 * raw response after the call, and returns only a validated connection projection.
 */
@Injectable()
export class OpenCraneMcpGateway implements McpGateway
{
	/** Shared opencrane-ui client (base URL, cookie session, 401 handling). */
	private readonly _api = inject(ControlPlaneApiService);

	/** @inheritdoc */
	public async listEntitledCatalogue(): Promise<McpServer[]>
	{
		const { data, error, response } = await this._api.client.GET("/mcp/catalog");
		_RequireMcpConnectionAccess(response.status);
		if (error !== undefined || data === undefined)
			throw new Error("The MCP catalogue could not be loaded.");
		return data.map(_MapServer);
	}

	/** @inheritdoc */
	public async listInstalled(): Promise<McpInstalledServer[]>
	{
		const { data, error, response } = await this._api.client.GET("/mcp/installed");
		_RequireMcpConnectionAccess(response.status);
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

	/** @inheritdoc */
	public async activatePersonalConnection(serverId: string, command: McpConnectionCommand): Promise<McpConnectionProjection>
	{
		try
		{
			const { data, response } = await this._api.client.PUT("/mcp/installed/{serverId}/connection", { params: { path: { serverId } }, body: command });
			return _ReadMcpConnectionResponse(response.status, data);
		}
		catch (error) { throw _McpConnectionCommandError(error); }
	}

	/** @inheritdoc */
	public async revokePersonalConnection(serverId: string, idempotencyKey: string, expectedGeneration: number): Promise<McpConnectionProjection>
	{
		try
		{
			const { data, response } = await this._api.client.DELETE("/mcp/installed/{serverId}/connection", { params: { path: { serverId }, query: { commandId: idempotencyKey, expectedGeneration } } });
			return _ReadMcpConnectionResponse(response.status, data);
		}
		catch (error) { throw _McpConnectionCommandError(error); }
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
