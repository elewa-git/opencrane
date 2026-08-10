import { Injectable, computed, inject, resource, signal } from "@angular/core";

import { PersonaOnboardingSnapshot, PersonaOnboardingStates, PersonaResolutionKinds } from "./persona-gateway.types";
import { PersonaFirstChatService } from "./persona-first-chat.service.js";
import { UserOnboardingRouteSnapshot, UserOnboardingRouteStates } from "./persona-first-chat.types.js";
import { PersonaOnboardingService } from "./persona-onboarding.service";

/** Component-scoped browser state owner for the server-authoritative persona lifecycle. */
@Injectable()
export class PersonaOnboardingStore
{
	/** Application service that performs explicit persona authority commands. */
	private readonly _persona = inject(PersonaOnboardingService);

	/** Application service that reads the durable post-persona route projection. */
	private readonly _firstChat = inject(PersonaFirstChatService);

	/** Whether one authority command has already been admitted by this store. */
	private readonly _commandActive = signal(false);

	/** Whether the post-persona route projection is already being resolved. */
	private readonly _readyRouteActive = signal(false);

	/** Bounded command failure that leaves the authoritative projection unchanged. */
	private readonly _commandError = signal<string | null>(null);

	/** Exact approval coordinate retained only while its cross-authority transition is uncertain. */
	private readonly _pendingApprovalRevisionId = signal<string | null>(null);

	/** Durable route projection loaded only after the persona reaches ready. */
	private readonly _readyRoute = signal<UserOnboardingRouteSnapshot | null>(null);

	/** Bounded post-persona route failure that keeps the ready state retryable. */
	private readonly _readyRouteError = signal<string | null>(null);

	/** Read-only loader for the complete authoritative onboarding projection. */
	public readonly onboarding = resource({ loader: this._persona.read.bind(this._persona) });

	/** Bounded command or route-resolution failure exposed to the routed shell. */
	public readonly actionError = computed(this._actionError.bind(this));

	/** Whether one authority command has already been admitted by this store. */
	public readonly busy = this._commandActive.asReadonly();

	/** Durable post-persona route projection exposed for the shell's navigation effect. */
	public readonly readyRoute = this._readyRoute.asReadonly();

	/** Retry the authoritative projection read after a blocking load failure. */
	public retry(): void
	{
		this.onboarding.reload();
	}

	/** Resolve the durable post-persona route once, retaining a bounded retryable failure. */
	public async resolveReadyRoute(): Promise<void>
	{
		if (this._readyRouteActive() || this._readyRoute() !== null) return;
		this._readyRouteActive.set(true);
		this._readyRouteError.set(null);
		try
		{
			const route = await this._firstChat.loadRouteState();
			if (_IsSurveyRoute(route))
			{
				this._readyRouteError.set("Persona activation is saved, but onboarding still needs to finish that transition. Retry to continue.");
				return;
			}
			this._readyRoute.set(route);
		}
		catch
		{
			this._readyRouteError.set("OpenCrane could not resolve the saved first-conversation route.");
		}
		finally
		{
			this._readyRouteActive.set(false);
		}
	}

	/** Resume an uncertain approval transition before resolving the durable post-persona route. */
	public async retryReadyRoute(): Promise<void>
	{
		let revisionId = this._pendingApprovalRevisionId();
		const snapshot = this.onboarding.hasValue() ? this.onboarding.value() : null;
		if (snapshot?.state === PersonaOnboardingStates.Ready && revisionId !== null && snapshot.personaRevisionId !== revisionId)
		{
			this._pendingApprovalRevisionId.set(null);
			revisionId = null;
		}
		if (revisionId !== null)
		{
			const recovered = await this._executeCommand(this._persona.approve.bind(this._persona, revisionId));
			if (!recovered) return;
			this._pendingApprovalRevisionId.set(null);
		}
		await this.resolveReadyRoute();
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
			this._commandError.set("The persona review changed before approval. Review the current immutable instructions and confirm again.");
			return;
		}
		this._pendingApprovalRevisionId.set(personaRevisionId);
		const approved = await this._executeCommand(this._persona.approve.bind(this._persona, personaRevisionId));
		if (approved) this._pendingApprovalRevisionId.set(null);
	}

	/** Start a new governed interview without mutating the current review locally. */
	public async restart(): Promise<void>
	{
		await this._executeCommand(this._persona.restart.bind(this._persona));
	}

	/** Admit one typed command at a time and adopt only its authoritative returned projection. */
	private async _executeCommand(operation: () => Promise<PersonaOnboardingSnapshot>): Promise<boolean>
	{
		if (this._commandActive()) return false;
		this._commandActive.set(true);
		this._commandError.set(null);
		try
		{
			this.onboarding.set(await operation());
			return true;
		}
		catch (error)
		{
			this._commandError.set(_CommandErrorMessage(error));
			await this._reconcileAfterCommandFailure();
			return false;
		}
		finally
		{
			this._commandActive.set(false);
		}
	}

	/** Reload once after an uncertain command result so an admitted write is not replayed from stale state. */
	private async _reconcileAfterCommandFailure(): Promise<void>
	{
		try
		{
			const snapshot = await this._persona.read();
			this.onboarding.set(snapshot);
			const pendingApproval = this._pendingApprovalRevisionId();
			if (snapshot.state === PersonaOnboardingStates.Ready && pendingApproval !== null && snapshot.personaRevisionId !== pendingApproval)
			{
				this._pendingApprovalRevisionId.set(null);
			}
		}
		catch
		{
			// The bounded command error remains visible and a later explicit retry reloads authority state.
		}
	}

	/** Prefer the current command failure, then the post-persona route failure. */
	private _actionError(): string | null
	{
		return this._commandError() ?? this._readyRouteError();
	}
}

/** Whether a ready persona is still paired with a pre-approval onboarding route. */
function _IsSurveyRoute(route: UserOnboardingRouteSnapshot): boolean
{
	return route.state === UserOnboardingRouteStates.SurveyPending || route.state === UserOnboardingRouteStates.SurveyInProgress;
}

/** Return a bounded user-facing command error without exposing an unknown payload. */
function _CommandErrorMessage(error: unknown): string
{
	return error instanceof Error && error.message ? error.message : "OpenCrane could not save this onboarding step.";
}
