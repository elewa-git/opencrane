import { ChangeDetectionStrategy, Component, computed, effect, inject } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { ButtonModule } from "primeng/button";

import { SectionHeadingComponent, SectionHeadingLevels } from "@opencrane/elements/ui";

import { RoutineDefinitionFormComponent } from "../components/routine-definition-form/routine-definition-form.component";
import { RoutineDetailComponent } from "../components/routine-detail/routine-detail.component";
import { RoutineHistoryComponent } from "../components/routine-history/routine-history.component";
import { RoutineControlActions } from "../routine-presentation.types";
import { RoutineCommandAdmission } from "../state/routine-command-admission";
import { RoutineControlStore } from "../state/routine-control.store";
import { RoutineDetailStore } from "../state/routine-detail.store";
import { RoutineDetailScreenStore } from "../state/routine-detail-screen.store";
import { RoutineEditorStore } from "../state/routine-editor.store";
import { RoutineHistoryStore } from "../state/routine-history.store";
import { _RouteCoordinate } from "./routine-route-coordinate";

/** Coordinates one authorized routine's details, revision, controls, and firing history. */
@Component({ selector: "wo-routine-detail-route", standalone: true, imports: [ButtonModule, RouterLink, RoutineDefinitionFormComponent, RoutineDetailComponent, RoutineHistoryComponent, SectionHeadingComponent], providers: [RoutineCommandAdmission, RoutineControlStore, RoutineDetailScreenStore, RoutineDetailStore, RoutineEditorStore, RoutineHistoryStore], templateUrl: "./routine-detail-route.component.html", styleUrl: "./routine-detail-route.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class RoutineDetailRouteComponent
{
	private readonly _route = inject(ActivatedRoute);
	protected readonly screen = inject(RoutineDetailScreenStore);
	private readonly _params = toSignal(this._route.paramMap, { initialValue: this._route.snapshot.paramMap });
	protected readonly routineId = computed(() => _RouteCoordinate(this._params().get("routineId")));
	private readonly _targetEffect = effect(this._TargetChanged.bind(this));
	protected readonly headingLevel = SectionHeadingLevels.Page;

	/** Exposes finite actions to the template without string control flow. */
	protected readonly actions = RoutineControlActions;

	private _TargetChanged(): void
	{ this.screen.start(this.routineId()); }
}
