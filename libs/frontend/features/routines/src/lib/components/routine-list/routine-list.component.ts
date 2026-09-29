import { ChangeDetectionStrategy, Component, computed, input, output } from "@angular/core";
import { RouterLink } from "@angular/router";
import { ButtonModule } from "primeng/button";
import { TableModule } from "primeng/table";

import { ResourceFeedbackComponent, ScopeChipComponent, SectionHeadingComponent, SectionHeadingLevels } from "@opencrane/elements/ui";

import { RoutineReadStates, type RoutineListRowView } from "../../routine-presentation.types";

/** Presents an authorized routine page and emits refresh, continuation and navigation intents. */
@Component({ selector: "wo-routine-list", standalone: true, imports: [ButtonModule, ResourceFeedbackComponent, RouterLink, ScopeChipComponent, SectionHeadingComponent, TableModule], templateUrl: "./routine-list.component.html", styleUrl: "./routine-list.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class RoutineListComponent
{
	/** Current list read state. */
	public readonly state = input(RoutineReadStates.Idle);
	/** Rows adopted from successful authorized pages. */
	public readonly rows = input<readonly RoutineListRowView[]>([]);
	/** Whether another opaque page cursor is available. */
	public readonly hasMore = input(false);
	/** Whether the continuation request is pending. */
	public readonly loadingMore = input(false);
	/** Safe read error copy. */
	public readonly error = input<string | null>(null);
	/** Safe continuation error copy. */
	public readonly loadMoreError = input<string | null>(null);
	/** Requests the first page again. */
	public readonly refreshRequested = output<void>();
	/** Requests the saved opaque continuation. */
	public readonly loadMoreRequested = output<void>();
	/** Gives the template finite read categories. */
	protected readonly states = RoutineReadStates;
	/** Gives the page heading its semantic level. */
	protected readonly headingLevel = SectionHeadingLevels.Page;
	/** Copies the read-only rows for PrimeNG's mutable table input. */
	protected readonly tableRows = computed(() => [...this.rows()]);
	/** Reports reads that should expose a busy state. */
	protected readonly loading = computed(() => this.state() === RoutineReadStates.Loading || this.state() === RoutineReadStates.Refreshing);
	/** Allows retained rows only in states that have an authorized successful value. */
	protected readonly showRows = computed(() => this.state() === RoutineReadStates.Ready || this.state() === RoutineReadStates.Refreshing || this.state() === RoutineReadStates.RetainedError);

	/** Prevents duplicate refresh admission while a list request is pending. */
	protected refresh(): void
	{
		if (!this.loading() && !this.loadingMore())
			this.refreshRequested.emit();
	}

	/** Prevents duplicate continuation admission without interpreting its cursor. */
	protected loadMore(): void
	{
		if (this.showRows() && this.hasMore() && !this.loading() && !this.loadingMore())
			this.loadMoreRequested.emit();
	}
}
