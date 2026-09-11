import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";
import { ConversationComposerComponent, ConversationComposerStates, ConversationRunActionsComponent, type ConversationRunActionsPresentation, type ConversationStatusPresentation } from "@opencrane/elements/conversation";
import type { ConversationWorkspaceConnectionPresentation } from "../../presentation/conversation-workspace-presentation.types";
import { ConversationWorkspaceConnectionStatusComponent } from "../conversation-workspace-connection-status/conversation-workspace-connection-status.component";

/** Composes controlled message input with group, connection and computer feedback. */
@Component({ selector: "wo-conversation-workspace-composer", standalone: true, imports: [ButtonModule, MessageModule, ConversationComposerComponent, ConversationRunActionsComponent, ConversationWorkspaceConnectionStatusComponent], templateUrl: "./conversation-workspace-composer.component.html", styleUrl: "./conversation-workspace-composer.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationWorkspaceComposerComponent
{
	/** Unsaved participant text held by the conversation store. */
	public readonly draft = input("");
	/** Admitted composer interaction state. */
	public readonly composerState = input(ConversationComposerStates.Disabled);
	/** Last ordinary conversation command failure. */
	public readonly error = input<string | null>(null);
	/** Last group request failure. */
	public readonly groupError = input<string | null>(null);
	/** Whether assistant request state can be refreshed. */
	public readonly groupRefreshAvailable = input(false);
	/** Whether an assistant request refresh is pending. */
	public readonly groupRefreshing = input(false);
	/** Display-safe logical computer status. */
	public readonly computerStatus = input<ConversationStatusPresentation | null>(null);
	/** Display-safe connection status and reconnect availability. */
	public readonly connectionStatus = input<ConversationWorkspaceConnectionPresentation | null>(null);
	/** Whether a requested replacement connection is pending. */
	public readonly reconnectPending = input(false);
	/** Current personal work state and Stop availability, or null outside supported personal work. */
	public readonly runActions = input<ConversationRunActionsPresentation | null>(null);
	/** Reports an edit to the store-owned draft. */
	public readonly draftChanged = output<string>();
	/** Requests sending participant text. */
	public readonly submitted = output<void>();
	/** Requests refreshing group assistant state. */
	public readonly groupRefreshRequested = output<void>();
	/** Requests a replacement connection. */
	public readonly reconnectRequested = output<void>();
	/** Reports the original requester's explicit Stop intent. */
	public readonly stopRequested = output<void>();
}
