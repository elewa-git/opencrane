import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { InputTextModule } from "primeng/inputtext";
import { SelectModule } from "primeng/select";
import { McpServerType } from "@opencrane/core";
import { ResourceFeedbackComponent, SectionHeadingComponent } from "@opencrane/elements/ui";
import { ToolsInventoryStore } from "../state/tools-inventory.store";
import { ToolCatalogueFilters, type ToolCatalogueFilter } from "../state/tools-inventory.types";
import { ToolCardComponent } from "./tool-card/tool-card.component";

/** Composes entitled catalogue cards and delegates reads and install commands to its route store. */
@Component({ selector: "wo-catalogue", standalone: true, imports: [FormsModule, InputTextModule, SelectModule, SectionHeadingComponent, ResourceFeedbackComponent, RouterLink, ToolCardComponent], providers: [ToolsInventoryStore], templateUrl: "./catalogue.component.html", styleUrl: "./catalogue.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class CatalogueComponent
{
	/** Store destroyed with this route. */
	public readonly store = inject(ToolsInventoryStore);
	/** Stable labels for every server-owned connection filter rendered by the select. */
	public readonly filterOptions: readonly { label: string; value: ToolCatalogueFilter }[] = [
		{ label: "All types", value: ToolCatalogueFilters.All },
		{ label: "OAuth", value: McpServerType.RemoteOauth },
		{ label: "API token", value: McpServerType.SingleUser },
		{ label: "Multi-user", value: McpServerType.MultiUser }
	];
	/** Updates the controlled search input. */
	public onSearch(event: Event): void { this.store.search.set((event.target as HTMLInputElement).value); }
	/** Adopts only connection categories offered by this screen. */
	public onTypeFilter(value: unknown): void
	{
		if (value === ToolCatalogueFilters.All || Object.values(McpServerType).some(type => type === value))
			this.store.typeFilter.set(value as ToolCatalogueFilter);
	}
}
