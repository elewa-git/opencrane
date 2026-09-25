import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";

import { SectionHeadingComponent, SectionHeadingLevels } from "@opencrane/elements/ui";

import { BudgetSummaryComponent } from "./budget-summary/budget-summary.component";
import { TokenUsageSummaryComponent } from "./token-usage-summary/token-usage-summary.component";
import { _BudgetRows, _BudgetValue, _UsageRows } from "./usage.mapper";
import { UsageStore } from "./usage.store";

/** Composes independent usage and budget views without inferring access from user roles. */
@Component({ selector: "wo-usage-route", standalone: true, imports: [SectionHeadingComponent, BudgetSummaryComponent, TokenUsageSummaryComponent], providers: [UsageStore], templateUrl: "./usage-route.component.html", styleUrl: "./usage-route.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class UsageRouteComponent
{
	/** Keeps the route heading above the three independently refreshed sections. */
	public readonly pageHeading = SectionHeadingLevels.Page;
	/** Owns the three protected read lifecycles. */
	public readonly store = inject(UsageStore);
	/** Displays recorded rows without summing different currencies. */
	public readonly usageRows = computed(() => _UsageRows(this.store.usage.value()));
	/** Preserves the API's returned default without claiming a setting was saved. */
	public readonly globalBudget = computed(() => _BudgetValue(this.store.globalBudget.value()));
	/** Shows configured overrides independently from the global read. */
	public readonly budgetRows = computed(() => _BudgetRows(this.store.accountBudgets.value()));
}
