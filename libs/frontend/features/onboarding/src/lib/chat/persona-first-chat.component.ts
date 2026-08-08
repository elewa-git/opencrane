import { NgClass } from "@angular/common";
import { ChangeDetectionStrategy, Component, input, model, output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";
import { ProgressSpinnerModule } from "primeng/progressspinner";
import { TextareaModule } from "primeng/textarea";

import { AvatarCircleComponent, AvatarSizes, AvatarTones, JourneyShellComponent, JourneyShellLayouts, PersonaArchetypeTones, ScopeChipAppearances, ScopeChipComponent, ScopeChipTones } from "@opencrane/elements/ui";

import { type PersonaFirstChatAnswerIntent, PersonaFirstChatArchetypeClasses, type PersonaFirstChatIdentity, PersonaFirstChatMessageRoles, type PersonaFirstChatProvenance, type PersonaFirstChatQuestion, PersonaFirstChatStates, type PersonaFirstChatTranscriptMessage } from "./persona-first-chat.types.js";

/** Map the shared archetype vocabulary to the sole feature-owned provenance class. */
export function _PersonaFirstChatArchetypeClass(archetype: PersonaArchetypeTones): PersonaFirstChatArchetypeClasses
{
	switch (archetype)
	{
		case PersonaArchetypeTones.Commander: return PersonaFirstChatArchetypeClasses.Commander;
		case PersonaArchetypeTones.Catalyst: return PersonaFirstChatArchetypeClasses.Catalyst;
		case PersonaArchetypeTones.Anchor: return PersonaFirstChatArchetypeClasses.Anchor;
		case PersonaArchetypeTones.Analyst: return PersonaFirstChatArchetypeClasses.Analyst;
	}
}

/** Build a valid controlled answer intent, or null while presentation state forbids submission. */
export function _PersonaFirstChatAnswerIntent(question: PersonaFirstChatQuestion | null, state: PersonaFirstChatStates, draftAnswer: string): PersonaFirstChatAnswerIntent | null
{
	const answer = draftAnswer.trim();

	if (state !== PersonaFirstChatStates.AwaitingCalibration || question === null || answer.length === 0)
	{
		return null;
	}

	return { questionId: question.id, answer };
}

/** Feature-specific presentational surface for the governed three-question first conversation. */
@Component({
	selector: "wo-persona-first-chat",
	standalone: true,
	imports: [AvatarCircleComponent, ButtonModule, FormsModule, JourneyShellComponent, MessageModule, NgClass, ProgressSpinnerModule, ScopeChipComponent, TextareaModule],
	templateUrl: "./persona-first-chat.component.html",
	styleUrl: "./persona-first-chat.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class PersonaFirstChatComponent
{
	/** Shared wide journey layout exposed to the template. */
	public readonly journeyLayouts = JourneyShellLayouts;

	/** Shared avatar treatments exposed to the template. */
	public readonly avatarTones = AvatarTones;

	/** Shared avatar sizes exposed to the template. */
	public readonly avatarSizes = AvatarSizes;

	/** Shared chip tones exposed to the template. */
	public readonly chipTones = ScopeChipTones;

	/** Shared chip appearances exposed to the template. */
	public readonly chipAppearances = ScopeChipAppearances;

	/** Transcript speaker roles exposed for finite alignment and labels. */
	public readonly messageRoles = PersonaFirstChatMessageRoles;

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

	/** Whether the current draft can produce an answer intent. */
	public canSubmit(): boolean
	{
		return _PersonaFirstChatAnswerIntent(this.currentQuestion(), this.state(), this.draftAnswer()) !== null;
	}

	/** Approved archetype class selected without exposing arbitrary styling input. */
	public provenanceArchetypeClass(): PersonaFirstChatArchetypeClasses
	{
		return _PersonaFirstChatArchetypeClass(this.identity().archetype);
	}

	/** Whether lifecycle state prevents edits to the controlled composer. */
	public composerDisabled(): boolean
	{
		return this.state() !== PersonaFirstChatStates.AwaitingCalibration || this.currentQuestion() === null;
	}

	/** Preserve ordinary input while exposing the draft through the model contract. */
	public updateDraft(event: Event): void
	{
		this.draftAnswer.set((event.target as HTMLTextAreaElement).value);
	}

	/** Submit on plain Enter while preserving Shift+Enter as a newline gesture. */
	public handleComposerKeydown(event: KeyboardEvent): void
	{
		if (event.key === "Enter" && !event.shiftKey)
		{
			event.preventDefault();
			this.submitAnswer();
		}
	}

	/** Emit one answer intent when both the visible question and draft are valid. */
	public submitAnswer(): void
	{
		// 1. Validate one snapshot of controlled inputs so an intent cannot mix render revisions.
		const intent = _PersonaFirstChatAnswerIntent(this.currentQuestion(), this.state(), this.draftAnswer());

		// 2. Refuse empty, disabled, or questionless submissions without changing feature state.
		if (intent === null)
		{
			return;
		}

		// 3. Hand the exact answer intent to orchestration, which alone may advance the transcript.
		this.answerSubmitted.emit(intent);
	}

	/** Return a stable human-readable speaker label for transcript semantics. */
	public speakerLabel(role: PersonaFirstChatMessageRoles): string
	{
		switch (role)
		{
			case PersonaFirstChatMessageRoles.Agent: return this.identity().name;
			case PersonaFirstChatMessageRoles.Owner: return "You";
		}
	}
}
