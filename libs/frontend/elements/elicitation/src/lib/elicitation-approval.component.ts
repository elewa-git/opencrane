import { ChangeDetectionStrategy, Component, computed, input, output } from "@angular/core";

import type { ElicitationApprovalPresentation } from "./elicitation-control.types";

/**
 * Decide whether the complete presentational disclosure admits an affirmative draft.
 *
 * Called by: `ElicitationApprovalComponent.approvalAvailable` and its focused component test.
 *
 * @param body - Display-safe approval disclosure supplied by the feature card.
 * @param approvalDisabled - Whether the owning approval purpose requires details that are absent.
 * @returns True only when approval may be selected; denial remains independently available.
 */
export function _ApprovalAvailable(body: ElicitationApprovalPresentation, approvalDisabled: boolean): boolean
{
	return !approvalDisabled && body.proposedArguments !== null;
}

/** Present one disclosed consequential action and emit an explicit allow-or-deny draft. */
@Component({ selector: "wo-elicitation-approval", standalone: true, templateUrl: "./elicitation-approval.component.html", styleUrl: "./elicitation-control.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ElicitationApprovalComponent
{
	/** Exact server-authored approval disclosure. */
	public readonly body = input.required<ElicitationApprovalPresentation>();
	/** Current controlled approval selection. */
	public readonly value = input<boolean | null>(null);
	/** Whether the controls are unavailable. */
	public readonly disabled = input(false);
	/** Whether this approval purpose lacks a complete reviewable proposal. */
	public readonly approvalDisabled = input(false);
	/** Emits a draft without submitting it. */
	public readonly valueChange = output<boolean>();
	/** Formatted display-safe arguments shown as text rather than trusted markup. */
	protected readonly formattedArguments = computed(this._FormattedArguments.bind(this));
	/** Whether affirmative approval is possible from the complete visible disclosure. */
	protected readonly approvalAvailable = computed(() => _ApprovalAvailable(this.body(), this.approvalDisabled()));

	/** Emit one explicit approval choice. */
	public select(approved: boolean): void
	{
		if (!this.disabled() && (!approved || this.approvalAvailable()))
			this.valueChange.emit(approved);
	}

	/** Format the already bounded JSON value for escaped text rendering. */
	private _FormattedArguments(): string | null
	{
		const proposedArguments = this.body().proposedArguments;
		return proposedArguments === undefined || proposedArguments === null ? null : JSON.stringify(proposedArguments, null, 2);
	}
}
