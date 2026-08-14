import type { PersonaScoreResult, PersonaTieChoice, PersonaTieKinds, PersonaWeightedAnswer } from "./persona-scorer.types";

/** The scoring inputs a completed interview is pinned to: its policy, its weighted answers, and the owner's tie choices. */
export interface PersonaScoringEvidence
{
	/** Reviewed scoring-policy identity. */
	readonly scoringPolicyId: string;
	/** Reviewed scoring-policy version. */
	readonly scoringPolicyVersion: number;
	/** Reviewed scoring-policy digest. */
	readonly scoringPolicyDigest: string;
	/** Ordered weighted answers. */
	readonly answers: readonly PersonaWeightedAnswer[];
	/** Append-only tie evidence. */
	readonly resolutions: readonly PersonaTieChoice[];
}

/** The stored score columns, compared against a freshly recomputed score. */
export interface StoredPersonaScore
{
	/** Reviewed policy identity. */
	readonly scoringPolicyId: string;
	/** Reviewed policy version. */
	readonly scoringPolicyVersion: number;
	/** Reviewed policy digest. */
	readonly scoringPolicyDigest: string;
	/** Ordered answer identities. */
	readonly orderedAnswerIds: readonly string[];
	/** Ordered question and choice coordinates. */
	readonly orderedChoiceIds: readonly string[];
	/** Raw red counter. */
	readonly red: number;
	/** Raw yellow counter. */
	readonly yellow: number;
	/** Raw green counter. */
	readonly green: number;
	/** Raw blue counter. */
	readonly blue: number;
	/** Sum of the four colour counters. */
	readonly colourTotal: number;
	/** Raw Explorer counter. */
	readonly explorer: number;
	/** Raw Guardian counter. */
	readonly guardian: number;
	/** Sum of the Explorer and Guardian counters. */
	readonly opennessTotal: number;
	/** The primary-colour candidates from the first pass, stored as Prisma enum strings. */
	readonly primaryCandidates: readonly string[];
	/** The secondary-colour candidates from the first pass, before any tie choice, stored as Prisma enum strings. */
	readonly secondaryCandidates: readonly string[];
	/** The modifier candidates from the first pass, before any tie choice, stored as Prisma enum strings. */
	readonly modifierCandidates: readonly string[];
}

/** A request from one owner to record their choice for one tie. */
export interface ResolvePersonaTieCommand
{
	/** Stable authenticated owner. */
	readonly userId: string;
	/** Persona profile that owns the completed interview. */
	readonly personaProfileId: string;
	/** Completed interview whose score remains ambiguous. */
	readonly interviewId: string;
	/** Which tie is being settled. */
	readonly kind: PersonaTieKinds;
	/** Candidate selected by the owner. */
	readonly selectedValue: string;
	/** Server timestamp for the choice. */
	readonly resolvedAt: string;
}

/** Outcomes of a scoring read or write. The router maps these to HTTP statuses; they are never statuses themselves. */
export enum PersonaScoringPersistenceStatuses
{
	/** Score and resolution evidence are available. */
	Ready = "ready",
	/** No completed interview matched this owner and interview id. */
	NotFound = "not_found",
	/** Interview evidence is incomplete or invalid. */
	InvalidEvidence = "invalid_evidence",
	/** Submitted tie kind or candidate does not match the current score. */
	InvalidResolution = "invalid_resolution",
	/** Exact tie boundary was already resolved. */
	AlreadyResolved = "already_resolved",
}

/** Result of reading a score or recording one tie choice. */
export type PersonaScoringPersistenceResult =
	| { readonly status: PersonaScoringPersistenceStatuses.Ready; readonly score: PersonaScoreResult }
	| { readonly status: Exclude<PersonaScoringPersistenceStatuses, PersonaScoringPersistenceStatuses.Ready> };

/**
 * Stores and reads persona scores and the owner's tie choices.
 *
 * A score row is written once, when the interview completes, and never updated. Tie choices are only
 * added. Every read recomputes the score from the answers and compares it with the stored row, so a
 * row that has drifted from its answers is refused rather than shown to the owner.
 *
 * Called by: `PrismaPersonaInterviewRepository` (completion and tie resolution),
 * `PrismaPersonaDraftRepository` (before template selection), `PrismaPersonaAuthorityRepository`
 * (approval preflight) and `PrismaPersonaOnboardingStatusRepository` (status reads). Implemented only
 * by `PrismaPersonaScoringRepository`.
 *
 * @see PersonaScoringPersistenceStatuses
 */
export interface PersonaScoringRepository
{
	/**
	 * Writes the score row the first time, or recomputes it and checks the stored row still matches.
	 *
	 * @param interviewId - The completed interview being scored.
	 * @param personaProfileId - Profile that must own the interview.
	 * @param userId - Owner that must own the profile.
	 * @returns `Ready` with the score; check `resolutionRequired` before drafting. `NotFound` when no
	 * completed interview matches all three arguments. `InvalidEvidence` when the answers cannot be
	 * scored or the stored row disagrees with the recomputed score — an operator must look at it, and
	 * retrying will not help.
	 */
	ensureScore(interviewId: string, personaProfileId: string, userId: string): Promise<PersonaScoringPersistenceResult>;
	/**
	 * Recomputes an already-stored score and checks it matches. Never writes.
	 *
	 * Use this from read and approval paths, which must not create a score row as a side effect.
	 *
	 * @param interviewId - The completed interview to read.
	 * @param personaProfileId - Profile that must own the interview.
	 * @param userId - Owner that must own the profile.
	 * @returns `Ready` with the score. `NotFound` when nothing matches. `InvalidEvidence` when no score
	 * row exists yet, or the stored row no longer matches the answers.
	 */
	readScore(interviewId: string, personaProfileId: string, userId: string): Promise<PersonaScoringPersistenceResult>;
	/**
	 * Records the owner's choice for the tie the score is currently waiting on.
	 *
	 * @param command - Owner, profile, interview, which tie, the chosen value, and the timestamp.
	 * @returns `Ready` with the recomputed score, which may still have a later tie open.
	 * `InvalidResolution` when the score is not waiting on that tie, or the value is not one of its
	 * candidates — the caller must re-read the score before asking again. `AlreadyResolved` when this
	 * tie is already settled. `NotFound` when nothing matches.
	 */
	resolveTie(command: ResolvePersonaTieCommand): Promise<PersonaScoringPersistenceResult>;
}
