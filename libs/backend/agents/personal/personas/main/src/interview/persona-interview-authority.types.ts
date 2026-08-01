import { PersonaInterviewDenialReasons, PersonaLifecycleOutcomes } from "../profile/persona-lifecycle.types.js";

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
	/** Accepted personal refresh proposal this interview materialises, or null for ordinary onboarding. */
	readonly refreshConfigurationChangeId: string | null;
	/** Trusted start instant. */
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
	/** Non-empty user answer. */
	readonly value: string;
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
	| { readonly outcome: PersonaLifecycleOutcomes.Completed }
	| { readonly outcome: PersonaLifecycleOutcomes.Denied; readonly reason: PersonaInterviewDenialReasons };

/** Persistence boundary for the append-only onboarding interview lifecycle. */
export interface PersonaInterviewRepository
{
	/** Starts one reviewed interview or returns the owner's existing in-progress interview. */
	startAtomically(command: StartPersonaInterviewCommand): Promise<{ readonly status: PersonaLifecycleOutcomes.Started | PersonaLifecycleOutcomes.AlreadyInProgress; readonly interviewId: string } | { readonly status: PersonaInterviewDenialReasons }>;
	/** Appends one answer only while the owner interview remains in progress. */
	recordAnswerAtomically(command: RecordPersonaInterviewAnswerCommand): Promise<{ readonly status: PersonaLifecycleOutcomes.Recorded; readonly answerId: string } | { readonly status: PersonaInterviewDenialReasons }>;
	/** Completes a fully answered owner interview once and freezes its evidence. */
	completeAtomically(command: CompletePersonaInterviewCommand): Promise<{ readonly status: PersonaLifecycleOutcomes.Completed } | { readonly status: PersonaInterviewDenialReasons }>;
}

/** Read boundary for the immutable question-set revision pinned to one owner interview. */
export interface PersonaInterviewQuestionReader
{
	/** Loads the exact frozen questions for one owner interview, or null when it is not visible. */
	getQuestions(interviewId: string, personaProfileId: string, userId: string): Promise<readonly { readonly id: string; readonly category: string; readonly prompt: string; readonly ordinal: number }[] | null>;
}
