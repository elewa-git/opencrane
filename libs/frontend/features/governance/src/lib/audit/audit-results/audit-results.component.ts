import { ChangeDetectionStrategy, Component, computed, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { TableModule } from "primeng/table";

import { ResourceFeedbackComponent, SectionHeadingComponent, SectionHeadingLevels } from "@opencrane/elements/ui";

import { _CanShowReportingData, _IsReportingPending, _ReportingReadError } from "../../reporting/reporting-view";
import { GovernanceReadStates, type GovernanceReadFeedback } from "../../reporting/reporting-view.types";
import type { AuditResultRowView } from "./audit-results-view.types";

/**
 * Presents returned audit entries and emits read intents without fetching or deciding access.
 * Denied states hide every supplied row. Empty filtered pages still offer continuation when the
 * server returned another cursor; the route owns that cursor and request admission.
 * Called by: the audit route and the audit-results component stories and tests.
 */
@Component({ selector: "wo-audit-results", standalone: true, imports: [ButtonModule, TableModule, ResourceFeedbackComponent, SectionHeadingComponent], templateUrl: "./audit-results.component.html", styleUrl: "./audit-results.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class AuditResultsComponent
{
	/** Supplies the audit read state adopted by the owning store. */
	public readonly feedback = input.required<GovernanceReadFeedback>();
	/** Contains display rows; the component hides them after a denied read. */
	public readonly rows = input<readonly AuditResultRowView[]>([]);
	/** Indicates that the server returned a continuation cursor, even for an empty page. */
	public readonly hasMore = input(false);
	/** Indicates that a continuation read is pending. */
	public readonly loadingMore = input(false);
	/** Explains a failed continuation without claiming that later pages are empty. */
	public readonly loadMoreError = input<string | null>(null);
	/** Requests a fresh read; the store owns admission and clearing the cursor. */
	public readonly refreshRequested = output<void>();
	/** Requests the next server cursor; no cursor value is invented by the component. */
	public readonly loadMoreRequested = output<void>();
	/** Copies readonly display rows for the table's mutable array input. */
	protected readonly tableRows = computed(() => [...this.rows()]);
	/** Selects the existing page-heading contract. */
	protected readonly headingLevels = SectionHeadingLevels;
	/** Exposes supported read states to the template. */
	protected readonly states = GovernanceReadStates;
	/** Hides data for denied, unsupported and initial-failure states. */
	protected readonly showData = _CanShowReportingData;
	/** Identifies pending reads without changing store state. */
	protected readonly pending = _IsReportingPending;
	/** Maps feedback to display-safe failure copy. */
	protected readonly readError = _ReportingReadError;

	/** Emits a refresh only when no audit read is pending. */
	protected requestRefresh(): void
	{
		if (!this.pending(this.feedback().state) && !this.loadingMore())
			this.refreshRequested.emit();
	}

	/** Emits continuation only while the displayed response still offers another page. */
	protected requestMore(): void
	{
		if (this.showData(this.feedback().state) && !this.pending(this.feedback().state) && this.hasMore() && !this.loadingMore())
			this.loadMoreRequested.emit();
	}
}
