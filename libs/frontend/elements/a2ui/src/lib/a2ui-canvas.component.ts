import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, effect, inject, signal } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { MessageProcessor, Surface, type A2UIClientEvent } from "@a2ui/angular/v0_8";

import { AgUiA2uiSurfaceStates } from "@opencrane/contracts";

import { _ToA2uiDisplayedActionIntent } from "./a2ui-action-intent.js";
import { _AdmitA2uiSurfacePresentation, _ToPinnedA2uiOperations } from "./a2ui-admission.js";
import type { A2uiDisplayedActionIntent, A2uiSurfacePresentation } from "./a2ui.types.js";

/** Human-readable labels for every finite presentation lifecycle. */
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
 * Render one display-safe A2UI surface and emit only server-authorizable displayed action intents.
 *
 * Each instance owns a vendor message processor. It accepts one typed presentation, preserves the
 * supplied operation order, ignores duplicate or stale sequences, and keeps stable component ids in
 * place so progressive updates preserve focus. It never exposes the upstream completion subject,
 * client timestamp, raw protocol event, or arbitrary payload.
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

	/** Displayed action intent for the authenticated host; this output carries no authority itself. */
	@Output() public readonly displayedAction = new EventEmitter<A2uiDisplayedActionIntent>();

	/** Adopt the host's latest projected presentation into the monotonic display boundary. */
	@Input({ required: true }) public set presentation(presentation: A2uiSurfacePresentation)
	{
		this._projectedPresentation.set(presentation);
	}

	/** Component-scoped upstream processor that prevents surfaces leaking across canvas instances. */
	private readonly _processor = inject(MessageProcessor);

	/** Whether the latest envelope or its vendor operation shape failed closed. */
	private readonly _rejected = signal(false);

	/** Latest monotonic presentation actually adopted for the stable coordinate identity. */
	private readonly _adoptedPresentation = signal<A2uiSurfacePresentation | null>(null);

	/** Stable identity of the presentation currently held by this component instance. */
	private _presentationIdentity: string | null = null;

	/** Highest sequence adopted for the current stable presentation identity. */
	private _lastSequence = -1;

	/** Number of materialized operations already applied to the current vendor surface. */
	private _appliedOperationCount = 0;

	/** Monotonic presentation used by both rendering and displayed-action intent mapping. */
	protected readonly currentPresentation = computed(function _CurrentPresentation(this: A2uiCanvasComponent): A2uiSurfacePresentation
	{
		const presentation = this._adoptedPresentation() ?? this._projectedPresentation();
		if (presentation === null)
		{
			throw new Error("A2UI canvas requires a projected presentation");
		}
		return presentation;
	}.bind(this));

	/** Current finite lifecycle label announced to assistive technology. */
	protected readonly stateLabel = computed(function _StateLabel(this: A2uiCanvasComponent): string
	{
		return _STATE_LABELS[this.currentPresentation().state];
	}.bind(this));

	/** Whether a vendor surface is ready and the envelope passed the local display admission check. */
	protected readonly showSurface = computed(function _ShowSurface(this: A2uiCanvasComponent): boolean
	{
		this._processor.version();
		const presentation = this.currentPresentation();
		return !this._rejected() && presentation.state !== AgUiA2uiSurfaceStates.Unsupported && this._processor.getSurfaces().has(presentation.surfaceId);
	}.bind(this));

	/** Whether the surface must expose a safe placeholder without echoing rejected payload details. */
	protected readonly showUnsupported = computed(function _ShowUnsupported(this: A2uiCanvasComponent): boolean
	{
		return this._rejected() || this.currentPresentation().state === AgUiA2uiSurfaceStates.Unsupported;
	}.bind(this));

	/** Whether interaction is locally enabled; only the server-projected ready state admits intent. */
	protected readonly interactive = computed(function _Interactive(this: A2uiCanvasComponent): boolean
	{
		return !this._rejected() && this.currentPresentation().state === AgUiA2uiSurfaceStates.Ready;
	}.bind(this));

	/** Whether the current visual lifecycle is waiting on progressive data or server admission. */
	protected readonly busy = computed(function _Busy(this: A2uiCanvasComponent): boolean
	{
		const state = this.currentPresentation().state;
		return state === AgUiA2uiSurfaceStates.Streaming || state === AgUiA2uiSurfaceStates.ActionPending;
	}.bind(this));

	/** Optional display-safe lifecycle explanation, suppressed for rejected/unsupported payloads. */
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

	/** Adopt one new monotonic presentation sequence without rebuilding stable component identity. */
	private _adoptPresentation(presentation: A2uiSurfacePresentation): void
	{
		// 1. Reset vendor state only when the authoritative display coordinates select a different
		// surface; normal progressive updates retain the existing component tree and browser focus.
		const identity = `${presentation.conversationId}\u0000${presentation.runId}\u0000${presentation.messageId}\u0000${presentation.surfaceId}`;
		if (identity !== this._presentationIdentity)
		{
			this._processor.clearSurfaces();
			this._presentationIdentity = identity;
			this._lastSequence = -1;
			this._appliedOperationCount = 0;
		}

		// 2. Ignore duplicate and stale delivery because the state layer will replay a newer canonical
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
			this._processor.processMessages(_ToPinnedA2uiOperations(pending));
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

	/** Emit the narrow displayed intent and settle the upstream local completion channel. */
	private _handleRendererEvent(event: A2UIClientEvent): void
	{
		// 1. Map from the exact current presentation so stale, non-ready, or unbounded vendor events
		// cannot escape through this element's public output.
		const intent = _ToA2uiDisplayedActionIntent(this.currentPresentation(), event);
		if (intent !== null)
		{
			this.displayedAction.emit(intent);
		}

		// 2. Resolve the vendor-local promise with no server messages. Authoritative responses arrive
		// later as a new typed presentation; the completion Subject itself never leaves this package.
		event.completion.next([]);
		event.completion.complete();
	}
}
