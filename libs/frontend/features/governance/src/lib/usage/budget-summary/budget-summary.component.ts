import { ChangeDetectionStrategy, Component, computed, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { TableModule } from "primeng/table";

import { ResourceFeedbackComponent, SectionHeadingComponent } from "@opencrane/elements/ui";

import { _CanShowReportingData, _IsReportingPending, _ReportingReadError } from "../../reporting/reporting-view";
import { GovernanceReadStates, type GovernanceReadFeedback } from "../../reporting/reporting-view.types";
import type { BudgetAccountRowView } from "./budget-summary-view.types";

/**
 * Presents independently protected global and account budget responses without editing them.
 * A denial or failure in one section never hides the other. Returned zero can be an API default,
 * so the view makes no claim that a budget was configured or that runtime enforcement uses it.
 * Called by: the usage route and the budget-summary component stories and tests.
 */
@Component({ selector: "wo-budget-summary", standalone: true, imports: [ButtonModule, TableModule, ResourceFeedbackComponent, SectionHeadingComponent], templateUrl: "./budget-summary.component.html", styleUrl: "./budget-summary.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class BudgetSummaryComponent
{
	/** Supplies feedback for the global budget read alone. */
	public readonly globalFeedback = input.required<GovernanceReadFeedback>();
	/** Supplies feedback for account overrides independently. */
	public readonly accountsFeedback = input.required<GovernanceReadFeedback>();
	/** Includes the returned global amount and currency, or null when unknown. */
	public readonly globalBudget = input<string | null>(null);
	/** Contains returned overrides without inferring missing accounts. */
	public readonly overrides = input<readonly BudgetAccountRowView[]>([]);
	/** Requests another global budget read. */
	public readonly globalRefreshRequested = output<void>();
	/** Requests another account override read. */
	public readonly accountRefreshRequested = output<void>();
	/** Copies readonly overrides for the table's mutable array input. */
	protected readonly tableRows = computed(() => [...this.overrides()]);
	/** Exposes supported read states to the template. */
	protected readonly states = GovernanceReadStates;
	/** Determines visibility separately for each protected response. */
	protected readonly showData = _CanShowReportingData;
	/** Identifies pending reads within their own section. */
	protected readonly pending = _IsReportingPending;
	/** Explains unavailable, stale and denied responses. */
	protected readonly readError = _ReportingReadError;

	/** Emits the global read intent without retrying account overrides. */
	protected requestGlobalRefresh(): void
	{
		if (!this.pending(this.globalFeedback().state))
			this.globalRefreshRequested.emit();
	}

	/** Emits the account read intent without retrying the global response. */
	protected requestAccountRefresh(): void
	{
		if (!this.pending(this.accountsFeedback().state))
			this.accountRefreshRequested.emit();
	}
}
