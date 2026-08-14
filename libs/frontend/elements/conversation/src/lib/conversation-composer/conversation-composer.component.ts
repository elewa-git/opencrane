import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { TextareaModule } from "primeng/textarea";

import { ConversationComposerStates } from "../conversation.types.js";

/**
 * The message box at the bottom of a conversation: it displays a draft the parent owns and reports
 * edits and send requests back.
 *
 * The composer keeps no state of its own. Whatever `draft` says is what the textarea shows, and every
 * keystroke leaves as {@link draftChange} — so a parent that does not store those edits renders a box
 * the user cannot type in. It also never decides whether sending is allowed: `state` does that, and
 * the parent recomputes it from its own store.
 *
 * The template offers two content slots for a parent that needs more than text —
 * `conversation-composer-leading` above the field and `conversation-composer-footer` beside the send
 * button — but no parent fills them yet. The workspace page keeps its attachment tray as a sibling in
 * the page footer instead, which is exactly why the composer cannot see the attachments and needs
 * {@link allowEmptySubmission} to be told they exist.
 *
 * Called by: {@link ConversationWorkspacePageComponent} template (workspace message box) and
 * {@link AgentThreadPageComponent} template (Agent-thread follow-up box).
 * @see ConversationComposerStates for the three states a parent may put it in.
 */
@Component({ selector: "wo-conversation-composer", standalone: true, imports: [ButtonModule, TextareaModule], templateUrl: "./conversation-composer.component.html", styleUrl: "./conversation-composer.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationComposerComponent
{
	/**
	 * The text to show in the textarea. The parent owns it; this component never writes to it, so the
	 * parent must adopt {@link draftChange} for typing to appear.
	 */
	public readonly draft = input("");
	/**
	 * Whether the box is editable, mid-send, or refusing input.
	 *
	 * It gates both the textarea and the send button, and {@link submitted} fires in no state other
	 * than `Available`.
	 * @see ConversationComposerStates
	 */
	public readonly state = input<ConversationComposerStates>(ConversationComposerStates.Available);
	/** Grey hint text in the empty field. Override it when the surrounding screen makes a more specific ask than "write a message". */
	public readonly placeholder = input("Write a message…");
	/** Visible label above the field, which is also its accessible name. Both pages replace the default so the field says which conversation it writes to. */
	public readonly label = input("Message");
	/**
	 * The `id` put on the textarea and referenced by its label.
	 *
	 * Override it whenever a screen can show two composers, because duplicate ids would point both
	 * labels at the same field. Both current parents pass their own value for that reason.
	 */
	public readonly fieldId = input("conversation-composer-field");
	/**
	 * Lets the participant send with the text field empty, because the parent has other content to send.
	 *
	 * A message may consist of attachments alone, and the composer cannot see them: they live in the
	 * parent's asset store and are rendered outside this component. The workspace page therefore sets
	 * this while at least one file is selected for the next message; without it the send button stays
	 * disabled and an attachment-only message can never leave.
	 * @see conversation-elements.spec.ts — "allows an empty text submission only when the host has non-text content".
	 */
	public readonly allowEmptySubmission = input(false);
	/** Fires on every keystroke with the whole field value. The parent stores it and passes it back as `draft`; nothing is sent yet. */
	public readonly draftChange = output<string>();
	/**
	 * Asks the parent to send the draft, carrying the text as it was displayed.
	 *
	 * It fires when the form is submitted — the send button is the form's submit button — and on
	 * Ctrl+Enter or Command+Enter, but only while `state` is `Available`. The text can be an empty string
	 * when {@link allowEmptySubmission} is set, so a parent must not treat the payload as non-empty. Both
	 * parents ignore the payload and send the draft from their own store instead, which is what keeps
	 * text and attachments in one command.
	 */
	public readonly submitted = output<string>();
	/** Gives the template the composer states so it can compare against members instead of raw strings. */
	protected readonly states = ConversationComposerStates;

	/**
	 * Reports one textarea edit upward so the parent stays the owner of the draft.
	 *
	 * The `input` event is typed with `target: EventTarget | null`, so the check both narrows the type
	 * and ignores an event that bubbled up from something other than the textarea.
	 */
	protected changeDraft(event: Event): void
	{
		const target = event.target;
		if (target instanceof HTMLTextAreaElement) this.draftChange.emit(target.value);
	}

	/**
	 * Sends on Ctrl+Enter or Command+Enter and leaves plain Enter to insert a new line.
	 *
	 * A conversation message is often several lines, so plain Enter must stay a line break; the modifier
	 * is what turns the keystroke into a send. `preventDefault` stops the browser also inserting that
	 * newline before the send.
	 */
	protected handleKeydown(event: KeyboardEvent): void
	{
		if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;
		event.preventDefault();
		this.submit();
	}

	/**
	 * Turns a send gesture into a {@link submitted} emission when the parent allows one.
	 *
	 * Both refusals are silent, because the template already disables the send button in the same
	 * cases; this repeats the checks so a keyboard shortcut or a stray form submit cannot slip past them.
	 */
	protected submit(): void
	{
		// 1. Refuse in any state but Available: Submitting means the parent's send is still out, and
		// re-emitting there would send the same message twice.
		if (this.state() !== ConversationComposerStates.Available) return;

		// 2. Require something to send — text, or content the parent holds and we cannot see, such as
		// selected attachments. Emit the draft as displayed, empty string included.
		if (this.draft().trim().length > 0 || this.allowEmptySubmission()) this.submitted.emit(this.draft());
	}
}
