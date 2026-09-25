import { ChangeDetectionStrategy, Component, computed, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { McpInstallStates } from "@opencrane/core";
import { ScopeChipComponent, ScopeChipTones } from "@opencrane/elements/ui";
import { MCP_CONNECTION_INDICATORS, MCP_TYPE_CHIPS } from "../../mcp-chip.constants";
import type { InstalledToolRow } from "../../state/tools-inventory.types";

/**
 * Keeps table semantics and connection presentation together for one installed tool.
 * The optional [connection-control] slot composes a feature-owned control before Uninstall;
 * the row does not acquire credential drafts, gateway calls or command sequencing.
 */
@Component({ selector: "tr[wo-installed-tool-row]", standalone: true, imports: [ButtonModule, ScopeChipComponent], templateUrl: "./installed-tool-row.component.html", styleUrl: "./installed-tool-row.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class InstalledToolRowComponent
{
	/** Server description joined to its current installation. */
	public readonly row = input.required<InstalledToolRow>();
	/** Whether removal is pending for this server. */
	public readonly busy = input(false);
	/** Requests removal without issuing a gateway call. */
	public readonly uninstallRequested = output<void>();
	/** A saved removal keeps the row pending even after the request or page is replaced. */
	public readonly removing = computed(() => this.row().installed.lifecycleState === McpInstallStates.Removing);
	/** Removal takes precedence over the retained connection's last status. */
	public readonly indicator = computed(() => this.removing()
		? { label: "Removing", tone: ScopeChipTones.Info, pulse: true }
		: MCP_CONNECTION_INDICATORS[this.row().installed.connectionStatus]);
	/** Shared tones used by the existing status indicator. */
	public readonly chipTones = ScopeChipTones;
	/** Labels and tones for connection type. */
	public readonly typeChips = MCP_TYPE_CHIPS;
}
