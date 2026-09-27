import { ChangeDetectionStrategy, Component, computed, inject, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { ConfirmationService } from "primeng/api";
import { ConfirmDialogModule } from "primeng/confirmdialog";
import { MessageModule } from "primeng/message";

import { RoutineCommandStates, RoutineControlActions, type RoutineCapabilitiesView } from "../../routine-presentation.types";

/** Presents server-derived routine actions and emits explicit mutation intents. */
@Component({ selector: "wo-routine-controls", standalone: true, imports: [ButtonModule, ConfirmDialogModule, MessageModule], providers: [ConfirmationService], templateUrl: "./routine-controls.component.html", styleUrl: "./routine-controls.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class RoutineControlsComponent
{
	/** Current command hints returned by the authorized detail read. */
	public readonly capabilities = input.required<RoutineCapabilitiesView>();
	/** Current browser command state. */
	public readonly state = input(RoutineCommandStates.Idle);
	/** Saved action retained by the store after an uncertain command result. */
	public readonly retryAction = input<RoutineControlActions | null>(null);
	/** Safe failure copy for the latest command. */
	public readonly error = input<string | null>(null);
	/** Requests opening the controlled revision form. */
	public readonly reviseRequested = output<void>();
	/** Requests pausing future automatic firings. */
	public readonly pauseRequested = output<void>();
	/** Requests resuming future automatic firings. */
	public readonly resumeRequested = output<void>();
	/** Requests permanent retirement after confirmation. */
	public readonly retireRequested = output<void>();
	/** Requests an immediate manual firing. */
	public readonly runNowRequested = output<void>();
	/** Requests retrying the exact saved control action. */
	public readonly retryRequested = output<RoutineControlActions>();
	/** Confirmation owner for the destructive retirement intent. */
	private readonly _confirmation = inject(ConfirmationService);
	/** Gives the template finite command states. */
	protected readonly states = RoutineCommandStates;
	/** Blocks all conflicting actions while one mutation is in flight. */
	protected readonly busy = computed(() => this.state() === RoutineCommandStates.Submitting);
	/** Disables fresh commands while an uncertain or refresh-failed result is resolved. */
	protected readonly actionsLocked = computed(() => this.busy() || this.retryAction() !== null || this.state() === RoutineCommandStates.Uncertain || this.state() === RoutineCommandStates.Conflict || this.state() === RoutineCommandStates.CommittedRefreshFailed);
	/** Labels the PrimeNG dialog wrapper and its icon-only close button. */
	protected readonly confirmationDialogPassThrough =
	{
		host: { "aria-label": "Routine action confirmation" },
		pcCloseButton: { root: { "aria-label": "Close routine confirmation" } }
	};

	/** Confirms permanent scheduling retirement without claiming existing history or effects disappear. */
	protected confirmRetirement(): void
	{
		if (this.actionsLocked() || !this.capabilities().retire)
			return;
		this._confirmation.confirm({ header: "Retire this routine?", message: "Retirement permanently stops new scheduled work. Existing history remains, and work already dispatched cannot be undone.", icon: "pi pi-exclamation-triangle", acceptLabel: "Retire routine", rejectLabel: "Keep routine", acceptButtonProps: { severity: "danger" }, accept: this._EmitRetirement.bind(this) });
	}

	/** Keeps a saved retirement retry behind the same destructive confirmation as a first attempt. */
	protected retrySavedAction(action: RoutineControlActions): void
	{
		if (action === RoutineControlActions.Retire)
		{
			this._confirmation.confirm({ header: "Retry retiring this routine?", message: "OpenCrane could not confirm the earlier retirement request. Confirm to retry the same saved action.", icon: "pi pi-exclamation-triangle", acceptLabel: "Retry retirement", rejectLabel: "Keep routine", acceptButtonProps: { severity: "danger" }, accept: () => this.retryRequested.emit(action) });
			return;
		}

		this.retryRequested.emit(action);
	}

	/** Emits the confirmed retirement intent. */
	private _EmitRetirement(): void { this.retireRequested.emit(); }

	/** Returns the explicit action label shown on the saved retry control. */
	protected actionLabel(action: RoutineControlActions): string
	{
		switch (action)
		{
			case RoutineControlActions.Pause: return "pause";
			case RoutineControlActions.Resume: return "resume";
			case RoutineControlActions.Retire: return "retire";
			case RoutineControlActions.RunNow: return "run now";
		}
	}
}
