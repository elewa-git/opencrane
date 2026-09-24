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
 * Present one disclosed consequential action and emit an allow-or-deny draft with its scope.
 *
 * A question that offers no scopes renders the single "Approve" it always did, so an older body
 * keeps working. Offering more than one renders one button per scope: a person choosing "every time"
 * makes that choice in the same click as allowing, rather than allowing and then finding a setting.
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
	/** Emits a draft without submitting it. */
	public readonly valueChange = output<ElicitationApprovalDraft>();

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

	/** Emit one allow choice at the scope its button grants. */
	public allow(scope: ElicitationApprovalScopes): void
	{
		if (!this.disabled())
			this.valueChange.emit({ approved: true, scope });
	}

	/** Emit a denial, which is always one-off however the question was scoped. */
	public deny(): void
	{
		if (!this.disabled())
			this.valueChange.emit({ approved: false, scope: ElicitationApprovalScopes.Once });
	}
}
