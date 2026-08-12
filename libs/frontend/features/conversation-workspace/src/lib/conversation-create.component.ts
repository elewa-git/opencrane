import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { DialogModule } from "primeng/dialog";

import { ConversationModes } from "@opencrane/models/conversations";
import { ConversationPersonalAgentStatuses, type ConversationCreationDirectory } from "@opencrane/state/conversation/workspace";

/** Controlled immutable-mode creation dialog with privacy-safe generic participants. */
@Component({ selector: "wo-conversation-create", standalone: true, imports: [ButtonModule, DialogModule], templateUrl: "./conversation-create.component.html", styleUrl: "./conversation-create.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationCreateComponent
{
	/** Whether the dialog is shown. */
	public readonly visible = input(false);
	/** Privacy-safe creation choices. */
	public readonly directory = input<ConversationCreationDirectory | null>(null);
	/** Selected immutable mode. */
	public readonly mode = input<ConversationModes>(ConversationModes.AgentSession);
	/** Opaque selected human coordinates. */
	public readonly selectedParticipantRefs = input<ReadonlySet<string>>(new Set());
	/** Whether the current selection can be submitted. */
	public readonly canCreate = input(false);
	/** Whether the exact command is active. */
	public readonly busy = input(false);
	/** Emits dialog closure. */
	public readonly dismissed = output<void>();
	/** Emits one immutable-mode selection. */
	public readonly modeSelected = output<ConversationModes>();
	/** Emits one privacy-safe participant choice. */
	public readonly participantToggled = output<string>();
	/** Emits the create intent. */
	public readonly createRequested = output<void>();
	/** Stable mode vocabulary used by the template. */
	protected readonly modes = ConversationModes;
	/** Stable personal Agent availability used by the template. */
	protected readonly agentStatuses = ConversationPersonalAgentStatuses;

	/** Map one native radio value to the owned immutable-mode enum. */
	protected selectMode(event: Event): void
	{
		const target = event.target;
		if (!(target instanceof HTMLInputElement)) return;
		for (const mode of Object.values(ConversationModes)) if (target.value === mode) this.modeSelected.emit(mode);
	}
}
