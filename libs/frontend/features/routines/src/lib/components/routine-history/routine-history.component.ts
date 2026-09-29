import { ChangeDetectionStrategy, Component, computed, input, output } from "@angular/core";
import { RouterLink } from "@angular/router";
import { ButtonModule } from "primeng/button";
import { TableModule } from "primeng/table";

import { ResourceFeedbackComponent, ScopeChipComponent, SectionHeadingComponent } from "@opencrane/elements/ui";

import { RoutineReadStates, type RoutineHistoryRowView } from "../../routine-presentation.types";

/** Presents authorized firing history without turning result references into new access. */
@Component({ selector: "wo-routine-history", standalone: true, imports: [ButtonModule, ResourceFeedbackComponent, RouterLink, ScopeChipComponent, SectionHeadingComponent, TableModule], templateUrl: "./routine-history.component.html", styleUrl: "./routine-history.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class RoutineHistoryComponent
{
	/** Current firing-history read state. */
	public readonly state = input(RoutineReadStates.Idle);
	/** Authorized firing rows. */
	public readonly rows = input<readonly RoutineHistoryRowView[]>([]);
	/** Whether another opaque cursor is available. */
	public readonly hasMore = input(false);
	/** Whether continuation is pending. */
	public readonly loadingMore = input(false);
	/** Safe history read failure copy. */
	public readonly error = input<string | null>(null);
	/** Safe continuation failure copy. */
	public readonly loadMoreError = input<string | null>(null);
	/** Requests restarting firing history. */
	public readonly refreshRequested = output<void>();
	/** Requests the saved opaque continuation. */
	public readonly loadMoreRequested = output<void>();
	/** Gives the template finite read states. */
	protected readonly states = RoutineReadStates;
	/** Copies rows for PrimeNG's mutable table input. */
	protected readonly tableRows = computed(() => [...this.rows()]);
	/** Reports a first read or refresh in progress. */
	protected readonly loading = computed(() => this.state() === RoutineReadStates.Loading || this.state() === RoutineReadStates.Refreshing);
	/** Allows rows only after an authorized successful history response. */
	protected readonly showRows = computed(() => this.state() === RoutineReadStates.Ready || this.state() === RoutineReadStates.Refreshing || this.state() === RoutineReadStates.RetainedError);

	/** Prevents duplicate history refresh admission. */
	protected refresh(): void
	{
		if (!this.loading() && !this.loadingMore())
			this.refreshRequested.emit();
	}

	/** Prevents duplicate continuation admission. */
	protected loadMore(): void
	{
		if (this.showRows() && this.hasMore() && !this.loading() && !this.loadingMore())
			this.loadMoreRequested.emit();
	}
}
