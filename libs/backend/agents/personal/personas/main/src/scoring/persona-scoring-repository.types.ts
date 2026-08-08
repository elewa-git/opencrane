import type { PersonaScoreResult, PersonaTieChoice, PersonaTieKinds, PersonaWeightedAnswer } from "./persona-scorer.types.js";

/** Scoring inputs frozen into one completed interview. */
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

/** Existing immutable score fields required for exact replay verification. */
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
	/** Raw colour denominator. */
	readonly colourTotal: number;
	/** Raw Explorer counter. */
	readonly explorer: number;
	/** Raw Guardian counter. */
	readonly guardian: number;
	/** Raw openness denominator. */
	readonly opennessTotal: number;
	/** Exact highest-colour candidate set serialized by Prisma. */
	readonly primaryCandidates: readonly string[];
}

/** Owner-bound request to append one exact tie resolution. */
export interface ResolvePersonaTieCommand
{
	/** Stable authenticated owner. */
	readonly userId: string;
	/** Persona profile that owns the completed interview. */
	readonly personaProfileId: string;
	/** Completed interview whose score remains ambiguous. */
	readonly interviewId: string;
	/** Exact governed tie boundary. */
	readonly kind: PersonaTieKinds;
	/** Candidate selected by the owner. */
	readonly selectedValue: string;
	/** Trusted resolution instant. */
	readonly resolvedAt: string;
}

/** Scoring persistence outcomes kept separate from transport status codes. */
export enum PersonaScoringPersistenceStatuses
{
	/** Score and resolution evidence are available. */
	Ready = "ready",
	/** Owner/interview coordinates did not resolve. */
	NotFound = "not_found",
	/** Interview evidence is incomplete or invalid. */
	InvalidEvidence = "invalid_evidence",
	/** Submitted tie kind or candidate does not match the current score. */
	InvalidResolution = "invalid_resolution",
	/** Exact tie boundary was already resolved. */
	AlreadyResolved = "already_resolved",
}

/** Stable result of one score read or append-only tie resolution. */
export type PersonaScoringPersistenceResult =
	| { readonly status: PersonaScoringPersistenceStatuses.Ready; readonly score: PersonaScoreResult }
	| { readonly status: Exclude<PersonaScoringPersistenceStatuses, PersonaScoringPersistenceStatuses.Ready> };

/** Persona-owned persistence port for immutable scoring and append-only tie evidence. */
export interface PersonaScoringRepository
{
	/** Create the immutable score once or replay the exact existing derivation. */
	ensureScore(interviewId: string, personaProfileId: string, userId: string): Promise<PersonaScoringPersistenceResult>;
	/** Replay an existing immutable score without writing from a read path. */
	readScore(interviewId: string, personaProfileId: string, userId: string): Promise<PersonaScoringPersistenceResult>;
	/** Append the exact next owner tie choice and replay the resulting score. */
	resolveTie(command: ResolvePersonaTieCommand): Promise<PersonaScoringPersistenceResult>;
}
