import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { InputTextModule } from "primeng/inputtext";

import type { ConversationRunActionsPresentation } from "./conversation.types.js";

/**
 * Shows what an Agent run is doing and offers the participant the actions currently allowed on it:
 * steer, cancel, retry.
 *
 * The row renders only the controls the presentation permits — the steering field, Cancel run, and
 * Retry run each appear behind their own flag — and every control emits an intent instead of calling
 * anything. It holds no run state, so it cannot tell whether a command succeeded; the parent adopts
 * the run projection its store returns and passes a new presentation back in.
 *
 * A parent must keep two things straight when wiring it. The run coordinates stay in the store: the
 * component never learns the run id or attempt number, which is how cancel and retry stay tied to the
 * attempt the participant was actually looking at. And every output can fire again as soon as the
 * previous command finishes, so `busy` in the presentation is what stops a double submit.
 *
 * Called by: {@link ConversationWorkspacePageComponent} template, above the composer.
 * @see ConversationRunActionsPresentation
 */
@Component({ selector: "wo-conversation-run-actions", standalone: true, imports: [ButtonModule, InputTextModule], templateUrl: "./conversation-run-actions.component.html", styleUrl: "./conversation-run-actions.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationRunActionsComponent
{
	/**
	 * The run status label plus the four flags that decide which controls exist and whether they react.
	 *
	 * Required: with no run there is nothing for this row to say, so the parent renders it only once it
	 * has a run to describe.
	 * @see ConversationRunActionsPresentation for what each flag turns on.
	 */
	public readonly presentation = input.required<ConversationRunActionsPresentation>();
	/**
	 * The steering text to display. The parent owns it, so this component keeps no copy: it shows what
	 * it is given and reports edits through {@link steeringDraftChange}. A parent that ignores those
	 * edits will render a field the user cannot type in.
	 */
	public readonly steeringDraft = input("");
	/**
	 * Fires on every keystroke in the steering field with the field's whole value.
	 *
	 * The parent must store it and pass it back as `steeringDraft`, which is also what makes the Steer
	 * button enable itself once the text is non-empty.
	 */
	public readonly steeringDraftChange = output<string>();
	/**
	 * Asks the parent to send the steering text the participant can currently see.
	 *
	 * No payload is carried, so the parent must submit the draft it holds. It is also the parent's job
	 * to clear that draft once the store accepts the instruction; this row will keep displaying it.
	 */
	public readonly steerRequested = output<void>();
	/**
	 * Asks the parent to cancel the run attempt shown in the current presentation.
	 *
	 * The parent's store sends the attempt number it has for that run, so a newer attempt started
	 * elsewhere is not cancelled by a stale click. Cancelling stops further work but cleanup of the
	 * underlying job can still be owed when the projection comes back.
	 */
	public readonly cancelRequested = output<void>();
	/**
	 * Asks the parent to start a new attempt for a run that failed.
	 *
	 * The parent has to supply the conversation the run belongs to, the attempt it expects to replace,
	 * and a fresh idempotency key — none of which this row knows — so it cannot be wired to a bare
	 * retry call.
	 */
	public readonly retryRequested = output<void>();

	/**
	 * Reports one steering-field edit upward so the parent can keep owning the text.
	 *
	 * The `input` event is typed with `target: EventTarget | null`, so the check both narrows the type
	 * and ignores an event that bubbled up from something other than the field.
	 */
	protected changeDraft(event: Event): void
	{
		const target = event.target;
		if (target instanceof HTMLInputElement) this.steeringDraftChange.emit(target.value);
	}
}
