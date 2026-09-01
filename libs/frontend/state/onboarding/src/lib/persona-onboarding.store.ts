import { Injectable, computed, inject, resource, signal } from "@angular/core";
import { PersonaOnboardingStates, PersonaResolutionKinds, UserOnboardingRouteStates, type PersonaOnboardingSnapshot } from "@opencrane/models/user-onboarding";

import { PersonaFirstChatService } from "./persona-first-chat.service";
import type { UserOnboardingRouteSnapshot } from "./persona-first-chat.types";
import { PersonaOnboardingService } from "./persona-onboarding.service";

/**
 * Holds the persona-onboarding state for one visit to the persona route.
 *
 * Provided by PersonaOnboardingPageComponent in its own `providers`. The server owns the workflow:
 * this store issues commands and then replaces its state with whatever the server returns, so
 * `state`, `questions` and `result` are never computed locally.
 *
 * One command runs at a time — while {@link busy} is true, further commands return immediately.
 * Every command failure is caught, put in {@link actionError}, and followed by a single reload, so
 * a write whose response was lost cannot be replayed against stale state.
 *
 * Approval is the awkward part. {@link approve} records which revision is being approved before it
 * calls the server; if the response is lost, {@link retryReadyRoute} finishes that approval before
 * loading the next route. That is why approval has its own retry path.
 *
 * @see PersonaOnboardingStates
 * @see PersonaOnboardingSnapshot
 */
@Injectable()
export class PersonaOnboardingStore
{
	/** Service that makes the persona calls to the server. */
	private readonly _persona = inject(PersonaOnboardingService);

	/** Service used only to read where onboarding goes after the persona is approved. */
	private readonly _firstChat = inject(PersonaFirstChatService);

	/** Whether a command is running; while true, new commands are ignored. */
	private readonly _commandActive = signal(false);

	/** Whether the route load is already running, so calling {@link resolveReadyRoute} from an effect
	 *  cannot start a second one. */
	private readonly _readyRouteActive = signal(false);

	/** Message from the last failed command; the onboarding state itself is unchanged. */
	private readonly _commandError = signal<string | null>(null);

	/** The revision being approved, kept only until the server confirms the approval landed. */
	private readonly _pendingApprovalRevisionId = signal<string | null>(null);

	/** Where to send the user next, loaded only once the persona is Ready. */
	private readonly _readyRoute = signal<UserOnboardingRouteSnapshot | null>(null);

	/** Why the route could not be loaded, if it could not. Kept separate from a command failure because
	 *  this one is always worth retrying: the persona is already approved, only the route is missing. */
	private readonly _readyRouteError = signal<string | null>(null);

	/** The onboarding state, as a read-only `resource`; commands push their results into it. */
	public readonly onboarding = resource({ loader: this._persona.read.bind(this._persona) });

	/** The message to show for the last failure, whether it came from a command or from loading the
	 *  route. Null when nothing has failed. */
	public readonly actionError = computed(this._actionError.bind(this));

	/** Whether a command is running; while true, new commands are ignored. */
	public readonly busy = this._commandActive.asReadonly();

	/** Where the server says to send the user next, or null until it has been loaded. The page's
	 *  navigation effect watches this and navigates once it is set. */
	public readonly readyRoute = this._readyRoute.asReadonly();

	/** Reload the onboarding state after the initial load failed. */
	public retry(): void
	{
		this.onboarding.reload();
	}

	/**
	 * Loads the route to send the user to next, once.
	 *
	 * Returns immediately if it is already loading or already loaded, so it is safe to call from an
	 * effect. If the server still reports a survey route the persona has not finished propagating
	 * yet: that is recorded as a retryable message rather than an error, and
	 * {@link retryReadyRoute} tries again.
	 *
	 * @returns Resolves when the attempt finishes; the result lands in {@link readyRoute} or
	 *   {@link actionError}.
	 */
	public async resolveReadyRoute(): Promise<void>
	{
		if (this._readyRouteActive() || this._readyRoute() !== null)
		{
			return;
		}
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

	/**
	 * Finishes an approval whose result never came back, then loads the next route.
	 *
	 * Use this as the retry action on the ready screen. If an approval is still outstanding it is
	 * re-sent first — unless the server has since moved to Ready on a different revision, in which
	 * case the outstanding approval is abandoned as superseded. Only then is the route loaded.
	 *
	 * Called by: PersonaOnboardingPageComponent, from the ready state component's retry output.
	 *
	 * @returns Resolves when the retry finishes; check {@link actionError}.
	 */
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
			if (!recovered)
			{
				return;
			}
			this._pendingApprovalRevisionId.set(null);
		}
		await this.resolveReadyRoute();
	}

	/** Start or resume the reviewed persona interview. */
	public async start(): Promise<void>
	{
		await this._executeCommand(this._persona.start.bind(this._persona));
	}

	/**
	 * Saves one interview answer, and completes the interview when it was the last one.
	 *
	 * The completion is not guessed: it happens only when the server's own response says the answered
	 * count has reached the question count. So the caller submits answers one at a time and never has
	 * to decide when the interview is over.
	 *
	 * Called by: PersonaOnboardingPageComponent.answer, from the interview state component's answer
	 * output.
	 *
	 * @param interviewId - The interview the question belongs to.
	 * @param questionId - The question being answered.
	 * @param choiceId - The choice the user picked.
	 * @returns Resolves when the attempt finishes; check {@link actionError}.
	 */
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

	/** Save the user's answer to a scoring tie. */
	public async resolve(interviewId: string, kind: PersonaResolutionKinds, selectedValue: string): Promise<void>
	{
		await this._executeCommand(this._persona.resolve.bind(this._persona, interviewId, kind, selectedValue));
	}

	/** Finish creating the draft when a previous attempt was interrupted, using the state already loaded. */
	public async prepareDraft(): Promise<void>
	{
		const snapshot = this.onboarding.hasValue() ? this.onboarding.value() : null;
		if (snapshot === null)
		{
			return;
		}
		await this._executeCommand(this._persona.ensureDraft.bind(this._persona, snapshot));
	}

	/**
	 * Approves the persona the user confirmed, refusing if it changed under them.
	 *
	 * Both arguments are re-checked against the current state before anything is sent: the state must
	 * still be Review, the revision must still be the same one, and the instruction text must be
	 * byte-identical to what was on screen. If any differ, nothing is sent and
	 * {@link actionError} explains that the review changed — the user must look again and re-confirm.
	 *
	 * The revision is remembered until the server confirms, so a lost response can be finished by
	 * {@link retryReadyRoute} rather than approving twice.
	 *
	 * Called by: PersonaOnboardingPageComponent.approve, from the review state component's approve
	 * output.
	 *
	 * @param personaRevisionId - The revision shown in the confirmation dialog.
	 * @param instructionPreview - The exact instruction text shown in that dialog.
	 * @returns Resolves when the attempt finishes; check {@link actionError}.
	 */
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
		if (approved)
		{
			this._pendingApprovalRevisionId.set(null);
		}
	}

	/** Ask the server to start a fresh interview; the current review is left alone until it answers. */
	public async restart(): Promise<void>
	{
		await this._executeCommand(this._persona.restart.bind(this._persona));
	}

	/** Run one command at a time, storing only what the server returns; on failure, record it and reload once. */
	private async _executeCommand(operation: () => Promise<PersonaOnboardingSnapshot>): Promise<boolean>
	{
		if (this._commandActive())
		{
			return false;
		}
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

	/** Reload once when a command's result is unknown, so a write that did land is not replayed from stale state. */
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
			// The command's error message stays on screen; a later retry reloads the state from the server.
		}
	}

	/** Show the command failure if there is one, otherwise the route-loading failure. */
	private _actionError(): string | null
	{
		return this._commandError() ?? this._readyRouteError();
	}
}

/** Whether the persona is approved but onboarding still says the survey is unfinished — a transition that has not caught up yet. */
function _IsSurveyRoute(route: UserOnboardingRouteSnapshot): boolean
{
	return route.state === UserOnboardingRouteStates.SurveyPending || route.state === UserOnboardingRouteStates.SurveyInProgress;
}

/** Turn any thrown value into a message safe to show, falling back to a generic one. */
function _CommandErrorMessage(error: unknown): string
{
	return error instanceof Error && error.message ? error.message : "OpenCrane could not save this onboarding step.";
}
