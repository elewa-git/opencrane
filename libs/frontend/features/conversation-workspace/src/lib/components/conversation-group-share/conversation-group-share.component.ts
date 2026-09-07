import { ChangeDetectionStrategy, Component, computed, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { DialogModule } from "primeng/dialog";
import { MessageModule } from "primeng/message";
import { TextareaModule } from "primeng/textarea";

import { ConversationGroupCommandStates } from "@opencrane/state/conversation/workspace";

/** Displays an editable assistant result and requires explicit confirmation to post it as the human. */
@Component({ selector: "wo-conversation-group-share", standalone: true, imports: [ButtonModule, DialogModule, MessageModule, TextareaModule], templateUrl: "./conversation-group-share.component.html", styleUrl: "./conversation-group-share.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationGroupShareComponent
{
	/** Shows the current source review without owning the selected conversation. */
	public readonly visible = input(false);
	/** Displays the text the human will post, including any edits. */
	public readonly text = input("");
	/** Locks the review while pending and reports confirmed acceptance. */
	public readonly state = input(ConversationGroupCommandStates.Idle);
	/** Displays fixed failure copy while retaining the reviewed text. */
	public readonly error = input<string | null>(null);
	/** Returns edits to the store that owns the retry command. */
	public readonly textChanged = output<string>();
	/** Requests the confirmed human share. */
	public readonly submitted = output<void>();
	/** Requests normal workspace navigation back to the immediate group. */
	public readonly groupRequested = output<void>();
	/** Closes the review after an operation finishes. */
	public readonly dismissed = output<void>();
	/** Prevents an oversized edited message from being submitted. */
	protected readonly tooLong = computed(this._TooLong.bind(this));
	/** Checks the same UTF-8 byte limit enforced by the server share contract. */
	private _TooLong(): boolean { return new TextEncoder().encode(this.text()).byteLength > 65_536; }
	/** Supplies finite command states to the template. */
	protected readonly states = ConversationGroupCommandStates;
	/** Returns textarea edits without interpreting the reviewed message. */
	protected changeText(event: Event): void
	{
		if (event.target instanceof HTMLTextAreaElement)
			this.textChanged.emit(event.target.value);
	}
}
