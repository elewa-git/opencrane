import type { PersonaArchetypeTones } from "@opencrane/elements/ui";

/** Finite presentation states supplied by the first-chat orchestration owner. */
export enum PersonaFirstChatStates
{
	/** The current calibration question accepts an owner answer. */
	AwaitingCalibration = "awaiting_calibration",
	/** The current owner answer is being admitted by the conversation authority. */
	Submitting = "submitting",
	/** Saved transcript evidence remains readable while the authoritative projection reloads. */
	Reconnecting = "reconnecting",
	/** All admitted answers are being validated for server-owned onboarding completion. */
	Finishing = "finishing",
	/** The authority has confirmed that all three calibration answers are complete. */
	Completed = "completed",
	/** A recoverable presentation error prevents the next answer from being submitted. */
	Error = "error"
}

/** Speaker roles rendered in the deterministic first-chat transcript. */
export enum PersonaFirstChatMessageRoles
{
	/** Message emitted by the approved personal agent snapshot. */
	Agent = "agent",
	/** Ordinary conversation evidence supplied by the signed-in owner. */
	Owner = "owner"
}

/** Approved CSS classes that map persona archetypes to one provenance-strip owner. */
export enum PersonaFirstChatArchetypeClasses
{
	/** Commander provenance treatment backed by the shared red archetype token. */
	Commander = "wo-first-chat__provenance--commander",
	/** Catalyst provenance treatment backed by the shared yellow archetype token. */
	Catalyst = "wo-first-chat__provenance--catalyst",
	/** Anchor provenance treatment backed by the shared green archetype token. */
	Anchor = "wo-first-chat__provenance--anchor",
	/** Analyst provenance treatment backed by the shared blue archetype token. */
	Analyst = "wo-first-chat__provenance--analyst"
}

/** One of the canonical three sequential bootstrap questions. */
export type PersonaFirstChatQuestionOrdinal = 1 | 2 | 3;

/** Presentational identity of the approved personal agent. */
export interface PersonaFirstChatIdentity
{
	/** Human-readable agent name shown beside its avatar. */
	readonly name: string;
	/** Short stable initials rendered inside the shared avatar primitive. */
	readonly initials: string;
	/** Approved archetype treatment shared with the persona result surface. */
	readonly archetype: PersonaArchetypeTones;
}

/** Reviewed sources that produced this one-time bootstrap conversation. */
export interface PersonaFirstChatProvenance
{
	/** Exact approved persona revision label exposed for owner verification. */
	readonly personaRevision: string;
	/** Human-readable archetype bootstrap-script name. */
	readonly scriptLabel: string;
	/** Exact reviewed bootstrap-script revision label. */
	readonly scriptRevision: string;
}

/** One immutable message supplied in authoritative transcript order. */
export interface PersonaFirstChatTranscriptMessage
{
	/** Stable event identifier used to preserve DOM identity across reconnects. */
	readonly id: string;
	/** Speaker role that selects transcript alignment and accessible labelling. */
	readonly role: PersonaFirstChatMessageRoles;
	/** Plain conversation text rendered without HTML interpretation. */
	readonly body: string;
}

/** Current archetype-specific calibration question selected by orchestration. */
export interface PersonaFirstChatQuestion
{
	/** Stable question identifier returned with the answer intent. */
	readonly id: string;
	/** Canonical position in the three-question bootstrap sequence. */
	readonly ordinal: PersonaFirstChatQuestionOrdinal;
	/** Reviewed archetype-specific question text. */
	readonly prompt: string;
}

/** Owner intent emitted without advancing or completing the conversation locally. */
export interface PersonaFirstChatAnswerIntent
{
	/** Stable identifier of the question visible when Enter or Send was used. */
	readonly questionId: string;
	/** Trimmed non-empty answer supplied by the owner. */
	readonly answer: string;
}

/** Complete pure presentation derived from one authoritative first-chat projection. */
export interface PersonaFirstChatView
{
	/** Approved personal-agent identity rendered by the conversation surface. */
	readonly identity: PersonaFirstChatIdentity;
	/** Exact persona and bootstrap source provenance shown to the owner. */
	readonly provenance: PersonaFirstChatProvenance;
	/** Canonical transcript adapted without changing server order. */
	readonly transcript: readonly PersonaFirstChatTranscriptMessage[];
	/** Current server-selected question, or null after all answers. */
	readonly currentQuestion: PersonaFirstChatQuestion | null;
}
