import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { McpApprovalStatus, type McpServer } from "@opencrane/core";
import { ScopeChipComponent } from "@opencrane/elements/ui";
import { MCP_APPROVAL_CHIPS, MCP_TYPE_CHIPS } from "../../../mcp-chip.constants";

/** Presents server governance actions; the server remains the authority for allowed transitions. */
@Component({ selector: "tr[wo-catalogue-admin-row]", standalone: true, imports: [ScopeChipComponent], host: { "[class.wo-admin__row--off]": "server().approvalStatus === status.Disabled" }, templateUrl: "./catalogue-admin-row.component.html", styleUrl: "./catalogue-admin-row.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class CatalogueAdminRowComponent
{
	/** Server description and current governance projection. */
	public readonly server = input.required<McpServer>();
	/** Disables this row while a governance command is pending. */
	public readonly busy = input(false);
	/** Requests approval of this server. */
	public readonly approveRequested = output<void>();
	/** Requests publication of this server. */
	public readonly publishRequested = output<void>();
	/** Requests rejection of this server. */
	public readonly rejectRequested = output<void>();
	/** Requests enabling or disabling this server. */
	public readonly enabledRequested = output<boolean>();
	/** Server-owned lifecycle categories. */
	public readonly status = McpApprovalStatus;
	/** Approved lifecycle label and tone. */
	public readonly approvalChips = MCP_APPROVAL_CHIPS;
	/** Approved connection label and tone. */
	public readonly typeChips = MCP_TYPE_CHIPS;
}
