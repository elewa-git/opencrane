import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import type { McpServer } from "@opencrane/core";
import { ScopeChipComponent } from "@opencrane/elements/ui";
import { MCP_TYPE_CHIPS } from "../../mcp-chip.constants";

/** Presents one entitled tool and emits an installation intent without owning server state. */
@Component({ selector: "wo-tool-card", standalone: true, imports: [ScopeChipComponent], templateUrl: "./tool-card.component.html", styleUrl: "./tool-card.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ToolCardComponent
{
	/** Server description already admitted by the catalogue gateway. */
	public readonly server = input.required<McpServer>();
	/** Whether the server has already been installed. */
	public readonly installed = input(false);
	/** Whether an installation command is pending. */
	public readonly busy = input(false);
	/** Asks the route store to install this tool. */
	public readonly installRequested = output<void>();
	/** Labels and semantic tones for the server's connection type. */
	public readonly typeChips = MCP_TYPE_CHIPS;
}
