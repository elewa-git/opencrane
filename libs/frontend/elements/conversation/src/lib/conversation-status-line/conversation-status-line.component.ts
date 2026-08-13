import { ChangeDetectionStrategy, Component, input } from "@angular/core";

import type { ConversationStatusPresentation } from "../conversation.types.js";

/** Presentation-only live status row shared by ordinary chats and Agent threads. */
@Component({ selector: "wo-conversation-status-line", standalone: true, templateUrl: "./conversation-status-line.component.html", styleUrl: "./conversation-status-line.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationStatusLineComponent
{
	/** Exact browser-safe status projection. */
	public readonly status = input.required<ConversationStatusPresentation>();
}
