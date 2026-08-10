import type { Request } from "express";

import type { Logger } from "@opencrane/backend/observability";

import type { ApprovedPersonaEvidence, UserOnboardingOwner } from "./user-onboarding.types.js";
import type { __UserOnboardingAuthority } from "./user-onboarding-authority.js";

/** Session owner resolver injected by the app composition root. */
export interface UserOnboardingOwnerResolver
{
	/** Resolve trusted silo and subject facts, or null when unauthenticated. */
	(request: Request): UserOnboardingOwner | null;
}

/** Named dependencies for the owner-only onboarding route-state boundary. */
export interface UserOnboardingRouterDependencies
{
	/** Durable route-state authority. */
	readonly authority: __UserOnboardingAuthority;
	/** Session principal adapter that never reads owner coordinates from request input. */
	readonly resolveOwner: UserOnboardingOwnerResolver;
	/** App-owned structured logger for unexpected authority failures. */
	readonly logger: Logger;
}

/** Persona lifecycle notifications accepted by the onboarding workflow. */
export interface UserOnboardingPersonaWorkflowPort
{
	/** Record the exact owner-bound survey interview. */
	surveyStarted(owner: UserOnboardingOwner, interviewId: string): Promise<void>;
	/** Verify and pin the exact approved revision before bootstrap routing. */
	personaApproved(owner: UserOnboardingOwner, evidence: ApprovedPersonaEvidence): Promise<void>;
}
