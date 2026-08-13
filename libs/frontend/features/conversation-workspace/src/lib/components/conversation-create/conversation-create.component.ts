import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { DialogModule } from "primeng/dialog";

import { ConversationModes, ConversationPersonalAgentStatuses, type ConversationCreationDirectory } from "@opencrane/state/conversation/workspace";

/**
 * The "New conversation" dialog: pick the mode once, pick who is in it, and ask the workspace to
 * create it.
 *
 * Mode is the reason this is a separate step rather than a button. A conversation's mode is fixed at
 * creation and can never change, so the dialog makes the choice explicit and says so in the copy;
 * an Agent session sends every message into run admission, while Direct and Group never create runs.
 *
 * Nothing here identifies anyone. The directory hands over opaque participant references with generic
 * labels, and the dialog emits those references back untouched — it never resolves them to a person,
 * and it shows no name for anyone but the personal Agent the server itself named. When the server
 * cannot name exactly one personal Agent it reports `Ambiguous` or `Unavailable`, and the dialog then
 * explains the block instead of guessing an Agent: Agent sessions stay uncreatable until an
 * administrator repairs the assignment.
 *
 * Like every control in this feature the dialog holds no state and runs no command. Selection lives in
 * the workspace store, which is also what enforces that Direct keeps a single participant.
 *
 * Called by: {@link ConversationWorkspacePageComponent} template.
 * @see ConversationCreationDirectory for the choices the server offers.
 * @see ConversationModes for what each mode commits the conversation to.
 */
@Component({ selector: "wo-conversation-create", standalone: true, imports: [ButtonModule, DialogModule], templateUrl: "./conversation-create.component.html", styleUrl: "./conversation-create.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationCreateComponent
{
	/** Whether the dialog is open. The parent owns the flag, so the dialog cannot open or close itself; closing it does not reset the selection. */
	public readonly visible = input(false);
	/**
	 * The choices the server is willing to offer: the participants this account may start a conversation
	 * with, and whether a personal Agent is available.
	 *
	 * `null` means the directory has not been read yet, in which case the dialog shows the mode choices
	 * with no participants and no Agent — never a fallback list of its own.
	 * @see ConversationCreationDirectory
	 */
	public readonly directory = input<ConversationCreationDirectory | null>(null);
	/** The mode currently checked in the radio group. It only changes when the parent adopts {@link modeSelected}, and it decides which half of the dialog body is shown. */
	public readonly mode = input<ConversationModes>(ConversationModes.AgentSession);
	/** The participant references currently ticked, as opaque strings from the directory. The dialog compares them for tick marks and never looks inside one. */
	public readonly selectedParticipantRefs = input<ReadonlySet<string>>(new Set());
	/** Whether the create button is enabled. The workspace store decides it — an Agent is ready, or one participant for Direct, or at least one for Group — so this component runs no rule of its own. */
	public readonly canCreate = input(false);
	/** Whether a create request is already in flight, which puts the button in its loading state. The parent must set it, since a second create would make a second conversation. */
	public readonly busy = input(false);
	/**
	 * Asks the parent to close the dialog.
	 *
	 * It fires from Cancel and from the dialog's own dismiss, so the parent gets one path to handle. The
	 * parent deliberately leaves the selection alone when closing, which is how reopening keeps the
	 * participant's earlier choices.
	 */
	public readonly dismissed = output<void>();
	/**
	 * Reports the mode the participant just picked.
	 *
	 * The parent's store adopts it and clears the participant selection at the same time, because people
	 * chosen for a group are not a meaningful selection for an Agent session.
	 */
	public readonly modeSelected = output<ConversationModes>();
	/**
	 * Reports that one participant row was ticked or unticked, by its opaque reference.
	 *
	 * The dialog does not know whether that turned the selection on or off — the store owns the set and
	 * flips the entry, and it is the store that keeps Direct down to a single participant by dropping the
	 * previous one.
	 */
	public readonly participantToggled = output<string>();
	/** Asks the parent to create the conversation from the mode and participants it holds. The dialog sends no payload because the store already has every choice. */
	public readonly createRequested = output<void>();
	/** Gives the template the conversation modes so its radio options and body switch compare against members instead of raw strings. */
	protected readonly modes = ConversationModes;
	/** Gives the template the personal-Agent statuses so the ready, ambiguous, and unavailable notices are selected by member. */
	protected readonly agentStatuses = ConversationPersonalAgentStatuses;

	/**
	 * Turns the checked radio button into a typed mode for {@link modeSelected}.
	 *
	 * A radio's `value` is only ever a string, so the loop matches it against the real enum members
	 * instead of casting: an option added to the template with a value the enum does not have emits
	 * nothing rather than an invalid mode. `event.target` is typed `EventTarget | null`, hence the
	 * narrowing check first.
	 */
	protected selectMode(event: Event): void
	{
		const target = event.target;
		if (!(target instanceof HTMLInputElement)) return;
		for (const mode of Object.values(ConversationModes)) if (target.value === mode) this.modeSelected.emit(mode);
	}
}
