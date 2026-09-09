import { Injectable, computed, inject, resource, signal } from "@angular/core";
import { MCP_GATEWAY } from "@opencrane/state/mcp/adapter";
import { _FilterCatalogue, _InstalledToolRows } from "./tools-inventory.mapper";
import { ToolCatalogueFilters, type ToolCatalogueFilter } from "./tools-inventory.types";

/** Owns entitled catalogue reads and per-server install commands for one tools route. */
@Injectable()
export class ToolsInventoryStore
{
	/** Transport supplied by the application. */
	private readonly _gateway = inject(MCP_GATEWAY);
	/** Entitled descriptions supplied by the latest successful read. */
	private readonly _catalogue = resource({ loader: this._LoadCatalogue.bind(this) });
	/** Server-confirmed installations. */
	private readonly _installed = resource({ loader: this._LoadInstalled.bind(this) });
	/** Commands are admitted independently for each server. */
	public readonly busy = signal<ReadonlySet<string>>(new Set());
	/** Last command failure presented beside the inventory. */
	public readonly error = signal<string | null>(null);
	/** Controlled catalogue search. */
	public readonly search = signal("");
	/** Controlled connection-type filter. */
	public readonly typeFilter = signal<ToolCatalogueFilter>(ToolCatalogueFilters.All);
	/** Entitled descriptions available to the current resource. */
	private readonly _servers = computed(() => this._catalogue.hasValue() ? this._catalogue.value() : []);
	/** Current installation records available to the resource. */
	private readonly _installs = computed(() => this._installed.hasValue() ? this._installed.value() : []);
	/** Filtered catalogue cards. */
	public readonly servers = computed(() => _FilterCatalogue(this._servers(), this.search(), this.typeFilter()));
	/** Installed rows use only descriptions returned to this user. */
	public readonly rows = computed(() => _InstalledToolRows(this._servers(), this._installs()));
	/** Server ids already installed. */
	public readonly installedIds = computed(() => new Set(this._installs().map(record => record.serverId)));
	/** Entitled count before browser filtering. */
	public readonly total = computed(() => this._servers().length);
	/** Distinguishes reading from an empty inventory. */
	public readonly loading = computed(() => this._catalogue.isLoading() || this._installed.isLoading());
	/** Explains failed reads separately from an empty inventory. */
	public readonly readError = computed(() => this._catalogue.error() || this._installed.error() ? "Tools could not be refreshed. Try again." : null);

	/** Refreshes both projections without starting a mutation. */
	public refresh(): void { this._catalogue.reload(); this._installed.reload(); }

	/** Installs once per server, then reloads the authoritative installation projection. */
	public async install(serverId: string): Promise<void>
	{
		if (this.busy().has(serverId) || this.installedIds().has(serverId))
			return;
		this._Start(serverId);
		try
		{
			await this._gateway.install(serverId);
			this._installed.reload();
		}
		catch { this.error.set("The tool could not be installed. Try again."); }
		finally { this._Finish(serverId); }
	}

	/** Removes once per server and refreshes the server-owned installation list. */
	public async uninstall(serverId: string): Promise<void>
	{
		if (this.busy().has(serverId))
			return;
		this._Start(serverId);
		try
		{
			await this._gateway.uninstall(serverId);
			this._installed.reload();
		}
		catch { this.error.set("The tool could not be removed. Try again."); }
		finally { this._Finish(serverId); }
	}

	/** Reads visible catalogue descriptions. */
	private _LoadCatalogue() { return this._gateway.listEntitledCatalogue(); }
	/** Reads installations for this user. */
	private _LoadInstalled() { return this._gateway.listInstalled(); }
	/** Claims the target before the first asynchronous command step. */
	private _Start(serverId: string): void
	{
		this.error.set(null);
		this.busy.update(current => new Set([...current, serverId]));
	}
	/** Releases only this target, leaving unrelated commands busy. */
	private _Finish(serverId: string): void
	{
		this.busy.update(function _Release(current) { const next = new Set(current); next.delete(serverId); return next; });
	}
}
