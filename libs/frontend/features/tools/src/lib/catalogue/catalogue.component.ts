import { ChangeDetectionStrategy, Component, Signal, computed, inject, resource, signal } from "@angular/core";
import { RouterLink } from "@angular/router";

import { McpInstalledServer, McpServer, McpServerType } from "@opencrane/core";
import { MCP_GATEWAY } from "@opencrane/state/mcp/adapter";
import { ScopeChipComponent, SectionHeadingComponent } from "@opencrane/elements/ui";

import { MCP_TYPE_CHIPS } from "../mcp-chip.constants";

/**
 * Catalogue — user browse view.
 *
 * Lists only the servers an admin has approved and entitled to the current user
 * (the gateway never returns pending/unapproved/unentitled ones), as a card
 * grid with search + type filter. Each card installs the server; already
 * installed servers show a resting "Installed" state.
 */
@Component({
	selector: "wo-catalogue",
	standalone: true,
	imports: [SectionHeadingComponent, ScopeChipComponent, RouterLink],
	templateUrl: "./catalogue.component.html",
	styleUrl: "./catalogue.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class CatalogueComponent
{
	/** Active MCP data source (mock by default; live OpenCrane when bound). */
	private readonly _gateway = inject(MCP_GATEWAY);

	/** Entitled catalogue, loaded from the gateway. */
	private readonly _catalogue = resource({
		loader: (): Promise<McpServer[]> => this._gateway.listEntitledCatalogue()
	});

	/** The user's installed servers, so cards can show an installed state. */
	private readonly _installed = resource({
		loader: (): Promise<McpInstalledServer[]> => this._gateway.listInstalled()
	});

	/** Free-text search over name + description. */
	public readonly search = signal<string>("");

	/** Type filter ("all" or a {@link McpServerType}). */
	public readonly typeFilter = signal<string>("all");

	/** Server-type enum for the template's filter options. */
	public readonly serverType = McpServerType;

	/** Feature-owned labels and semantic tones for server-type chips. */
	public readonly typeChips = MCP_TYPE_CHIPS;

	/** Set of installed server ids, for the installed-state lookup. */
	private readonly _installedIds: Signal<Set<string>> = computed((): Set<string> =>
	{
		const list = this._installed.hasValue() ? this._installed.value() : [];
		return new Set(list.map(function id(record: McpInstalledServer): string { return record.serverId; }));
	});

	/** Catalogue rows after applying the search + type filter. */
	public readonly servers: Signal<McpServer[]> = computed((): McpServer[] =>
	{
		const all = this._catalogue.hasValue() ? this._catalogue.value() : [];
		const term = this.search().trim().toLowerCase();
		const type = this.typeFilter();
		return all.filter(function matches(server: McpServer): boolean
		{
			const matchesType = type === "all" || server.type === type;
			const matchesTerm = term === "" || server.name.toLowerCase().includes(term) || server.description.toLowerCase().includes(term);
			return matchesType && matchesTerm;
		});
	});

	/** Count of entitled servers, for the heading subtitle. */
	public readonly total: Signal<number> = computed((): number => (this._catalogue.hasValue() ? this._catalogue.value().length : 0));

	/** Whether a server is already installed by the current user. */
	public isInstalled(serverId: string): boolean
	{
		return this._installedIds().has(serverId);
	}

	/** Install a server, then refresh the installed state so its card flips. */
	public async install(server: McpServer): Promise<void>
	{
		await this._gateway.install(server.id);
		this._installed.reload();
	}

	/** Update the search term from the input event. */
	public onSearch(event: Event): void
	{
		this.search.set((event.target as HTMLInputElement).value);
	}

	/** Update the type filter from the select event. */
	public onTypeFilter(event: Event): void
	{
		this.typeFilter.set((event.target as HTMLSelectElement).value);
	}
}
