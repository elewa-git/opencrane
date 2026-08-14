import { ChangeDetectionStrategy, Component, input, model, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";
import { ProgressSpinnerModule } from "primeng/progressspinner";

import { JourneyShellComponent, JourneyShellLayouts } from "@opencrane/elements/ui";

import { PersonaFirstChatComposerComponent } from "./persona-first-chat-composer.component";
import { PersonaFirstChatIdentityComponent } from "./persona-first-chat-identity.component";
import { PersonaFirstChatTranscriptComponent } from "./persona-first-chat-transcript.component";
import { type PersonaFirstChatAnswerIntent, type PersonaFirstChatIdentity, type PersonaFirstChatProvenance, type PersonaFirstChatQuestion, PersonaFirstChatStates, type PersonaFirstChatTranscriptMessage } from "./persona-first-chat.types";

/** Feature-specific presentational surface for the governed three-question first conversation. */
@Component({
	selector: "wo-persona-first-chat",
	standalone: true,
	imports: [ButtonModule, JourneyShellComponent, MessageModule, PersonaFirstChatComposerComponent, PersonaFirstChatIdentityComponent, PersonaFirstChatTranscriptComponent, ProgressSpinnerModule],
	templateUrl: "./persona-first-chat.component.html",
	styleUrl: "./persona-first-chat.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class PersonaFirstChatComponent
{
	/** Shared wide journey layout exposed to the template. */
	public readonly journeyLayouts = JourneyShellLayouts;

	/** Lifecycle states exposed for explicit presentational branches. */
	public readonly states = PersonaFirstChatStates;

	/** Approved agent identity shown at the top of the conversation. */
	public readonly identity = input.required<PersonaFirstChatIdentity>();

	/** Exact persona and script references that produced this bootstrap. */
	public readonly provenance = input.required<PersonaFirstChatProvenance>();

	/** Immutable authoritative messages rendered in caller-supplied order. */
	public readonly transcript = input.required<readonly PersonaFirstChatTranscriptMessage[]>();

	/** Current sequential question, or null after authority-confirmed completion. */
	public readonly currentQuestion = input<PersonaFirstChatQuestion | null>(null);

	/** Externally owned lifecycle state; this component never advances it. */
	public readonly state = input<PersonaFirstChatStates>(PersonaFirstChatStates.AwaitingCalibration);

	/** Recoverable status or error explanation supplied by orchestration. */
	public readonly statusMessage = input<string | undefined>(undefined);

	/** Authority-confirmed completion copy supplied by orchestration. */
	public readonly completionMessage = input<string | undefined>(undefined);

	/** Controlled free-text draft retained while orchestration admits an answer. */
	public readonly draftAnswer = model<string>("");

	/** Emits a trimmed answer for the exact visible question without mutating lifecycle state. */
	public readonly answerSubmitted = output<PersonaFirstChatAnswerIntent>();

	/** Emits owner intent to retry the externally owned failed operation. */
	public readonly retryRequested = output<void>();

}
