import { Injectable, inject } from "@angular/core";

import { ControlPlaneApiService, McpInstalledServer, McpServer } from "@opencrane/core";

import type { McpGateway, McpInstalledWire, McpServerWire } from "./mcp-gateway.types";
import { _MapInstalled, _MapServer } from "./mcp-mapper.util";

/**
 * Live {@link McpGateway} backed by the OpenCrane opencrane-ui MCP API.
 *
 * Issues real requests to `/api/v1/mcp/...` through the shared
 * {@link ControlPlaneApiService} (same cookie session + 401→login as the typed
 * client) and maps the responses onto the read models. WeOwnAI never imports
 * OpenCrane source; this network contract is the only coupling.
 *
 * The MCP paths are not yet in the pinned OpenAPI contract (backend P0, in
 * parallel), so calls go through {@link ControlPlaneApiService.request} with locally
 * projected wire types until the endpoints are synced into the generated client.
 * Bound in the live profile by {@link provideOpenCraneUiLiveGateways}.
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
		const wire = await this._api.request<McpServerWire[]>("GET", "/mcp/catalog");
		return wire.map(_MapServer);
	}

	/** @inheritdoc */
	public async listInstalled(): Promise<McpInstalledServer[]>
	{
		const wire = await this._api.request<McpInstalledWire[]>("GET", "/mcp/installed");
		return wire.map(_MapInstalled);
	}

	/** @inheritdoc */
	public async install(serverId: string): Promise<McpInstalledServer>
	{
		return _MapInstalled(await this._api.request<McpInstalledWire>("POST", "/mcp/installed", { body: { serverId } }));
	}

	/** @inheritdoc */
	public async uninstall(serverId: string): Promise<void>
	{
		await this._api.request<void>("DELETE", `/mcp/installed/${encodeURIComponent(serverId)}`);
	}

	// --- Admin ---

	/** @inheritdoc */
	public async listCatalogue(): Promise<McpServer[]>
	{
		const wire = await this._api.request<McpServerWire[]>("GET", "/mcp/servers");
		return wire.map(_MapServer);
	}

	/** @inheritdoc */
	public async approve(serverId: string): Promise<McpServer>
	{
		return _MapServer(await this._api.request<McpServerWire>("POST", `/mcp/servers/${encodeURIComponent(serverId)}/approve`));
	}

	/** @inheritdoc */
	public async publish(serverId: string): Promise<McpServer>
	{
		return _MapServer(await this._api.request<McpServerWire>("POST", `/mcp/servers/${encodeURIComponent(serverId)}/publish`));
	}

	/** @inheritdoc */
	public async reject(serverId: string): Promise<McpServer>
	{
		return _MapServer(await this._api.request<McpServerWire>("POST", `/mcp/servers/${encodeURIComponent(serverId)}/reject`));
	}

	/** @inheritdoc */
	public async setEnabled(serverId: string, enabled: boolean): Promise<McpServer>
	{
		return _MapServer(await this._api.request<McpServerWire>("POST", `/mcp/servers/${encodeURIComponent(serverId)}/enabled`, { body: { enabled } }));
	}

}
