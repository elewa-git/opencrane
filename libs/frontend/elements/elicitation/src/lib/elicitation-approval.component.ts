import { ChangeDetectionStrategy, Component, computed, input, output } from "@angular/core";

import { ElicitationApprovalScopes } from "@opencrane/contracts";

import type { ElicitationApprovalDraft, ElicitationApprovalPresentation } from "./elicitation-control.types";

/** One approval choice whose scope and label are controlled by the element. */
interface _ApprovalOption
{
	/** Scope sent if the participant chooses this option and confirms it in the owning card. */
	readonly scope: ElicitationApprovalScopes;
	/** Participant-facing choice label. */
	readonly label: string;
}

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
	public readonly value = input<ElicitationApprovalDraft | null>(null);
	/** Whether the controls are unavailable. */
	public readonly disabled = input(false);
	/** Whether this approval purpose lacks a complete reviewable proposal. */
	public readonly approvalDisabled = input(false);
	/** Emits a draft without submitting it. */
	public readonly valueChange = output<ElicitationApprovalDraft>();
	/** Formatted display-safe arguments shown as text rather than trusted markup. */
	protected readonly formattedArguments = computed(this._FormattedArguments.bind(this));
	/** Whether affirmative approval is possible from the complete visible disclosure. */
	protected readonly approvalAvailable = computed(() => _ApprovalAvailable(this.body(), this.approvalDisabled()));
	/** Approval choices admitted by the complete current disclosure. */
	protected readonly approvalOptions = computed(this._ApprovalOptions.bind(this));
	/** Stable enum exposed to the template for controlled selection. */
	protected readonly scopes = ElicitationApprovalScopes;

	/** Emit one offered approval choice without submitting it. */
	public approve(scope: ElicitationApprovalScopes): void
	{
		if (!this.disabled() && this.approvalAvailable() && this.approvalOptions().some(option => option.scope === scope))
			this.valueChange.emit({ approved: true, scope });
	}

	/** Emit an explicit denial at one-use scope. */
	public deny(): void
	{
		if (!this.disabled())
			this.valueChange.emit({ approved: false, scope: ElicitationApprovalScopes.Once });
	}

	/** Check whether one controlled approval choice is selected. */
	protected approvalSelected(scope: ElicitationApprovalScopes): boolean
	{
		const value = this.value();
		return value?.approved === true && value.scope === scope;
	}

	/** Show the server's one-use choice first and standing consent only with its complete explanation. */
	private _ApprovalOptions(): readonly _ApprovalOption[]
	{
		const offered = this.body().offeredScopes;
		if (offered === undefined || offered.length === 0)
			return [{ scope: ElicitationApprovalScopes.Once, label: "Approve" }];
		const options: _ApprovalOption[] = [];
		if (offered.includes(ElicitationApprovalScopes.Once))
			options.push({ scope: ElicitationApprovalScopes.Once, label: "Approve once" });
		if (offered.includes(ElicitationApprovalScopes.Always) && this.body().standingScope?.explanation.trim())
			options.push({ scope: ElicitationApprovalScopes.Always, label: "Approve always" });
		return options;
	}

	/** Format the already bounded JSON value for escaped text rendering. */
	private _FormattedArguments(): string | null
	{
		const proposedArguments = this.body().proposedArguments;
		return proposedArguments === undefined || proposedArguments === null ? null : JSON.stringify(proposedArguments, null, 2);
	}
}
