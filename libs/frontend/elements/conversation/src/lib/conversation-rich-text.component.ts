import { ChangeDetectionStrategy, Component, input } from "@angular/core";

import type { ConversationRichTextPresentation } from "./conversation.types.js";

/**
 * Puts one message's rich body into the transcript, and does nothing else to it.
 *
 * This is the end of the rich-text path rather than a step in it: the template binds the string it
 * is handed straight to `[innerHTML]`, so whoever built that string owns whether it is safe. The
 * only builder today is the workspace mapper, which runs message text through
 * `toSanitizedMarkdownHtml`, or `toStreamingMarkdownHtml` while a message is still arriving. Both
 * live in `@opencrane/state/conversation/render` and end in DOMPurify with an explicit tag and
 * attribute allowlist: raw HTML in the markdown is escaped, images are limited to base64 data URIs,
 * and dangerous link schemes are stripped. That pass is required because the markdown is written by
 * Agents and participants, not by us.
 *
 * Never hand this component Agent output, tool output, or any other server or user string that has
 * not been through that renderer. Angular does sanitize a plain string bound to `innerHTML`, and the
 * value is deliberately never wrapped with `bypassSecurityTrustHtml`, but that framework pass is a
 * backstop and not the contract — the allowlist upstream is what decides what a message may contain.
 *
 * The component is rendered into the message element's `conversation-message-rich-card` slot, so it
 * never owns the row around it.
 *
 * Called by: {@link ConversationWorkspacePageComponent} template, inside each transcript row.
 * @see ConversationRichTextPresentation
 * @see https://github.com/cure53/DOMPurify — the sanitizer the render package finishes with.
 */
@Component({ selector: "wo-conversation-rich-text", standalone: true, templateUrl: "./conversation-rich-text.component.html", styleUrl: "./conversation-rich-text.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationRichTextComponent
{
	/**
	 * The message body to draw: sanitized HTML, the message id it belongs to, and an accessible name.
	 *
	 * Required, because there is nothing sensible to render without it. The parent must have produced
	 * `html` with the conversation render package; passing anything else makes this an injection point.
	 * @see ConversationRichTextPresentation for what each field is used for.
	 */
	public readonly presentation = input.required<ConversationRichTextPresentation>();
}
