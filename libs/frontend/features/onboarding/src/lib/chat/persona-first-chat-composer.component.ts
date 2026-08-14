import { ChangeDetectionStrategy, Component, input, model, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { TextareaModule } from "primeng/textarea";

import { type PersonaFirstChatAnswerIntent, type PersonaFirstChatQuestion, PersonaFirstChatStates } from "./persona-first-chat.types";

/** Build a valid controlled answer intent, or null while presentation state forbids submission. */
export function _PersonaFirstChatAnswerIntent(question: PersonaFirstChatQuestion, state: PersonaFirstChatStates, draftAnswer: string): PersonaFirstChatAnswerIntent | null
{
	const answer = draftAnswer.trim();

	if (state !== PersonaFirstChatStates.AwaitingCalibration || answer.length === 0)
	{
		return null;
	}

	return { questionId: question.id, answer };
}

/** Controlled question composer that emits intent without advancing durable conversation state. */
@Component({
	selector: "wo-persona-first-chat-composer",
	standalone: true,
	imports: [ButtonModule, TextareaModule],
	templateUrl: "./persona-first-chat-composer.component.html",
	styleUrl: "./persona-first-chat-composer.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class PersonaFirstChatComposerComponent
{
	/** Current sequential question selected by authoritative orchestration. */
	public readonly question = input.required<PersonaFirstChatQuestion>();

	/** Externally owned lifecycle state that controls editing and submission. */
	public readonly state = input<PersonaFirstChatStates>(PersonaFirstChatStates.AwaitingCalibration);

	/** Controlled free-text draft retained by the component-scoped store through the parent model binding. */
	public readonly draftAnswer = model<string>("");

	/** Emits a trimmed answer for the exact visible question. */
	public readonly answerSubmitted = output<PersonaFirstChatAnswerIntent>();

	/** Whether the current draft can produce an answer intent. */
	public canSubmit(): boolean
	{
		return _PersonaFirstChatAnswerIntent(this.question(), this.state(), this.draftAnswer()) !== null;
	}

	/** Whether lifecycle state prevents edits to the controlled composer. */
	public disabled(): boolean
	{
		return this.state() !== PersonaFirstChatStates.AwaitingCalibration;
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
		const intent = _PersonaFirstChatAnswerIntent(this.question(), this.state(), this.draftAnswer());

		// 2. Refuse empty or externally disabled submissions without changing feature state.
		if (intent === null)
		{
			return;
		}

		// 3. Hand the exact answer intent to orchestration, which alone may advance the transcript.
		this.answerSubmitted.emit(intent);
	}
}
