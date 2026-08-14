import { Injectable, inject } from "@angular/core";

import { ControlPlaneApiService, McpAccessPolicy, McpDirectory, McpInstalledServer, McpServer } from "@opencrane/core";

import { McpAccessPolicyWire, McpGateway, McpInstalledWire, McpServerWire } from "./mcp-gateway.types";
import { _MapAccessPolicy, _MapDirectory, _MapInstalled, _MapServer } from "./mcp-mapper.util";

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
 * Bound in `live` mode by `provideControlPlaneGateways`.
 *
 * **Security:** {@link setCredential} is the only secret-bearing call and is
 * write-only — the values are POSTed and never read back. No read method returns
 * credential material. Neither the agent runtime nor the browser receives a provider URL or secret.
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

	/** @inheritdoc */
	public async setCredential(serverId: string, values: Record<string, string>): Promise<McpInstalledServer>
	{
		return _MapInstalled(await this._api.request<McpInstalledWire>("PUT", `/mcp/installed/${encodeURIComponent(serverId)}/credential`, { body: { values } }));
	}

	/** @inheritdoc */
	public async removeCredential(serverId: string): Promise<McpInstalledServer>
	{
		return _MapInstalled(await this._api.request<McpInstalledWire>("DELETE", `/mcp/installed/${encodeURIComponent(serverId)}/credential`));
	}

	/** @inheritdoc */
	public async connectOauth(serverId: string): Promise<McpInstalledServer>
	{
		return _MapInstalled(await this._api.request<McpInstalledWire>("POST", `/mcp/installed/${encodeURIComponent(serverId)}/oauth`));
	}

	/** @inheritdoc */
	public async disconnect(serverId: string): Promise<McpInstalledServer>
	{
		return _MapInstalled(await this._api.request<McpInstalledWire>("DELETE", `/mcp/installed/${encodeURIComponent(serverId)}/oauth`));
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

	/** @inheritdoc */
	public async getAccessPolicy(serverId: string): Promise<McpAccessPolicy>
	{
		return _MapAccessPolicy(await this._api.request<McpAccessPolicyWire>("GET", `/mcp/servers/${encodeURIComponent(serverId)}/access`));
	}

	/** @inheritdoc */
	public async updateAccessPolicy(serverId: string, policy: McpAccessPolicy): Promise<McpAccessPolicy>
	{
		const body = { everyoneInOrg: policy.everyoneInOrg, groups: policy.groups, users: policy.users.map(function id(user): string { return user.id; }) };
		return _MapAccessPolicy(await this._api.request<McpAccessPolicyWire>("PUT", `/mcp/servers/${encodeURIComponent(serverId)}/access`, { body }));
	}

	/** @inheritdoc */
	public async getDirectory(): Promise<McpDirectory>
	{
		return _MapDirectory(await this._api.request<{ users?: McpDirectory["users"]; groups?: string[] }>("GET", "/mcp/directory"));
	}
}
