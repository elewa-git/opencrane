import { ChangeDetectionStrategy, Component, computed, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { TableModule } from "primeng/table";

import { ResourceFeedbackComponent, SectionHeadingComponent } from "@opencrane/elements/ui";

import { _CanShowReportingData, _IsReportingPending, _ReportingReadError } from "../../reporting/reporting-view";
import { GovernanceReadStates, type GovernanceReadFeedback } from "../../reporting/reporting-view.types";
import type { TokenUsageRowView } from "./token-usage-view.types";

/**
 * Displays recorded usage as returned, without claiming live or complete spending coverage.
 * Null values remain unknown and currencies remain separate. Denied reads suppress supplied rows.
 * Called by: the usage route and the token-usage-summary component stories and tests.
 */
@Component({ selector: "wo-token-usage-summary", standalone: true, imports: [ButtonModule, TableModule, ResourceFeedbackComponent, SectionHeadingComponent], templateUrl: "./token-usage-summary.component.html", styleUrl: "./token-usage-summary.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class TokenUsageSummaryComponent
{
	/** Supplies the usage read state independently of budget reads. */
	public readonly feedback = input.required<GovernanceReadFeedback>();
	/** Supplies formatted rows without a browser-derived aggregate. */
	public readonly rows = input<readonly TokenUsageRowView[]>([]);
	/** Requests another protected usage read. */
	public readonly refreshRequested = output<void>();
	/** Copies readonly rows for the table's mutable array input. */
	protected readonly tableRows = computed(() => [...this.rows()]);
	/** Exposes supported read states to the template. */
	protected readonly states = GovernanceReadStates;
	/** Determines whether returned data may remain visible. */
	protected readonly showData = _CanShowReportingData;
	/** Identifies a read already in progress. */
	protected readonly pending = _IsReportingPending;
	/** Produces failure copy that distinguishes stale and denied reads. */
	protected readonly readError = _ReportingReadError;

	/** Emits refresh without changing or reusing the latest response. */
	protected requestRefresh(): void
	{
		if (!this.pending(this.feedback().state))
			this.refreshRequested.emit();
	}
}
