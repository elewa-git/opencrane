import { InjectionToken } from "@angular/core";

/** Durable owner-visible stages of the persona onboarding lifecycle. */
export enum PersonaOnboardingStates
{
	/** The reviewed interview still needs answers or completion. */
	Interview = "interview",
	/** One exact scoring tie needs an explicit owner choice. */
	Resolution = "resolution",
	/** An immutable persona draft is available for review and approval. */
	Review = "review",
	/** An approved persona revision is active for future admitted runs. */
	Ready = "ready"
}

/** Finite tie boundaries the persona authority may ask an owner to resolve. */
export enum PersonaResolutionKinds
{
	/** Choose which tied colour leads the persona. */
	Primary = "primary",
	/** Choose which tied colour supplies the secondary influence. */
	Secondary = "secondary",
	/** Choose between the tied Explorer and Guardian working styles. */
	Modifier = "modifier"
}

/** Reviewed colour families used by the persona scorer and presentation. */
export enum PersonaColours
{
	/** Direct and decisive collaboration. */
	Red = "red",
	/** Energetic and exploratory collaboration. */
	Yellow = "yellow",
	/** Calm and supportive collaboration. */
	Green = "green",
	/** Precise and evidence-led collaboration. */
	Blue = "blue"
}

/** Reviewed openness styles used to select an exact persona template. */
export enum PersonaModifiers
{
	/** Prefer novel approaches and creative alternatives. */
	Explorer = "explorer",
	/** Prefer proven approaches and bounded risk. */
	Guardian = "guardian"
}

/** One reviewed answer choice from the interview's frozen question-set revision. */
export interface PersonaQuestionChoice
{
	/** Stable choice identifier accepted by the server. */
	readonly id: string;
	/** Human-readable preference shown to the owner. */
	readonly label: string;
	/** One-based stable order within the question. */
	readonly ordinal: number;
}

/** One reviewed question plus any already-recorded immutable answer. */
export interface PersonaQuestion
{
	/** Stable question identifier from the frozen question set. */
	readonly id: string;
	/** Product-owned preference axis used to group the evidence. */
	readonly category: string;
	/** Human-readable preference question. */
	readonly prompt: string;
	/** One-based stable order within the interview. */
	readonly ordinal: number;
	/** At least two finite reviewed choices accepted for this question. */
	readonly choices: readonly PersonaQuestionChoice[];
	/** Already-recorded choice, or null while the question is unanswered. */
	readonly selectedChoiceId: string | null;
}

/** Exact unresolved scoring boundary returned by the persona authority. */
export interface PersonaResolution
{
	/** Boundary requiring an explicit owner choice. */
	readonly kind: PersonaResolutionKinds;
	/** Only the server-validated values the owner may select. */
	readonly candidates: readonly (PersonaColours | PersonaModifiers)[];
}

/** Lossless colour counters retained by the server-owned scoring result. */
export interface PersonaColourScores
{
	/** Red collaboration points. */
	readonly red: number;
	/** Yellow collaboration points. */
	readonly yellow: number;
	/** Green collaboration points. */
	readonly green: number;
	/** Blue collaboration points. */
	readonly blue: number;
	/** Denominator used for display-only colour percentages. */
	readonly total: number;
}

/** Lossless openness counters retained by the server-owned scoring result. */
export interface PersonaOpennessScores
{
	/** Explorer working-style points. */
	readonly explorer: number;
	/** Guardian working-style points. */
	readonly guardian: number;
	/** Denominator used for display-only openness percentages. */
	readonly total: number;
}

/** Review-safe projection of the server-derived persona result. */
export interface PersonaResult
{
	/** Reviewed display name of the selected template. */
	readonly displayName: string;
	/** Highest resolved colour score. */
	readonly primaryColour: PersonaColours;
	/** Highest resolved remaining colour score. */
	readonly secondaryColour: PersonaColours;
	/** Resolved Explorer or Guardian template modifier. */
	readonly modifier: PersonaModifiers;
	/** Complete lossless colour score vector. */
	readonly colourScores: PersonaColourScores;
	/** Complete lossless openness score vector. */
	readonly opennessScores: PersonaOpennessScores;
	/** Up to five server-derived, provenance-linked review explanations. */
	readonly insights: readonly string[];
	/** Exact immutable compiled instructions the owner reviews before approval. */
	readonly instructionPreview: string | null;
}

/** Complete resumable owner projection returned by `GET /me/persona`. */
export interface PersonaOnboardingSnapshot
{
	/** Current durable lifecycle stage. */
	readonly state: PersonaOnboardingStates;
	/** Active or completed interview identifier, when present. */
	readonly interviewId: string | null;
	/** Count of answers durably recorded by the authority. */
	readonly answeredQuestionCount: number;
	/** Count of reviewed questions pinned to the interview. */
	readonly questionCount: number;
	/** Draft or approved immutable persona revision, when present. */
	readonly personaRevisionId: string | null;
	/** Frozen reviewed question set with immutable recorded choices. */
	readonly questions: readonly PersonaQuestion[];
	/** Current tie resolution request, or null when scoring is deterministic. */
	readonly resolution: PersonaResolution | null;
	/** Server-derived result available for review and after approval. */
	readonly result: PersonaResult | null;
}

/** Typed port over the signed-in owner's persona lifecycle API. */
export interface PersonaGateway
{
	/** Load the complete durable onboarding projection for the signed-in owner. */
	load(): Promise<PersonaOnboardingSnapshot>;
	/** Start or resume the one active reviewed persona interview. */
	startInterview(): Promise<void>;
	/** Append one reviewed choice to the active interview. */
	recordAnswer(interviewId: string, questionId: string, choiceId: string): Promise<void>;
	/** Freeze a fully answered interview and compute its score evidence. */
	completeInterview(interviewId: string): Promise<void>;
	/** Append one explicit choice for a server-returned tie candidate set. */
	resolve(interviewId: string, kind: PersonaResolutionKinds, selectedValue: string): Promise<void>;
	/** Create one immutable persona draft from completed, resolved evidence. */
	createDraft(interviewId: string): Promise<void>;
	/** Approve and activate the exact immutable draft revision. */
	approve(personaRevisionId: string): Promise<void>;
}

/** Dependency-injection token for the active typed persona API adapter. */
export const PERSONA_GATEWAY: InjectionToken<PersonaGateway> = new InjectionToken<PersonaGateway>("PERSONA_GATEWAY");
