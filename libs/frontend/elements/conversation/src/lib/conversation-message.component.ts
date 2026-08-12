import { ChangeDetectionStrategy, Component, input } from "@angular/core";

import { AvatarCircleComponent, AvatarSizes } from "@opencrane/elements/ui";

import type { ConversationMessagePresentation } from "./conversation.types.js";

/** Presentation-only transcript message with a named slot for governed rich cards. */
@Component({ selector: "wo-conversation-message", standalone: true, imports: [AvatarCircleComponent], templateUrl: "./conversation-message.component.html", styleUrl: "./conversation-message.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationMessageComponent
{
	/** Exact display-safe message projection. */
	public readonly message = input.required<ConversationMessagePresentation>();
	/** Compact shared avatar size used by transcript rows. */
	protected readonly avatarSize = AvatarSizes.Small;
}
