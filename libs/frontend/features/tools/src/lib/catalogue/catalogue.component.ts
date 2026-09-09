import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { RouterLink } from "@angular/router";
import { McpServerType } from "@opencrane/core";
import { ResourceFeedbackComponent, SectionHeadingComponent } from "@opencrane/elements/ui";
import { ToolsInventoryStore } from "../state/tools-inventory.store";
import { ToolCatalogueFilters, type ToolCatalogueFilter } from "../state/tools-inventory.types";
import { ToolCardComponent } from "./tool-card/tool-card.component";

/** Composes entitled catalogue cards and delegates reads and install commands to its route store. */
@Component({ selector: "wo-catalogue", standalone: true, imports: [SectionHeadingComponent, ResourceFeedbackComponent, RouterLink, ToolCardComponent], providers: [ToolsInventoryStore], templateUrl: "./catalogue.component.html", styleUrl: "./catalogue.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class CatalogueComponent
{
	/** Store destroyed with this route. */
	public readonly store = inject(ToolsInventoryStore);
	/** Server-owned connection types available as filters. */
	public readonly serverType = McpServerType;
	/** Browser-only selection of every connection type. */
	public readonly filters = ToolCatalogueFilters;
	/** Updates the controlled search input. */
	public onSearch(event: Event): void { this.store.search.set((event.target as HTMLInputElement).value); }
	/** Adopts only connection categories offered by this screen. */
	public onTypeFilter(event: Event): void
	{
		const value = (event.target as HTMLSelectElement).value as ToolCatalogueFilter;
		if (value === ToolCatalogueFilters.All || Object.values(McpServerType).includes(value))
			this.store.typeFilter.set(value);
	}
}
