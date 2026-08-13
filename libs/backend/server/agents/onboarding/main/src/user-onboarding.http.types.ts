import type { Request } from "express";

import type { Logger } from "@opencrane/backend/observability";

import type { ApprovedPersonaEvidence, UserOnboardingOwner } from "./user-onboarding.types.js";
import type { __UserOnboardingAuthority } from "./user-onboarding-authority.js";
import type { __UserOnboardingChatAuthority } from "./user-onboarding-chat-authority.js";

/**
 * Turns one HTTP request into the user whose onboarding it may touch, or null when not signed in.
 *
 * This is the only place the router learns who is calling, and it must read the verified server
 * session and nothing else - never a body field, a query parameter, or a header. Any other source
 * would let a signed-in user drive somebody else's onboarding. Returning null makes the router
 * answer 401 without reaching any authority.
 *
 * Called by: every route built in __CreateUserOnboardingRouter; supplied by the app as
 * `_ResolveUserOnboardingOwner` in apps/opencrane/src/app/routes.ts.
 */
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
	/** Deterministic onboarding-only guided chat authority. */
	readonly chatAuthority: __UserOnboardingChatAuthority;
	/** Session principal adapter that never reads owner coordinates from request input. */
	readonly resolveOwner: UserOnboardingOwnerResolver;
	/** App-owned structured logger for unexpected authority failures. */
	readonly logger: Logger;
}

/**
 * The two things the persona package tells onboarding about, so persona never writes onboarding rows.
 *
 * Both methods return void and throw on refusal, because a persona request that onboarding will not
 * accept must fail the persona call rather than leave the two sides disagreeing. Onboarding
 * re-verifies both notifications against the persona evidence port before writing anything, so a
 * replayed or out-of-order notification is safe.
 *
 * Implemented by: UserOnboardingPersonaWorkflowCoordinator in user-onboarding.http.ts, adapted to
 * persona's own port in apps/opencrane/src/app/user-onboarding-composition.ts.
 */
export interface UserOnboardingPersonaWorkflowPort
{
	/** Record the exact owner-bound survey interview. */
	surveyStarted(owner: UserOnboardingOwner, interviewId: string): Promise<void>;
	/** Verify and pin the exact approved revision before bootstrap routing. */
	personaApproved(owner: UserOnboardingOwner, evidence: ApprovedPersonaEvidence): Promise<void>;
}
