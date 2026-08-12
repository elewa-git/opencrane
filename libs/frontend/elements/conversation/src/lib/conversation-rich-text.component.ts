import { ChangeDetectionStrategy, Component, input } from "@angular/core";

import type { ConversationRichTextPresentation } from "./conversation.types.js";

/** Presentation-only renderer for HTML already sanitized by conversation render state. */
@Component({ selector: "wo-conversation-rich-text", standalone: true, templateUrl: "./conversation-rich-text.component.html", styleUrl: "./conversation-rich-text.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationRichTextComponent
{
	/** Exact display-safe rich-text projection. */
	public readonly presentation = input.required<ConversationRichTextPresentation>();
}
