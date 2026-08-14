import { ChangeDetectionStrategy, Component, computed, input, output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { AutoCompleteModule, type AutoCompleteCompleteEvent, type AutoCompleteSelectEvent } from "primeng/autocomplete";
import { MessageModule } from "primeng/message";

import { AgentThreadAdmissionStates } from "@opencrane/state/conversation/agent-threads";

import type { AgentThreadAgentOption, AgentThreadMentionTarget } from "./agent-thread-feature.types.js";

/** Controlled Agent selector embedded in an ordinary group composer before atomic message submit. */
@Component({ selector: "wo-agent-thread-mention-control", standalone: true, imports: [AutoCompleteModule, FormsModule, MessageModule], templateUrl: "./agent-thread-mention-control.component.html", styleUrl: "./agent-thread-mention-control.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class AgentThreadMentionControlComponent
{
	/** Independent mention-admission state. */
	public readonly state = input<AgentThreadAdmissionStates>(AgentThreadAdmissionStates.Available);
	/** Host-owned selected Agent target, or null for an ordinary message. */
	public readonly target = input<AgentThreadMentionTarget | null>(null);
	/** Display-safe Agent services that may be selected for this group. */
	public readonly suggestions = input<readonly AgentThreadAgentOption[]>([]);
	/** PrimeNG adapter copy; the public component input remains immutable. */
	protected readonly primeSuggestions = computed(this._PrimeSuggestions.bind(this));
	/** Requests filtered suggestions from the parent. */
	public readonly suggestionsRequested = output<string>();
	/** Returns the selected service to the ordinary composer; it creates no message by itself. */
	public readonly targetChange = output<AgentThreadMentionTarget | null>();
	/** Stable admission states used by the template. */
	protected readonly states = AgentThreadAdmissionStates;

	/** Forward a PrimeNG completion query without deciding who may invoke an Agent. */
	protected requestSuggestions(event: AutoCompleteCompleteEvent): void { this.suggestionsRequested.emit(event.query); }

	/** Adopt one exact displayed service without creating a parent message or child run. */
	protected select(event: AutoCompleteSelectEvent): void
	{
		if (this.state() !== AgentThreadAdmissionStates.Available || !_IsAgentOption(event.value)) return;
		this.targetChange.emit({ agentServiceId: event.value.agentServiceId, label: event.value.label });
	}

	/** Clear the controlled Agent target so the host submits an ordinary group message. */
	protected clear(): void { this.targetChange.emit(null); }

	/** Copy the immutable host list at the mutable third-party component boundary. */
	private _PrimeSuggestions(): AgentThreadAgentOption[] { return [...this.suggestions()]; }
}

/** Narrow PrimeNG's untyped selection event to the exact display-safe option contract. */
function _IsAgentOption(value: unknown): value is AgentThreadAgentOption
{
	if (value === null || typeof value !== "object") return false;
	const candidate = value as Readonly<Record<string, unknown>>;
	return typeof candidate["agentServiceId"] === "string" && candidate["agentServiceId"].length > 0 && typeof candidate["label"] === "string" && candidate["label"].length > 0;
}
