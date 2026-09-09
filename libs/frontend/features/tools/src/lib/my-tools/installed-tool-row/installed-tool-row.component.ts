import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ScopeChipComponent, ScopeChipTones } from "@opencrane/elements/ui";
import { MCP_CONNECTION_INDICATORS, MCP_TYPE_CHIPS } from "../../mcp-chip.constants";
import type { InstalledToolRow } from "../../state/tools-inventory.types";

/** Keeps table semantics and connection presentation together for one installed tool. */
@Component({ selector: "tr[wo-installed-tool-row]", standalone: true, imports: [ScopeChipComponent], templateUrl: "./installed-tool-row.component.html", styleUrl: "./installed-tool-row.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class InstalledToolRowComponent
{
	/** Server description joined to its current installation. */
	public readonly row = input.required<InstalledToolRow>();
	/** Whether removal is pending for this server. */
	public readonly busy = input(false);
	/** Requests removal without issuing a gateway call. */
	public readonly uninstallRequested = output<void>();
	/** Connection labels and semantic indicators. */
	public readonly connectionIndicators = MCP_CONNECTION_INDICATORS;
	/** Shared tones used by the existing status indicator. */
	public readonly chipTones = ScopeChipTones;
	/** Labels and tones for connection type. */
	public readonly typeChips = MCP_TYPE_CHIPS;
}
