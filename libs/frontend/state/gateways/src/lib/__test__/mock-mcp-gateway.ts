import { Injectable } from "@angular/core";

import { McpApprovalStatus, McpConnectionStatus, McpInstalledServer, McpServer, McpServerType } from "@opencrane/core";
import { MCP_CATALOGUE, MCP_INSTALLED } from "@opencrane/core/testing";
import { McpGateway } from "@opencrane/state/mcp/adapter";

/** In-memory McpGateway for tests — never imported by production code. */
@Injectable()
export class MockMcpGateway implements McpGateway
{
	private readonly _installed = new Map<string, McpInstalledServer>(MCP_INSTALLED.map(function e(r: McpInstalledServer): [string, McpInstalledServer] { return [r.serverId, { ...r }]; }));
	private readonly _catalogue = new Map<string, McpServer>(MCP_CATALOGUE.map(function e(s: McpServer): [string, McpServer] { return [s.id, { ...s }]; }));

	public listEntitledCatalogue(): Promise<McpServer[]>
	{
		return Promise.resolve(Array.from(this._catalogue.values()).filter(function pub(s: McpServer): boolean { return s.approvalStatus === McpApprovalStatus.Published; }).map(function c(s: McpServer): McpServer { return { ...s }; }));
	}

	public listInstalled(): Promise<McpInstalledServer[]>
	{
		return Promise.resolve(Array.from(this._installed.values(), function c(r: McpInstalledServer): McpInstalledServer { return { ...r }; }));
	}

	public install(serverId: string): Promise<McpInstalledServer>
	{
		const server = this._catalogue.get(serverId);
		if (!server) return Promise.reject(new Error(`unknown MCP server: ${serverId}`));
		const record: McpInstalledServer = { serverId, connectionStatus: server.type === McpServerType.MultiUser ? McpConnectionStatus.SharedKey : McpConnectionStatus.NeedsCredential, lastUsed: null };
		this._installed.set(serverId, record);
		return Promise.resolve({ ...record });
	}

	public uninstall(serverId: string): Promise<void> { this._installed.delete(serverId); return Promise.resolve(); }
	public listCatalogue(): Promise<McpServer[]> { return Promise.resolve(Array.from(this._catalogue.values(), function c(s: McpServer): McpServer { return { ...s }; })); }
	public approve(id: string): Promise<McpServer> { return Promise.resolve(this._setStatus(id, McpApprovalStatus.Approved)); }
	public publish(id: string): Promise<McpServer> { return Promise.resolve(this._setStatus(id, McpApprovalStatus.Published)); }
	public reject(id: string): Promise<McpServer> { return Promise.resolve(this._setStatus(id, McpApprovalStatus.Disabled)); }
	public setEnabled(id: string, on: boolean): Promise<McpServer> { return Promise.resolve(this._setStatus(id, on ? McpApprovalStatus.Published : McpApprovalStatus.Disabled)); }

	private _setStatus(serverId: string, status: McpApprovalStatus): McpServer
	{
		const s = this._catalogue.get(serverId);
		if (!s) throw new Error(`unknown MCP server: ${serverId}`);
		const next: McpServer = { ...s, approvalStatus: status };
		this._catalogue.set(serverId, next);
		return { ...next };
	}
}
