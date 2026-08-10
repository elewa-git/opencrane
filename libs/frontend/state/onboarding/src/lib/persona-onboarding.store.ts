import { Injectable, inject, resource, signal } from "@angular/core";

import { PersonaOnboardingSnapshot, PersonaOnboardingStates, PersonaResolutionKinds } from "./persona-gateway.types";
import { PersonaOnboardingService } from "./persona-onboarding.service";

/** Component-scoped browser state owner for the server-authoritative persona lifecycle. */
@Injectable()
export class PersonaOnboardingStore
{
	/** Application service that performs explicit persona authority commands. */
	private readonly _persona = inject(PersonaOnboardingService);

	/** Whether one authority command has already been admitted by this store. */
	private readonly _commandActive = signal(false);

	/** Read-only loader for the complete authoritative onboarding projection. */
	public readonly onboarding = resource({ loader: this._persona.read.bind(this._persona) });

	/** Bounded command failure that leaves the authoritative projection unchanged. */
	public readonly actionError = signal<string | null>(null);

	/** Whether one authority command has already been admitted by this store. */
	public readonly busy = this._commandActive.asReadonly();

	/** Retry the authoritative projection read after a blocking load failure. */
	public retry(): void
	{
		this.onboarding.reload();
	}

	/** Start or resume the reviewed persona interview. */
	public async start(): Promise<void>
	{
		await this._executeCommand(this._persona.start.bind(this._persona));
	}

	/** Record one exact answer and complete the interview when the authority confirms the final answer. */
	public async answer(interviewId: string, questionId: string, choiceId: string): Promise<void>
	{
		await this._executeCommand(async function _Answer(this: PersonaOnboardingStore): Promise<PersonaOnboardingSnapshot>
		{
			let next = await this._persona.answer(interviewId, questionId, choiceId);
			if (next.questionCount > 0 && next.answeredQuestionCount >= next.questionCount)
			{
				next = await this._persona.complete(next.interviewId ?? interviewId);
			}
			return next;
		}.bind(this));
	}

	/** Persist one exact tie choice through the persona authority. */
	public async resolve(interviewId: string, kind: PersonaResolutionKinds, selectedValue: string): Promise<void>
	{
		await this._executeCommand(this._persona.resolve.bind(this._persona, interviewId, kind, selectedValue));
	}

	/** Finish an interrupted draft transition from the current durable review projection. */
	public async prepareDraft(): Promise<void>
	{
		const snapshot = this.onboarding.hasValue() ? this.onboarding.value() : null;
		if (snapshot === null) return;
		await this._executeCommand(this._persona.ensureDraft.bind(this._persona, snapshot));
	}

	/** Approve only when the live state matches the immutable material the owner confirmed. */
	public async approve(personaRevisionId: string, instructionPreview: string): Promise<void>
	{
		const snapshot = this.onboarding.hasValue() ? this.onboarding.value() : null;
		if (snapshot?.state !== PersonaOnboardingStates.Review || snapshot.personaRevisionId !== personaRevisionId || snapshot.result?.instructionPreview !== instructionPreview)
		{
			this.actionError.set("The persona review changed before approval. Review the current immutable instructions and confirm again.");
			return;
		}
		await this._executeCommand(this._persona.approve.bind(this._persona, personaRevisionId));
	}

	/** Start a new governed interview without mutating the current review locally. */
	public async restart(): Promise<void>
	{
		await this._executeCommand(this._persona.restart.bind(this._persona));
	}

	/** Admit one typed command at a time and adopt only its authoritative returned projection. */
	private async _executeCommand(operation: () => Promise<PersonaOnboardingSnapshot>): Promise<void>
	{
		if (this._commandActive()) return;
		this._commandActive.set(true);
		this.actionError.set(null);
		try
		{
			this.onboarding.set(await operation());
		}
		catch (error)
		{
			this.actionError.set(_CommandErrorMessage(error));
		}
		finally
		{
			this._commandActive.set(false);
		}
	}
}

/** Return a bounded user-facing command error without exposing an unknown payload. */
function _CommandErrorMessage(error: unknown): string
{
	return error instanceof Error && error.message ? error.message : "OpenCrane could not save this onboarding step.";
}
