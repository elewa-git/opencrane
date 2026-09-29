import { ChangeDetectionStrategy, Component, inject } from "@angular/core";

import { RoutineListComponent } from "../components/routine-list/routine-list.component";
import { RoutineListStore } from "../state/routine-list.store";

/** Connects the routine list presenter to its route-scoped read owner. */
@Component({ selector: "wo-routine-list-route", standalone: true, imports: [RoutineListComponent], providers: [RoutineListStore], templateUrl: "./routine-list-route.component.html", changeDetection: ChangeDetectionStrategy.OnPush })
export class RoutineListRouteComponent
{
	/** Route-scoped list state exposed to the template. */
	protected readonly store = inject(RoutineListStore);
}
