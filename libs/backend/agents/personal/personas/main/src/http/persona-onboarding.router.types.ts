import type { Request } from "express";
import type { Logger } from "@opencrane/observability";

import type { PersonaAuthorityRepository } from "../approval/persona-authority.types.js";
import type { PersonaDraftFromInterviewRepository } from "../drafting/persona-draft-authority.types.js";
import type { PersonaInterviewQuestionReader, PersonaInterviewRepository } from "../interview/persona-interview-authority.types.js";
import type { PersonaOnboardingRepository } from "../profile/persona-onboarding-authority.types.js";
import type { PersonaOnboardingStatusRepository } from "../profile/persona-onboarding-status.types.js";

/** Authenticated browser identity resolved by the composing server, never from request input. */
export interface PersonaOnboardingCaller
{
	/** Silo selected from the authenticated request host. */
	readonly siloId: string;
	/** Stable subject who is the only owner of this persona flow. */
	readonly userId: string;
}

/** Clock injected by the app so router tests never depend on the wall clock. */
export interface PersonaOnboardingClock
{
	/** Return the current trusted server time. */
	now(): Date;
}

/** Composition ports for the self-only persona onboarding HTTP surface. */
export interface PersonaOnboardingRouterDependencies
{
	/** Resolves session and host identity, or null when the request is unauthenticated. */
	resolveCaller(request: Request): PersonaOnboardingCaller | null;
	/** Provisions the caller profile and server-owned reviewed questionnaire. */
	onboarding: PersonaOnboardingRepository;
	/** Owns the append-only interview lifecycle. */
	interviews: PersonaInterviewRepository;
	/** Reads the interview's immutable questionnaire revision. */
	questions: PersonaInterviewQuestionReader;
	/** Creates a server-derived draft from completed interview evidence. */
	drafts: PersonaDraftFromInterviewRepository;
	/** Approves the owner-reviewed draft and moves the active persona pointer. */
	approval: PersonaAuthorityRepository;
	/** Supplies trusted timestamps. */
	clock: PersonaOnboardingClock;
	/** Records unexpected authority failures without including owner answers. */
	logger: Logger;
	/** Reads the resumable onboarding state without exposing compiled persona instructions. */
	status: PersonaOnboardingStatusRepository;
}
