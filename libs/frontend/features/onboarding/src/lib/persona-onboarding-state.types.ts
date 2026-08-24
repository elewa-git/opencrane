import { PersonaOnboardingStates, type PersonaOnboardingSnapshot, type PersonaResolutionKinds } from "@opencrane/state/onboarding/projection";

/** Exact authority coordinates emitted when the owner submits one interview answer. */
export interface PersonaAnswerIntent
{
	/** Interview that owns the reviewed question. */
	readonly interviewId: string;
	/** Reviewed question being answered. */
	readonly questionId: string;
	/** Reviewed choice selected by the owner. */
	readonly choiceId: string;
}

/** Exact authority coordinates emitted when the owner resolves one scoring tie. */
export interface PersonaResolutionIntent
{
	/** Completed interview whose score requires an explicit choice. */
	readonly interviewId: string;
	/** Exact scoring boundary being resolved. */
	readonly kind: PersonaResolutionKinds;
	/** Server-admitted candidate selected by the owner. */
	readonly selectedValue: string;
}

/**
 * Carries the heading, explanation, and accessible prompt contributed by a tie-resolution kind.
 * The view mapper constructs this contract and the resolution template consumes it without reinterpreting primary, secondary, or modifier semantics.
 */
export interface PersonaResolutionCopy
{
	/** Identifies the part of the persona whose scores are tied. */
	readonly title: string;
	/** Explains what the owner's choice will affect. */
	readonly description: string;
	/** Asks for the owner's decision in the choice fieldset. */
	readonly legend: string;
}

/** Immutable review material captured by the owner's approval confirmation. */
export interface PersonaApprovalIntent
{
	/** Exact immutable persona revision being approved. */
	readonly personaRevisionId: string;
	/** Exact compiled instructions displayed when confirmation was requested. */
	readonly instructionPreview: string;
}

/** Read-only state-component input narrowed by the authoritative shell switch. */
export type PersonaOnboardingStateSnapshot<State extends PersonaOnboardingStates> = Readonly<PersonaOnboardingSnapshot & { readonly state: State }>;
