import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";

import type { ConversationRunActionsPresentation } from "../conversation.types";

/**
 * Shows current Agent work and offers the original requester one explicit Stop intent.
 *
 * The row renders Stop only when the presentation permits it and emits an intent instead of calling
 * anything. It holds no run state, so it cannot tell whether a command succeeded; the parent adopts
 * authoritative work state and passes a new presentation back in.
 *
 * Run coordinates and retry keys stay in the store. The component never learns a run id or attempt,
 * and `busy` prevents another click while the same command is in flight.
 *
 * Called by: `ConversationWorkspaceComposerComponent`, above its controlled message field.
 * @see ConversationRunActionsPresentation
 */
@Component({ selector: "wo-conversation-run-actions", standalone: true, imports: [ButtonModule, MessageModule], templateUrl: "./conversation-run-actions.component.html", styleUrl: "./conversation-run-actions.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationRunActionsComponent
{
	/**
	 * The work status, optional failure, and finite Stop control state.
	 *
	 * Required: with no run there is nothing for this row to say, so the parent renders it only once it
	 * has a run to describe.
	 * @see ConversationRunActionsPresentation for what each state renders.
	 */
	public readonly presentation = input.required<ConversationRunActionsPresentation>();
	/**
	 * Asks the parent to stop the current work shown in the presentation.
	 *
	 * The parent binds this to a store-owned, retry-stable control message. Emission does not mean the
	 * server accepted the request or that cleanup has finished.
	 */
	public readonly stopRequested = output<void>();
}
