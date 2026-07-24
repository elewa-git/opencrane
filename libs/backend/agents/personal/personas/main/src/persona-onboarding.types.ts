import type { Request, Router } from "express";

import type { PersonaInterviewCategory } from "@prisma/client";

import type { PersonaAuthorityRepository } from "./persona-authority.types.js";
import type { PersonaDraftRepository } from "./persona-draft-authority.types.js";
import type { PersonaInterviewRepository } from "./persona-interview-authority.types.js";

/** The authenticated, host-scoped owner permitted to operate one personal persona. */
export interface PersonaOnboardingCaller
{
	/** Stable OIDC subject of the authenticated person. */
	readonly userId: string;
	/** ClusterTenant-derived silo that contains this personal profile. */
	readonly siloId: string;
}

/** One immutable prompt from the reviewed server-owned onboarding source. */
export interface PersonaOnboardingQuestion
{
	/** Stable identifier used when appending the answer. */
	readonly id: string;
	/** Product-defined category used for template selection and insight provenance. */
	readonly category: PersonaInterviewCategory;
	/** Human-readable question presented to the person. */
	readonly prompt: string;
	/** Stable display order within the reviewed question set. */
	readonly ordinal: number;
}

/** The only reviewed onboarding source exposed by the initial personal-agent flow. */
export interface PersonaOnboardingQuestionSet
{
	/** Stable reviewed question-set identifier. */
	readonly id: string;
	/** Exact immutable question-set revision. */
	readonly version: number;
	/** Questions in their durable ordinal order. */
	readonly questions: readonly PersonaOnboardingQuestion[];
}

/** Resolves a personal profile from server-derived silo and authenticated user coordinates. */
export interface PersonaProfileRepository
{
	/** Returns the existing profile or creates the one clean-build profile for this caller. */
	resolveForCaller(caller: PersonaOnboardingCaller): Promise<{ readonly id: string }>;
}

/** Reads the fixed reviewed onboarding source without allowing caller-selected content. */
export interface PersonaOnboardingSourceRepository
{
	/** Returns the reviewed initial source, or null until clean provisioning is complete. */
	getReviewedQuestionSet(): Promise<PersonaOnboardingQuestionSet | null>;
}

/** Dependencies injected into the public persona-onboarding HTTP router. */
export interface PersonaOnboardingRouterDependencies
{
	/** Resolves the authenticated OIDC subject and host-derived silo; null fails closed. */
	readonly resolveCaller: (request: Request) => Promise<PersonaOnboardingCaller | null>;
	/** Resolves the caller's single profile without taking a profile identifier from HTTP. */
	readonly profiles: PersonaProfileRepository;
	/** Reads the reviewed, server-selected onboarding source. */
	readonly source: PersonaOnboardingSourceRepository;
	/** Starts, answers, and completes immutable interview evidence. */
	readonly interviews: PersonaInterviewRepository;
	/** Derives a reviewable persona draft from completed evidence. */
	readonly drafts: PersonaDraftRepository;
	/** Approves and atomically activates a fully evidenced draft. */
	readonly personas: PersonaAuthorityRepository;
	/** Supplies server-authoritative timestamps. */
	readonly clock: { readonly now: () => Date };
	/** Records structured failures without including persona answers. */
	readonly logger: { readonly error: (attributes: object, message: string) => void };
}

/** Factory for the authenticated persona-onboarding router mounted by the OpenCrane app. */
export type CreatePersonaOnboardingRouter = (dependencies: PersonaOnboardingRouterDependencies) => Router;
