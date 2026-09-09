import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { RouterLink } from "@angular/router";
import { ResourceFeedbackComponent, SectionHeadingComponent } from "@opencrane/elements/ui";
import { ToolsInventoryStore } from "../state/tools-inventory.store";
import { InstalledToolRowComponent } from "./installed-tool-row/installed-tool-row.component";

/** Composes installed rows; the scoped store owns reads, joining and removal commands. */
@Component({ selector: "wo-my-tools", standalone: true, imports: [SectionHeadingComponent, ResourceFeedbackComponent, RouterLink, InstalledToolRowComponent], providers: [ToolsInventoryStore], templateUrl: "./my-tools.component.html", styleUrl: "./my-tools.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class MyToolsComponent
{
	/** Inventory and command lifecycle owned by this route instance. */
	public readonly store = inject(ToolsInventoryStore);
}
