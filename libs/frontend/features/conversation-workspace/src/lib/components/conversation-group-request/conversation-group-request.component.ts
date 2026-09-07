import { ChangeDetectionStrategy, Component, computed, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { DialogModule } from "primeng/dialog";
import { MessageModule } from "primeng/message";

import { ChoiceCardGroupComponent } from "@opencrane/elements/ui";
import { ConversationGroupCommandStates, type ConversationCompanyAssistant, type ConversationGroupSource } from "@opencrane/state/conversation/workspace";

/** Composes a source preview and explicit company-assistant choice; command and retry state belong to the store. */
@Component({ selector: "wo-conversation-group-request", standalone: true, imports: [ButtonModule, DialogModule, MessageModule, ChoiceCardGroupComponent], templateUrl: "./conversation-group-request.component.html", styleUrl: "./conversation-group-request.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationGroupRequestComponent
{
	/** Opens the dialog for the selected group message, or closes it when null. */
	public readonly source = input<ConversationGroupSource | null>(null);
	/** Supplies the server's current permitted company assistant choices. */
	public readonly assistants = input<readonly ConversationCompanyAssistant[]>([]);
	/** Holds the participant's explicit selection without defaulting to a service. */
	public readonly selectedId = input<string | null>(null);
	/** Locks the form while the command is in flight. */
	public readonly state = input(ConversationGroupCommandStates.Idle);
	/** Displays fixed failure copy while preserving the selected source and service. */
	public readonly error = input<string | null>(null);
	/** Delegates service selection to the store. */
	public readonly assistantSelected = output<string>();
	/** Requests admission of the reviewed group source and selected assistant. */
	public readonly submitted = output<void>();
	/** Requests dismissal without altering the selected conversation. */
	public readonly dismissed = output<void>();
	/** Supplies the shared choice-card projection without exposing service metadata. */
	protected readonly choices = computed(this._Choices.bind(this));
	/** Exposes the finite command states to the template. */
	protected readonly states = ConversationGroupCommandStates;
	/** Maps permitted service names into the existing single-choice component. */
	private _Choices() { return this.assistants().map(assistant => ({ id: assistant.agentServiceId, label: assistant.displayName })); }
}
