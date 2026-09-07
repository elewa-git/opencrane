import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";

import { GroupChildStates, type GroupChildView } from "@opencrane/models/conversations";

/** Displays explicit assistant actions and child creation progress beneath a conversation message. */
@Component({ selector: "wo-conversation-group-message-actions", standalone: true, imports: [ButtonModule], templateUrl: "./conversation-group-message-actions.component.html", styleUrl: "./conversation-group-message-actions.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationGroupMessageActionsComponent
{
	/** Allows a request when the feature identifies the current person's eligible group message. */
	public readonly canAsk = input(false);
	/** Allows review when the feature identifies a completed assistant response in a child. */
	public readonly canShare = input(false);
	/** Shows currently authorized children originating from this message. */
	public readonly children = input<readonly GroupChildView[]>([]);
	/** Requests the feature-owned company assistant picker. */
	public readonly askRequested = output<void>();
	/** Requests the feature-owned human share review. */
	public readonly shareRequested = output<void>();
	/** Requests normal workspace navigation to a ready child. */
	public readonly childRequested = output<string>();
	/** Distinguishes saved creation progress from the assistant's eventual work result. */
	protected readonly states = GroupChildStates;
}
