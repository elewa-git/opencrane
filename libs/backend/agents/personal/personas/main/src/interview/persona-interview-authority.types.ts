import { PersonaInterviewDenialReasons, PersonaLifecycleOutcomes } from "../profile/persona-lifecycle.types";
import type { PersonaScoreResult, PersonaTieKinds } from "../scoring/persona-scorer.types";

/** Request to start the reviewed onboarding interview for one personal persona profile. */
export interface StartPersonaInterviewCommand
{
	/** Silo that owns the profile and reviewed question set. */
	readonly siloId: string;
	/** Profile owner who is starting the interview. */
	readonly userId: string;
	/** Personal persona profile that will receive the interview evidence. */
	readonly personaProfileId: string;
	/** Reviewed question-set identifier selected for this interview. */
	readonly questionSetId: string;
	/** Exact reviewed question-set version. */
	readonly questionSetVersion: number;
	/** Reviewed scoring-policy identifier pinned to this interview. */
	readonly scoringPolicyId: string;
	/** Exact reviewed scoring-policy revision. */
	readonly scoringPolicyVersion: number;
	/** Reviewed interpolation-map identifier pinned to this interview. */
	readonly interpolationMapId: string;
	/** Exact reviewed interpolation-map revision. */
	readonly interpolationMapVersion: number;
	/** The accepted persona-refresh proposal this interview carries out, or null for first-time onboarding. */
	readonly refreshConfigurationChangeId: string | null;
	/** Server timestamp for the start. */
	readonly startedAt: string;
}

/** Request to record one immutable answer while an interview remains in progress. */
export interface RecordPersonaInterviewAnswerCommand
{
	/** Profile owner who is answering the question. */
	readonly userId: string;
	/** Profile that owns the interview. */
	readonly personaProfileId: string;
	/** In-progress interview receiving the answer. */
	readonly interviewId: string;
	/** Question from the interview's exact reviewed question set. */
	readonly questionId: string;
	/** The choice the owner picked; it must belong to that question. */
	readonly choiceId: string;
	/** Trusted answer instant. */
	readonly answeredAt: string;
}

/** Request to make a fully answered interview immutable and ready for persona-draft derivation. */
export interface CompletePersonaInterviewCommand
{
	/** Profile owner who completes the interview. */
	readonly userId: string;
	/** Profile that owns the interview. */
	readonly personaProfileId: string;
	/** In-progress interview becoming completed. */
	readonly interviewId: string;
	/** Trusted completion instant. */
	readonly completedAt: string;
}

/** Owner-bound request to append one exact tie resolution. */
export interface ResolvePersonaInterviewTieCommand
{
	/** Profile owner resolving the tie. */
	readonly userId: string;
	/** Profile that owns the interview. */
	readonly personaProfileId: string;
	/** Completed interview whose result is ambiguous. */
	readonly interviewId: string;
	/** The tie the score is currently waiting on. */
	readonly kind: PersonaTieKinds;
	/** Exact candidate selected by the owner. */
	readonly selectedValue: string;
	/** Trusted resolution instant. */
	readonly resolvedAt: string;
}

/** Stable outcome from starting a reviewed persona interview. */
export type StartPersonaInterviewResult =
	| { readonly outcome: PersonaLifecycleOutcomes.Started | PersonaLifecycleOutcomes.AlreadyInProgress; readonly interviewId: string }
	| { readonly outcome: PersonaLifecycleOutcomes.Denied; readonly reason: PersonaInterviewDenialReasons };

/** Stable outcome from recording one interview answer. */
export type RecordPersonaInterviewAnswerResult =
	| { readonly outcome: PersonaLifecycleOutcomes.Recorded; readonly answerId: string }
	| { readonly outcome: PersonaLifecycleOutcomes.Denied; readonly reason: PersonaInterviewDenialReasons };

/** Stable outcome from completing one onboarding interview. */
export type CompletePersonaInterviewResult =
	| { readonly outcome: PersonaLifecycleOutcomes.Completed; readonly score: PersonaScoreResult }
	| { readonly outcome: PersonaLifecycleOutcomes.Denied; readonly reason: PersonaInterviewDenialReasons };

/** Stable outcome from appending one governed tie choice. */
export type ResolvePersonaInterviewTieResult =
	| { readonly outcome: PersonaLifecycleOutcomes.Recorded; readonly score: PersonaScoreResult }
	| { readonly outcome: PersonaLifecycleOutcomes.Denied; readonly reason: PersonaInterviewDenialReasons };

/**
 * Stores the persona interview lifecycle: start, answer, complete, break ties.
 *
 * Answers and tie choices are only ever added, never edited or deleted, and a completed interview is
 * frozen. That is deliberate: the persona draft is derived from these rows, so letting an answer change
 * after scoring would leave a persona that no longer matches the answers behind it.
 *
 * Every method name ends in `Atomically` because each one must re-check its preconditions inside the
 * same Serializable transaction as its write. Checking first and writing after would let two browser
 * tabs both pass the check and both write.
 *
 * Called by: the four use cases in persona-interview-authority.ts ({@link __StartPersonaInterview},
 * {@link __RecordPersonaInterviewAnswer}, {@link __CompletePersonaInterview},
 * {@link __ResolvePersonaInterviewTie}), and supplied to the router as its `interviews` dependency.
 * Implemented by `PrismaPersonaInterviewRepository` and, through delegation, by
 * `PrismaPersonaPersistenceUnitOfWork`.
 *
 * Each method returns either its success shape or `{ status: PersonaInterviewDenialReasons }`. A
 * `Conflict` or `PersistenceUnavailable` status is retryable; every other reason means the request as
 * written can never succeed.
 *
 * @see PersonaInterviewDenialReasons
 * @see PersonaInterviewQuestionReader
 */
export interface PersonaInterviewRepository
{
	/** Starts one reviewed interview or returns the owner's existing in-progress interview. */
	startAtomically(command: StartPersonaInterviewCommand): Promise<{ readonly status: PersonaLifecycleOutcomes.Started | PersonaLifecycleOutcomes.AlreadyInProgress; readonly interviewId: string } | { readonly status: PersonaInterviewDenialReasons }>;
	/** Appends one answer only while the owner interview remains in progress. */
	recordAnswerAtomically(command: RecordPersonaInterviewAnswerCommand): Promise<{ readonly status: PersonaLifecycleOutcomes.Recorded; readonly answerId: string } | { readonly status: PersonaInterviewDenialReasons }>;
	/** Completes a fully answered owner interview once and freezes its evidence. */
	completeAtomically(command: CompletePersonaInterviewCommand): Promise<{ readonly status: PersonaLifecycleOutcomes.Completed; readonly score: PersonaScoreResult } | { readonly status: PersonaInterviewDenialReasons }>;
	/** Records the owner's choice for the tie the score is currently waiting on. */
	resolveTieAtomically(command: ResolvePersonaInterviewTieCommand): Promise<{ readonly status: PersonaLifecycleOutcomes.Recorded; readonly score: PersonaScoreResult } | { readonly status: PersonaInterviewDenialReasons }>;
}

/** Reads the questions from the question-set version an interview is pinned to. */
export interface PersonaInterviewQuestionReader
{
	/** Loads the pinned questions for one owner's interview, or null when the interview does not belong to that owner. */
	getQuestions(interviewId: string, personaProfileId: string, userId: string): Promise<readonly { readonly id: string; readonly category: string; readonly prompt: string; readonly ordinal: number; readonly choices: readonly { readonly id: string; readonly label: string; readonly ordinal: number }[] }[] | null>;
}
