import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { InputTextModule } from "primeng/inputtext";

import type { ConversationRunActionsPresentation } from "./conversation.types.js";

/** Controlled run-action row that emits intent but owns no run command. */
@Component({ selector: "wo-conversation-run-actions", standalone: true, imports: [ButtonModule, InputTextModule], templateUrl: "./conversation-run-actions.component.html", styleUrl: "./conversation-run-actions.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationRunActionsComponent
{
	/** Exact display-safe lifecycle and action permissions. */
	public readonly presentation = input.required<ConversationRunActionsPresentation>();
	/** Controlled steering draft. */
	public readonly steeringDraft = input("");
	/** Emits every steering-draft edit. */
	public readonly steeringDraftChange = output<string>();
	/** Emits one steering submission intent. */
	public readonly steerRequested = output<void>();
	/** Emits one exact-attempt cancellation intent. */
	public readonly cancelRequested = output<void>();
	/** Emits one failed-attempt retry intent. */
	public readonly retryRequested = output<void>();

	/** Forward one controlled steering draft edit. */
	protected changeDraft(event: Event): void
	{
		const target = event.target;
		if (target instanceof HTMLInputElement) this.steeringDraftChange.emit(target.value);
	}
}
