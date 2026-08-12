import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { TextareaModule } from "primeng/textarea";

import { ConversationComposerStates } from "./conversation.types.js";

/** Controlled conversation composer that emits drafts and submit intents without owning commands. */
@Component({ selector: "wo-conversation-composer", standalone: true, imports: [ButtonModule, TextareaModule], templateUrl: "./conversation-composer.component.html", styleUrl: "./conversation-composer.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationComposerComponent
{
	/** Exact host-owned draft displayed by the textarea. */
	public readonly draft = input("");
	/** Visible composer lifecycle state. */
	public readonly state = input<ConversationComposerStates>(ConversationComposerStates.Available);
	/** Context-specific input hint. */
	public readonly placeholder = input("Write a message…");
	/** Accessible name for the message field. */
	public readonly label = input("Message");
	/** Host-supplied unique field id for pages that render more than one composer. */
	public readonly fieldId = input("conversation-composer-field");
	/** Emits every user edit; the host decides whether to adopt it. */
	public readonly draftChange = output<string>();
	/** Emits the exact displayed non-empty draft once. */
	public readonly submitted = output<string>();
	/** Stable state vocabulary used by the template. */
	protected readonly states = ConversationComposerStates;

	/** Forward one textarea edit as a controlled-draft intent. */
	protected changeDraft(event: Event): void
	{
		const target = event.target;
		if (target instanceof HTMLTextAreaElement) this.draftChange.emit(target.value);
	}

	/** Submit on Ctrl+Enter or Command+Enter while preserving ordinary Enter for new lines. */
	protected handleKeydown(event: KeyboardEvent): void
	{
		if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;
		event.preventDefault();
		this.submit();
	}

	/** Emit the exact visible draft only while the composer is available. */
	protected submit(): void
	{
		if (this.state() === ConversationComposerStates.Available && this.draft().trim().length > 0) this.submitted.emit(this.draft());
	}
}
