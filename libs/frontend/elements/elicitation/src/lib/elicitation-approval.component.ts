import { ChangeDetectionStrategy, Component, computed, input, output } from "@angular/core";

import { ElicitationApprovalScopes } from "@opencrane/contracts";

import type { ElicitationApprovalDraft, ElicitationApprovalPresentation } from "./elicitation-control.types";

/** One allow button: the scope it grants, and the words shown on it. */
interface _ApprovalOption
{
	/** Scope granted by pressing this button. */
	readonly scope: ElicitationApprovalScopes;
	/** Button text. */
	readonly label: string;
}

/** Words for each scope, in the order they are offered. */
const _SCOPE_LABELS: ReadonlyMap<ElicitationApprovalScopes, string> = new Map([
	[ElicitationApprovalScopes.Once, "Allow once"],
	[ElicitationApprovalScopes.Session, "Allow for this session"],
	[ElicitationApprovalScopes.Always, "Allow every time"],
]);

/** Order the buttons narrowest-first, so the least committing answer is the easiest to reach. */
const _SCOPE_ORDER: readonly ElicitationApprovalScopes[] = [ElicitationApprovalScopes.Once, ElicitationApprovalScopes.Session, ElicitationApprovalScopes.Always];

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

/**
 * Present one disclosed consequential action and emit an allow-or-deny draft with its scope.
 *
 * A question that offers no scopes renders the single "Approve" it always did, so an older body
 * keeps working. Offering more than one renders one button per scope: a person choosing "every time"
 * makes that choice in the same click as allowing, rather than allowing and then finding a setting.
 * Every allow button stays unavailable when the proposal cannot be shown in full; deny never is.
 */
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

	/** Allow buttons for the scopes this question offers, narrowest first. */
	public readonly options = computed<readonly _ApprovalOption[]>(() =>
	{
		const offered = this.body().offeredScopes ?? [];
		if (offered.length <= 1)
			return [{ scope: ElicitationApprovalScopes.Once, label: "Approve" }];
		return _SCOPE_ORDER.filter(function _Offered(scope): boolean { return offered.includes(scope); })
			.map(function _Option(scope): _ApprovalOption { return { scope, label: _SCOPE_LABELS.get(scope) ?? "Approve" }; });
	});

	/** Whether this exact allow button is the current draft. */
	public isSelected(scope: ElicitationApprovalScopes): boolean
	{
		const value = this.value();
		return value !== null && value.approved && value.scope === scope;
	}

	/** Whether the deny button is the current draft. */
	public isDenied(): boolean
	{
		const value = this.value();
		return value !== null && !value.approved;
	}

	/** Emit one allow choice at the scope its button grants, only when approval is available. */
	public allow(scope: ElicitationApprovalScopes): void
	{
		if (!this.disabled() && this.approvalAvailable())
			this.valueChange.emit({ approved: true, scope });
	}

	/** Emit a denial, which is always one-off however the question was scoped. */
	public deny(): void
	{
		if (!this.disabled())
			this.valueChange.emit({ approved: false, scope: ElicitationApprovalScopes.Once });
	}

	/** Format the already bounded JSON value for escaped text rendering. */
	private _FormattedArguments(): string | null
	{
		const proposedArguments = this.body().proposedArguments;
		return proposedArguments === undefined || proposedArguments === null ? null : JSON.stringify(proposedArguments, null, 2);
	}
}
