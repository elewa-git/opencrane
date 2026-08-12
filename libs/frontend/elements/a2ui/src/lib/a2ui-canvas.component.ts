import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, effect, inject, signal } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { MessageProcessor, Surface, type A2UIClientEvent } from "@a2ui/angular/v0_8";

import { AgUiA2uiSurfaceStates } from "@opencrane/contracts";

import { _ToA2uiDisplayedActionIntent } from "./a2ui-action-intent.js";
import { _AdmitA2uiSurfacePresentation } from "./a2ui-admission.js";
import type { A2uiDisplayedActionIntent, A2uiSurfacePresentation } from "./a2ui.types.js";

/** The label shown for each surface state. */
const _STATE_LABELS: Readonly<Record<AgUiA2uiSurfaceStates, string>> =
{
	[AgUiA2uiSurfaceStates.Streaming]: "Streaming",
	[AgUiA2uiSurfaceStates.Ready]: "Ready",
	[AgUiA2uiSurfaceStates.ActionPending]: "Action pending",
	[AgUiA2uiSurfaceStates.Submitted]: "Submitted",
	[AgUiA2uiSurfaceStates.ValidationError]: "Validation error",
	[AgUiA2uiSurfaceStates.ActionFailed]: "Action failed",
	[AgUiA2uiSurfaceStates.Expired]: "Expired",
	[AgUiA2uiSurfaceStates.AlreadyUsed]: "Already used",
	[AgUiA2uiSurfaceStates.Unauthorized]: "Unauthorized",
	[AgUiA2uiSurfaceStates.Unsupported]: "Unsupported"
};

/**
 * Renders one A2UI surface sent by the server, and reports user actions back as intents.
 *
 * Use this wherever an agent needs to put a real form in front of the user. The host owns all the
 * state: it passes the latest {@link A2uiSurfacePresentation} into `presentation`, listens on
 * `displayedAction`, and sends what it receives to the server. Nothing here decides whether an
 * action is allowed — the emitted {@link A2uiDisplayedActionIntent} carries no authority, and the
 * server re-checks it.
 *
 * What each instance does:
 * - owns its own vendor `MessageProcessor`, so two canvases never see each other's surfaces;
 * - applies the presentation's operations in the order given;
 * - ignores a sequence it has already applied, or one older than the current one;
 * - reuses component ids across updates, so a streaming update does not steal keyboard focus;
 * - shows a placeholder that repeats nothing from the payload if admission or the vendor rejects
 *   the presentation.
 *
 * It never passes on the vendor's completion Subject, its client timestamp, the raw protocol
 * event, or any value outside the scalars listed in {@link A2uiDisplayedActionIntent}.
 *
 * Rendered by: no production parent yet — only a2ui-canvas.component.spec.ts and
 * a2ui-canvas.component.stories.ts. A host must also provide the markdown sanitizer and the
 * catalogue from a2ui.providers.ts.
 *
 * Inputs: `presentation` (required). Outputs: `displayedAction`.
 *
 * @see A2uiSurfacePresentation
 * @see A2uiDisplayedActionIntent
 * @see _AdmitA2uiSurfacePresentation
 * @see A2UI v0.8 specification — the surface, operation and component shapes this renders:
 *   https://a2ui.org/specification/v0.8-a2ui/
 * @see AG-UI protocol docs — where the presentation comes from upstream: https://docs.ag-ui.com
 */
@Component({
	selector: "wo-a2ui-canvas",
	standalone: true,
	imports: [Surface],
	providers: [MessageProcessor],
	templateUrl: "./a2ui-canvas.component.html",
	styleUrl: "./a2ui-canvas.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class A2uiCanvasComponent
{
	/** Exact server projection supplied through Angular's runtime-visible TestBed input metadata. */
	private readonly _projectedPresentation = signal<A2uiSurfacePresentation | null>(null);

	/**
	 * Fires when the user activates an action on the surface.
	 *
	 * The host must forward the intent to the server, which decides whether to act on it. The intent
	 * itself grants nothing: it is a report that a button was pressed, tied to the ids of the
	 * presentation it was displayed on. Nothing is emitted unless the surface state is Ready.
	 *
	 * @see A2uiDisplayedActionIntent
	 */
	@Output() public readonly displayedAction = new EventEmitter<A2uiDisplayedActionIntent>();

	/**
	 * The latest presentation from the host. Required.
	 *
	 * Set this on every update; the component works out itself whether anything changed. A
	 * presentation whose `sequence` is not higher than the one already applied is ignored, so
	 * re-setting the same value is harmless.
	 *
	 * @param presentation - The surface to display, as sent by the server.
	 */
	@Input({ required: true }) public set presentation(presentation: A2uiSurfacePresentation)
	{
		this._projectedPresentation.set(presentation);
	}

	/** This instance's own vendor MessageProcessor, so two canvases never share surfaces. */
	private readonly _processor = inject(MessageProcessor);

	/** Whether the latest presentation was rejected, either by the admission check or by the vendor. */
	private readonly _rejected = signal(false);

	/** The latest presentation actually applied, for the identity this instance currently holds. */
	private readonly _adoptedPresentation = signal<A2uiSurfacePresentation | null>(null);

	/** Stable identity of the presentation currently held by this component instance. */
	private _presentationIdentity: string | null = null;

	/** Highest sequence adopted for the current stable presentation identity. */
	private _lastSequence = -1;

	/** How many operations have already been applied to the current vendor surface. */
	private _appliedOperationCount = 0;

	/** The presentation the template renders and that action intents are built from. */
	protected readonly currentPresentation = computed(function _CurrentPresentation(this: A2uiCanvasComponent): A2uiSurfacePresentation
	{
		const presentation = this._adoptedPresentation() ?? this._projectedPresentation();
		if (presentation === null)
		{
			throw new Error("A2UI canvas requires a projected presentation");
		}
		return presentation;
	}.bind(this));

	/** The current state's label, announced to screen readers. */
	protected readonly stateLabel = computed(function _StateLabel(this: A2uiCanvasComponent): string
	{
		return _STATE_LABELS[this.currentPresentation().state];
	}.bind(this));

	/** Whether the vendor has built the surface and the presentation passed the admission check. */
	protected readonly showSurface = computed(function _ShowSurface(this: A2uiCanvasComponent): boolean
	{
		this._processor.version();
		const presentation = this.currentPresentation();
		return !this._rejected() && presentation.state !== AgUiA2uiSurfaceStates.Unsupported && this._processor.getSurfaces().has(presentation.surfaceId);
	}.bind(this));

	/** Whether to show the placeholder instead, which never repeats anything from a rejected payload. */
	protected readonly showUnsupported = computed(function _ShowUnsupported(this: A2uiCanvasComponent): boolean
	{
		return this._rejected() || this.currentPresentation().state === AgUiA2uiSurfaceStates.Unsupported;
	}.bind(this));

	/** Whether controls are enabled here; only the server's Ready state allows an action. */
	protected readonly interactive = computed(function _Interactive(this: A2uiCanvasComponent): boolean
	{
		return !this._rejected() && this.currentPresentation().state === AgUiA2uiSurfaceStates.Ready;
	}.bind(this));

	/** Whether the surface is waiting on streaming data or on the server to accept an action. */
	protected readonly busy = computed(function _Busy(this: A2uiCanvasComponent): boolean
	{
		const state = this.currentPresentation().state;
		return state === AgUiA2uiSurfaceStates.Streaming || state === AgUiA2uiSurfaceStates.ActionPending;
	}.bind(this));

	/** The reason text for the current state, when it is safe to show; hidden for rejected or unsupported payloads. */
	protected readonly visibleReason = computed(function _VisibleReason(this: A2uiCanvasComponent): string | null
	{
		if (this.showUnsupported())
		{
			return null;
		}
		return this.currentPresentation().reason ?? null;
	}.bind(this));

	public constructor()
	{
		const component = this;
		effect(function _AdoptProjectedPresentation(): void
		{
			const presentation = component._projectedPresentation();
			if (presentation !== null)
			{
				component._adoptPresentation(presentation);
			}
		});
		this._processor.events.pipe(takeUntilDestroyed()).subscribe(function _ForwardDisplayedAction(event: A2UIClientEvent): void
		{
			component._handleRendererEvent(event);
		});
	}

	/**
	 * Apply one presentation, keeping the existing component tree wherever possible.
	 *
	 * Runs from the constructor `effect` whenever `presentation` is set. Four cases, in order:
	 * a different surface resets the vendor state; a sequence at or below the current one is
	 * dropped; a presentation that fails admission clears the surface and shows the placeholder;
	 * anything else has only its new operations handed to the vendor. A vendor throw is caught and
	 * becomes the same placeholder, never an Angular error.
	 *
	 * @param presentation - The presentation to apply.
	 */
	private _adoptPresentation(presentation: A2uiSurfacePresentation): void
	{
		// 1. Reset vendor state only when the server's ids point at a different
		// surface; normal progressive updates retain the existing component tree and browser focus.
		const identity = `${presentation.conversationId}\u0000${presentation.runId}\u0000${presentation.messageId}\u0000${presentation.surfaceId}`;
		if (identity !== this._presentationIdentity)
		{
			this._processor.clearSurfaces();
			this._presentationIdentity = identity;
			this._lastSequence = -1;
			this._appliedOperationCount = 0;
		}

		// 2. Ignore a repeat or an older delivery, because the state layer will send a newer
		// projection; processing old operations could regress visible data or rebuild focused controls.
		if (presentation.sequence <= this._lastSequence)
		{
			return;
		}
		this._lastSequence = presentation.sequence;

		// 3. Fail closed before the vendor processor sees an unknown component, foreign surface id, or
		// malformed operation envelope. Unsupported content never appears in the placeholder.
		if (presentation.state === AgUiA2uiSurfaceStates.Unsupported || presentation.operations.length < this._appliedOperationCount || !_AdmitA2uiSurfacePresentation(presentation))
		{
			this._processor.clearSurfaces();
			this._appliedOperationCount = 0;
			this._adoptedPresentation.set(presentation);
			this._rejected.set(true);
			return;
		}

		// 4. Let the pinned upstream schema validate component properties and data updates. Any vendor
		// rejection becomes the same non-disclosing unsupported state instead of an Angular error.
		try
		{
			const pending = presentation.operations.slice(this._appliedOperationCount);
			this._processor.processMessages(pending);
			this._appliedOperationCount = presentation.operations.length;
			this._adoptedPresentation.set(presentation);
			this._rejected.set(false);
		}
		catch
		{
			this._processor.clearSurfaces();
			this._appliedOperationCount = 0;
			this._adoptedPresentation.set(presentation);
			this._rejected.set(true);
		}
	}

	/**
	 * Turn one vendor renderer event into an emitted intent, then close the vendor's promise.
	 *
	 * Subscribed in the constructor for the lifetime of the component. The vendor waits on
	 * `event.completion`; it is completed with an empty array because the server replies later as a
	 * new presentation, never through this channel. Events that map to null (not Ready, wrong
	 * surface, an input/change event, an over-large payload) emit nothing but still complete.
	 *
	 * @param event - The vendor's client event.
	 */
	private _handleRendererEvent(event: A2UIClientEvent): void
	{
		// 1. Map from the exact current presentation so stale, non-ready, or unbounded vendor events
		// cannot escape through this element's public output.
		const intent = _ToA2uiDisplayedActionIntent(this.currentPresentation(), event);
		if (intent !== null)
		{
			this.displayedAction.emit(intent);
		}

		// 2. Resolve the vendor's local promise with no server messages. The server's responses arrive
		// later as a new typed presentation; the completion Subject itself never leaves this package.
		event.completion.next([]);
		event.completion.complete();
	}
}
