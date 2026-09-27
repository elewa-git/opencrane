import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { ButtonModule } from "primeng/button";

import { ResourceFeedbackComponent, SectionHeadingComponent, SectionHeadingLevels } from "@opencrane/elements/ui";
import { ROUTINE_SESSION } from "@opencrane/state/routines";

import { RoutineDefinitionFormComponent } from "../components/routine-definition-form/routine-definition-form.component";
import { RoutineEditorModes, RoutineReadStates, RoutineSubmitOutcomes } from "../routine-presentation.types";
import { RoutineEditorStore } from "../state/routine-editor.store";
import { RoutineCommandAdmission } from "../state/routine-command-admission";
import { _RouteCoordinate } from "./routine-route-coordinate";

/** Coordinates chat-bound routine creation without accepting a typed destination identifier. */
@Component({ selector: "wo-routine-create-route", standalone: true, imports: [ButtonModule, ResourceFeedbackComponent, RouterLink, RoutineDefinitionFormComponent, SectionHeadingComponent], providers: [RoutineCommandAdmission, RoutineEditorStore], templateUrl: "./routine-create-route.component.html", styleUrl: "./routine-create-route.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class RoutineCreateRouteComponent
{
	private readonly _route = inject(ActivatedRoute);
	private readonly _router = inject(Router);
	private readonly _session = inject(ROUTINE_SESSION);
	private readonly _destroyRef = inject(DestroyRef);
	protected readonly store = inject(RoutineEditorStore);
	private readonly _query = toSignal(this._route.queryParamMap, { initialValue: this._route.snapshot.queryParamMap });
	protected readonly destination = computed(this._Destination.bind(this));
	private _generation = 0;
	private readonly _destinationEffect = effect(this._DestinationChanged.bind(this));
	protected readonly states = RoutineReadStates;
	protected readonly headingLevel = SectionHeadingLevels.Page;

	public constructor() { this._destroyRef.onDestroy(this._Destroyed.bind(this)); }

	/** Submits or explicitly retries the exact retained creation command. */
	protected async submit(): Promise<void>
	{
		const generation = this._generation;
		const session = this._session();
		const destination = this.destination();
		const result = await this.store.submitCreate();
		if (generation === this._generation && session === this._session() && destination === this.destination() && result.outcome === RoutineSubmitOutcomes.Committed && result.routineId !== undefined)
			await this._router.navigate(["/routines", result.routineId]);
	}

	/** Returns to the originating chat when it remains a valid opaque coordinate. */
	protected async cancel(): Promise<void>
	{
		const destination = this.destination();
		await this._router.navigate(destination === null ? ["/routines"] : ["/chats", destination]);
	}

	private _Destination(): string | null
	{
		const values = this._query().getAll("destination");
		return values.length === 1 ? _RouteCoordinate(values[0] ?? null) : null;
	}

	private _DestinationChanged(): void { this._generation += 1; this.store.startCreate(this.destination()); }

	private _Destroyed(): void { this._generation += 1; }
}
