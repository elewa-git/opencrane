import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { AutoCompleteModule, type AutoCompleteCompleteEvent } from "primeng/autocomplete";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";

import { AgentThreadAdmissionStates } from "@opencrane/state/conversation/agent-threads";

import type { AgentThreadMentionIntent } from "./agent-thread-feature.types.js";

/** Controlled `@agent` mention affordance for one existing parent group message. */
@Component({ selector: "wo-agent-thread-mention-control", standalone: true, imports: [AutoCompleteModule, ButtonModule, FormsModule, MessageModule], templateUrl: "./agent-thread-mention-control.component.html", styleUrl: "./agent-thread-mention-control.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class AgentThreadMentionControlComponent
{
	/** Parent group conversation coordinate. */
	public readonly parentConversationId = input.required<string>();
	/** Root message coordinate used for idempotent child creation. */
	public readonly parentMessageId = input.required<string>();
	/** Independent mention-admission state. */
	public readonly state = input<AgentThreadAdmissionStates>(AgentThreadAdmissionStates.Available);
	/** Host-owned controlled mention query. */
	public readonly query = input("@agent");
	/** Display-safe available agent labels. */
	public readonly suggestions = input<readonly string[]>(["@agent"]);
	/** Emits edits without owning the root message draft. */
	public readonly queryChange = output<string>();
	/** Requests filtered suggestions from the parent. */
	public readonly suggestionsRequested = output<string>();
	/** Emits one exact root-message creation intent. */
	public readonly invoked = output<AgentThreadMentionIntent>();
	/** Stable admission states used by the template. */
	protected readonly states = AgentThreadAdmissionStates;

	/** Forward a PrimeNG completion query without deciding who may invoke an Agent. */
	protected requestSuggestions(event: AutoCompleteCompleteEvent): void { this.suggestionsRequested.emit(event.query); }

	/** Emit one exact coordinate-only creation intent while admission is available. */
	protected invoke(): void
	{
		if (this.state() === AgentThreadAdmissionStates.Available) this.invoked.emit({ parentConversationId: this.parentConversationId(), parentMessageId: this.parentMessageId() });
	}
}
