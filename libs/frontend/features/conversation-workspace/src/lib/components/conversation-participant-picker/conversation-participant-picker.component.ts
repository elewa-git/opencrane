import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { CheckboxModule } from "primeng/checkbox";

import type { ConversationDirectoryParticipant } from "@opencrane/state/conversation/workspace";

/**
 * Presents controlled participant choices without changing conversation membership.
 * A supplied self row is always checked and cannot emit a toggle. The caller owns every other
 * selection and its submission rules, including single-person Direct conversation selection.
 * Called by: ConversationCreateComponent and ConversationGroupRequestComponent.
 */
@Component({ selector: "wo-conversation-participant-picker", standalone: true, imports: [FormsModule, CheckboxModule], templateUrl: "./conversation-participant-picker.component.html", styleUrl: "./conversation-participant-picker.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationParticipantPickerComponent
{
	/** Distinguishes this fieldset and its labels from other pickers on the page. */
	public readonly controlId = input.required<string>();
	/** Gives the checkbox collection its accessible name. */
	public readonly legend = input("Participants");
	/** Supplies server-selected labels and opaque references; no identity lookup happens here. */
	public readonly participants = input<readonly ConversationDirectoryParticipant[]>([]);
	/** Contains the caller-controlled additional recipients, without requiring the self reference. */
	public readonly selectedParticipantRefs = input<readonly string[]>([]);
	/** Prevents changes while the owning command is pending. */
	public readonly disabled = input(false);
	/** Returns a known non-self reference for the caller to toggle; it does not submit a command. */
	public readonly participantToggled = output<string>();

	/**
	 * Emits a selectable row's reference without mutating the supplied selection.
	 * @param participantRef - The opaque reference associated with the activated checkbox.
	 * @returns Nothing; disabled, unknown and self references emit no intent.
	 */
	public toggleParticipant(participantRef: string): void
	{
		const participant = this.participants().find(candidate => candidate.participantRef === participantRef);
		if (this.disabled() || participant === undefined || participant.isSelf)
			return;
		this.participantToggled.emit(participantRef);
	}
}
