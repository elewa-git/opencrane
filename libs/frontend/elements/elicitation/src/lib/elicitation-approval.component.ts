import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";

import { ElicitationBodyKinds, type ElicitationApprovalBody, type ElicitationResponseValue } from "@opencrane/contracts";

/** Present one disclosed consequential action and emit an explicit allow-or-deny draft. */
@Component({ selector: "wo-elicitation-approval", standalone: true, templateUrl: "./elicitation-approval.component.html", styleUrl: "./elicitation-control.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ElicitationApprovalComponent
{
	/** Exact server-authored approval disclosure. */
	public readonly body = input.required<ElicitationApprovalBody>();
	/** Current controlled approval selection. */
	public readonly value = input<boolean | null>(null);
	/** Whether the controls are unavailable. */
	public readonly disabled = input(false);
	/** Emits a draft without submitting it. */
	public readonly valueChange = output<ElicitationResponseValue>();

	/** Emit one explicit approval choice. */
	public select(approved: boolean): void
	{
		if (!this.disabled()) this.valueChange.emit({ kind: ElicitationBodyKinds.Approval, approved });
	}
}
