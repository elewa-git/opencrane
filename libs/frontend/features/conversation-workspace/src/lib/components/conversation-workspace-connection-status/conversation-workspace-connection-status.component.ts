import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";

import { ConversationStatusLineComponent, type ConversationStatusPresentation } from "@opencrane/elements/conversation";

/**
 * Places one conversation connection notice beside its participant-requested reconnect control.
 *
 * Called by: `ConversationWorkspacePageComponent`, which supplies display-safe stream state and
 * owns the reconnect command through `ConversationWorkspaceStore`.
 * @see ConversationStatusLineComponent
 */
@Component({ selector: "wo-conversation-workspace-connection-status", standalone: true, imports: [ButtonModule, ConversationStatusLineComponent], templateUrl: "./conversation-workspace-connection-status.component.html", styleUrl: "./conversation-workspace-connection-status.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationWorkspaceConnectionStatusComponent
{
	/** Status copy and tone derived from the selected conversation stream. */
	public readonly status = input.required<ConversationStatusPresentation>();
	/** Whether this state lets the participant replace the existing socket. */
	public readonly reconnectAvailable = input(false);
	/** Whether a participant-requested replacement socket is still opening. */
	public readonly reconnectPending = input(false);
	/** Reports the participant's reconnect request to the workspace page. */
	public readonly reconnectRequested = output<void>();

	/** Emit a reconnect intent only while the store has admitted the action. */
	protected requestReconnect(): void
	{
		if (!this.reconnectAvailable() || this.reconnectPending()) return;
		this.reconnectRequested.emit();
	}
}
