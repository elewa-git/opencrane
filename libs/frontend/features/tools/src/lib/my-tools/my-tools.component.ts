import { ChangeDetectionStrategy, Component, Signal, computed, inject, resource, signal } from "@angular/core";
import { RouterLink } from "@angular/router";

import { McpConnectionStatus, McpInstalledServer, McpServer, McpServerType } from "@opencrane/core";
import { MCP_GATEWAY } from "@opencrane/state/mcp/adapter";
import { ScopeChipComponent, ScopeChipTones, SectionHeadingComponent } from "@opencrane/elements/ui";
import { ConnectDrawerComponent } from "../connect-drawer/connect-drawer.component";
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
 * state (the one terracotta CTA is the "needs credential" row), and opens the
 * {@link ConnectDrawerComponent} for the secure connect/credential flow. All
 * writes go through the injected gateway; activation in the agent runtime
 * ("Claw") is automatic once connected.
 */
@Component({
	selector: "wo-my-tools",
	standalone: true,
	imports: [SectionHeadingComponent, ScopeChipComponent, ConnectDrawerComponent, RouterLink],
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

	/** Server whose connect drawer is open, or null when closed. */
	public readonly connectTarget = signal<McpServer | null>(null);

	/** Feature-owned status label, tone, and motion for each connection state. */
	public readonly connectionIndicators = MCP_CONNECTION_INDICATORS;

	/** Shared tones exposed for typed status-class selection. */
	public readonly chipTones = ScopeChipTones;

	/** Feature-owned labels and semantic tones for server-type chips. */
	public readonly typeChips = MCP_TYPE_CHIPS;

	/** Connection-status enum for the template. */
	public readonly status = McpConnectionStatus;

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

	/** The install record for the open connect target, if any. */
	public readonly connectInstalled: Signal<McpInstalledServer | null> = computed((): McpInstalledServer | null =>
	{
		const target = this.connectTarget();
		if (!target)
		{
			return null;
		}
		return this.rows().find(function byId(row: _McpToolRow): boolean { return row.server.id === target.id; })?.installed ?? null;
	});

	/** First server still needing a credential, for the prompt callout. */
	public readonly firstNeedsCredential: Signal<McpServer | null> = computed((): McpServer | null =>
	{
		return this.rows().find(function needs(row: _McpToolRow): boolean { return row.installed.connectionStatus === McpConnectionStatus.NeedsCredential; })?.server ?? null;
	});

	/** CTA label for a "needs credential" row, by server type. */
	public connectLabel(server: McpServer): string
	{
		return server.type === McpServerType.RemoteOauth ? "Connect →" : "Set credential →";
	}

	/** Open the connect drawer for a server. */
	public openConnect(server: McpServer): void
	{
		this.connectTarget.set(server);
	}

	/** Close the connect drawer. */
	public closeConnect(): void
	{
		this.connectTarget.set(null);
	}

	/** Save a credential for the open server, then refresh. */
	public async onSave(values: Record<string, string>): Promise<void>
	{
		const id = this.connectTarget()?.id;
		if (id)
		{
			await this._gateway.setCredential(id, values);
			this._installed.reload();
			this.closeConnect();
		}
	}

	/** Remove the open server's stored credential, then refresh. */
	public async onRemove(): Promise<void>
	{
		const id = this.connectTarget()?.id;
		if (id)
		{
			await this._gateway.removeCredential(id);
			this._installed.reload();
			this.closeConnect();
		}
	}

	/** Complete the OAuth connect for the open server; keep the drawer open to show the connected state. */
	public async onConnectOauth(): Promise<void>
	{
		const id = this.connectTarget()?.id;
		if (id)
		{
			await this._gateway.connectOauth(id);
			this._installed.reload();
		}
	}

	/** Disconnect the open server; keep the drawer open to show the reconnect state. */
	public async onDisconnect(): Promise<void>
	{
		const id = this.connectTarget()?.id;
		if (id)
		{
			await this._gateway.disconnect(id);
			this._installed.reload();
		}
	}

	/** Uninstall a server, closing the drawer if it was the open target. */
	public async uninstall(server: McpServer): Promise<void>
	{
		await this._gateway.uninstall(server.id);
		this._installed.reload();
		if (this.connectTarget()?.id === server.id)
		{
			this.closeConnect();
		}
	}
}
