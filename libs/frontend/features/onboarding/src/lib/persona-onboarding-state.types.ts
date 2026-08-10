import { PersonaOnboardingStates } from "@opencrane/state/onboarding";
import type { PersonaOnboardingSnapshot, PersonaResolutionKinds } from "@opencrane/state/onboarding";

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
