import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";

import { ConversationActivityKinds, type ConversationActivityRow, type ConversationActivityTarget } from "@opencrane/state/conversation/elicitation";

/** Derived Activity list with explicit canonical deep-link intents. */
@Component({ selector: "wo-conversation-activity", standalone: true, imports: [ButtonModule], templateUrl: "./conversation-activity.component.html", styleUrl: "./conversation-activity.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationActivityComponent
{
	/** Ordered browser-safe derived rows. */
	public readonly rows = input.required<readonly ConversationActivityRow[]>();
	/** Emits canonical coordinates for workspace-owned navigation. */
	public readonly targetRequested = output<ConversationActivityTarget>();
	/** Stable kind enum used by the template. */
	protected readonly kinds = ConversationActivityKinds;
}
