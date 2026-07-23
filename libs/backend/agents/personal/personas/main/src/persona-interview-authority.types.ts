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
	/** Trusted start instant. */
	readonly startedAt: string;
}

/** Request to create or locate an interview inside a caller-owned, profile-locked transaction. */
export interface StartPersonaInterviewWithinTransactionCommand
{
	/** Profile owner whose current interview is being located. */
	readonly userId: string;
	/** Profile already locked by the caller to serialize competing starts. */
	readonly personaProfileId: string;
	/** Optional accepted refresh change that must own this exact interview. */
	readonly refreshChangeId?: string;
	/** Reviewed question-set identifier frozen for the new interview. */
	readonly questionSetId: string;
	/** Exact reviewed question-set version frozen for the new interview. */
	readonly questionSetVersion: number;
	/** Trusted creation instant for the new interview. */
	readonly startedAt: string;
}

/** Result of locating one existing interview or creating a new reviewed interview within a transaction. */
export type StartPersonaInterviewWithinTransactionResult =
	| { readonly status: "started"; readonly interviewId: string }
	| { readonly status: "linked_in_progress"; readonly interviewId: string }
	| { readonly status: "linked_closed" }
	| { readonly status: "other_in_progress"; readonly interviewId: string }
	| { readonly status: "question_set_unavailable" };

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
	| { readonly outcome: "started" | "already_in_progress"; readonly interviewId: string }
	| { readonly outcome: "denied"; readonly reason: "invalid_command" | "not_found_or_wrong_owner" | "question_set_unavailable" | "persistence_unavailable" };

/** Stable outcome from recording one interview answer. */
export type RecordPersonaInterviewAnswerResult =
	| { readonly outcome: "recorded"; readonly answerId: string }
	| { readonly outcome: "denied"; readonly reason: "invalid_command" | "not_found_or_wrong_owner" | "not_in_progress" | "question_unavailable" | "already_answered" | "persistence_unavailable" };

/** Stable outcome from completing one onboarding interview. */
export type CompletePersonaInterviewResult =
	| { readonly outcome: "completed" }
	| { readonly outcome: "denied"; readonly reason: "invalid_command" | "not_found_or_wrong_owner" | "not_in_progress" | "incomplete_answers" | "persistence_unavailable" };

/** Persistence boundary for the append-only onboarding interview lifecycle. */
export interface PersonaInterviewRepository
{
	/** Starts one reviewed interview or returns the owner's existing in-progress interview. */
	startAtomically(command: StartPersonaInterviewCommand): Promise<{ readonly status: "started" | "already_in_progress"; readonly interviewId: string } | { readonly status: "not_found_or_wrong_owner" | "question_set_unavailable" | "persistence_unavailable" }>;
	/** Appends one answer only while the owner interview remains in progress. */
	recordAnswerAtomically(command: RecordPersonaInterviewAnswerCommand): Promise<{ readonly status: "recorded"; readonly answerId: string } | { readonly status: "not_found_or_wrong_owner" | "not_in_progress" | "question_unavailable" | "already_answered" | "persistence_unavailable" }>;
	/** Completes a fully answered owner interview once and freezes its evidence. */
	completeAtomically(command: CompletePersonaInterviewCommand): Promise<{ readonly status: "completed" } | { readonly status: "not_found_or_wrong_owner" | "not_in_progress" | "incomplete_answers" | "persistence_unavailable" }>;
}
