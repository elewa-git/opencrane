import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { RouterLink } from "@angular/router";
import { ButtonModule } from "primeng/button";
import { ResourceFeedbackComponent, SectionHeadingComponent } from "@opencrane/elements/ui";
import { ToolsInventoryStore } from "../state/tools-inventory.store";
import { PersonalMcpConnectionStore } from "../state/personal-mcp-connection.store";
import { InstalledToolRowComponent } from "./installed-tool-row/installed-tool-row.component";
import { PersonalMcpConnectionControlComponent } from "./personal-mcp-connection-control/personal-mcp-connection-control.component";

/** Composes installed rows; the scoped store owns reads, joining and removal commands. */
@Component({ selector: "wo-my-tools", standalone: true, imports: [ButtonModule, SectionHeadingComponent, ResourceFeedbackComponent, RouterLink, InstalledToolRowComponent, PersonalMcpConnectionControlComponent], providers: [ToolsInventoryStore, PersonalMcpConnectionStore], templateUrl: "./my-tools.component.html", styleUrl: "./my-tools.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class MyToolsComponent
{
	/** Inventory and command lifecycle owned by this route instance. */
	public readonly store = inject(ToolsInventoryStore);
	/** Scoped credential drafts and connection commands are discarded when this route closes. */
	public readonly connections = inject(PersonalMcpConnectionStore);
}
