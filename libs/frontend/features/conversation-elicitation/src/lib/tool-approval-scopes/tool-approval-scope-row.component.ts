import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";

import { ScopeChipComponent } from "@opencrane/elements/ui";

import type { ToolApprovalScopeRowView } from "./tool-approval-scope-view.types";

/** Present one safe standing-approval summary and emit a revoke intent for its opaque identifier. */
@Component({ selector: "tr[wo-tool-approval-scope-row]", standalone: true, imports: [ButtonModule, MessageModule, ScopeChipComponent], templateUrl: "./tool-approval-scope-row.component.html", styleUrl: "./tool-approval-scope-row.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ToolApprovalScopeRowComponent
{
	/** Server-derived display row. */
	public readonly row = input.required<ToolApprovalScopeRowView>();
	/** Requests local confirmation before any state command runs. */
	public readonly revokeRequested = output<string>();
}
