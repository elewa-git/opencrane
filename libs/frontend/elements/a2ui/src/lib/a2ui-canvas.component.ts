import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { MessageProcessor, Surface, type A2UIClientEvent } from "@a2ui/angular/v0_8";

import { _ParseA2uiMessages } from "./a2ui-message.util";

/**
 * Renders an A2UI canvas payload in-process (v0.8 dialect) using our themed catalog, and emits
 * user actions back out so the host can return them to the agent (the A2UI return path).
 *
 * Each instance owns its own {@link MessageProcessor} (component-scoped provider) so surfaces
 * from one canvas never leak into another. The payload may be JSONL, a JSON array, or already
 * parsed — {@link _ParseA2uiMessages} handles all three. Requires {@link provideOpenCraneA2ui} at the
 * app level (catalog + theme + markdown renderer).
 */
@Component({
	selector: "wo-a2ui-canvas",
	standalone: true,
	imports: [Surface],
	providers: [MessageProcessor],
	template: `@for (id of surfaceIds(); track id) {
		<a2ui-surface [surfaceId]="id" />
	}`,
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class A2uiCanvasComponent
{
	/** A2UI transport payload: JSONL, a JSON array, or already-parsed action objects. */
	public readonly payload = input.required<unknown>();

	/** Emits each user action (button press, field change, …) for return to the agent. */
	public readonly userAction = output<A2UIClientEvent>();

	private readonly _processor = inject(MessageProcessor);

	/** Live surface ids to render; recomputes when the processor's version signal ticks. */
	public readonly surfaceIds = computed<string[]>(() =>
	{
		this._processor.version();
		return [...this._processor.getSurfaces().keys()];
	});

	public constructor()
	{
		// Feed parsed messages into the processor whenever the payload input changes.
		effect(() =>
		{
			const messages = _ParseA2uiMessages(this.payload());
			if (messages.length > 0)
			{
				this._processor.processMessages(messages);
			}
		});
		// Surface user actions to the host (which returns them to the agent).
		this._processor.events.pipe(takeUntilDestroyed()).subscribe((event) => this.userAction.emit(event));
	}
}
