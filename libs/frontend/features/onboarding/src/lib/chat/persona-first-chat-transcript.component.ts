import { ChangeDetectionStrategy, Component, input } from "@angular/core";

import { PersonaFirstChatMessageRoles, type PersonaFirstChatTranscriptMessage } from "./persona-first-chat.types.js";

/** Return the stable human-readable speaker label for one finite transcript role. */
export function _PersonaFirstChatSpeakerLabel(role: PersonaFirstChatMessageRoles, agentName: string): string
{
	switch (role)
	{
		case PersonaFirstChatMessageRoles.Agent: return agentName;
		case PersonaFirstChatMessageRoles.Owner: return "You";
	}
}

/** Read-only saved transcript with stable message identity and speaker semantics. */
@Component({
	selector: "wo-persona-first-chat-transcript",
	standalone: true,
	templateUrl: "./persona-first-chat-transcript.component.html",
	styleUrl: "./persona-first-chat-transcript.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class PersonaFirstChatTranscriptComponent
{
	/** Transcript speaker roles exposed for finite alignment. */
	public readonly messageRoles = PersonaFirstChatMessageRoles;

	/** Approved agent name used to label agent-authored evidence. */
	public readonly agentName = input.required<string>();

	/** Immutable authoritative messages rendered in caller-supplied order. */
	public readonly messages = input.required<readonly PersonaFirstChatTranscriptMessage[]>();

	/** Return a stable accessible speaker label for a transcript entry. */
	public speakerLabel(role: PersonaFirstChatMessageRoles): string
	{
		return _PersonaFirstChatSpeakerLabel(role, this.agentName());
	}
}
