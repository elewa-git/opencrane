import { ChangeDetectionStrategy, Component, Signal, computed, inject, resource } from "@angular/core";
import { RouterLink } from "@angular/router";

import { McpInstalledServer, McpServer } from "@opencrane/core";
import { MCP_GATEWAY } from "@opencrane/state/mcp/adapter";
import { ScopeChipComponent, ScopeChipTones, SectionHeadingComponent } from "@opencrane/elements/ui";
import { MCP_CONNECTION_INDICATORS, MCP_TYPE_CHIPS } from "../mcp-chip.constants";

/** One installed-server row: the catalogue server joined to its install record. */
interface _McpToolRow
{
	/** Catalogue detail for the server. */
	server: McpServer;
	/** The user's install + connection record. */
	installed: McpInstalledServer;
}

/**
 * My Tools — the user's installed MCP servers with live connection status.
 *
 * Joins each install record to its catalogue detail, renders the connection
 * state and allows installs to be removed. Credential activation remains absent
 * until a verified custody boundary is composed.
 */
@Component({
	selector: "wo-my-tools",
	standalone: true,
	imports: [SectionHeadingComponent, ScopeChipComponent, RouterLink],
	templateUrl: "./my-tools.component.html",
	styleUrl: "./my-tools.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class MyToolsComponent
{
	/** Active MCP data source (mock by default; live OpenCrane when bound). */
	private readonly _gateway = inject(MCP_GATEWAY);

	/** Entitled catalogue, for joining server detail onto install records. */
	private readonly _catalogue = resource({
		loader: (): Promise<McpServer[]> => this._gateway.listEntitledCatalogue()
	});

	/** The user's installed servers + connection state. */
	private readonly _installed = resource({
		loader: (): Promise<McpInstalledServer[]> => this._gateway.listInstalled()
	});

	/** Feature-owned status label, tone, and motion for each connection state. */
	public readonly connectionIndicators = MCP_CONNECTION_INDICATORS;

	/** Shared tones exposed for typed status-class selection. */
	public readonly chipTones = ScopeChipTones;

	/** Feature-owned labels and semantic tones for server-type chips. */
	public readonly typeChips = MCP_TYPE_CHIPS;

	/** Catalogue servers keyed by id, for the join. */
	private readonly _serversById: Signal<Map<string, McpServer>> = computed((): Map<string, McpServer> =>
	{
		const list = this._catalogue.hasValue() ? this._catalogue.value() : [];
		return new Map(list.map(function entry(server: McpServer): [string, McpServer] { return [server.id, server]; }));
	});

	/** Installed rows joined to their catalogue detail. */
	public readonly rows: Signal<_McpToolRow[]> = computed((): _McpToolRow[] =>
	{
		const installed = this._installed.hasValue() ? this._installed.value() : [];
		const byId = this._serversById();
		const rows: _McpToolRow[] = [];
		for (const record of installed)
		{
			const server = byId.get(record.serverId);
			if (server)
			{
				rows.push({ server, installed: record });
			}
		}
		return rows;
	});

	/** Uninstall a server. */
	public async uninstall(server: McpServer): Promise<void>
	{
		await this._gateway.uninstall(server.id);
		this._installed.reload();
	}
}
