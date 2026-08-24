import type { AuthorizationBoundary, AuthorizationDecision, AuthorizationResourceLocator, CapabilityReference } from "@opencrane/models/authorization";

import type { AuthorizationContextRepository } from "./authorization-resolution.types";

/** Whether the membership authority trusted the request. */
export enum AuthorizationMembershipOutcomes
{
	/** A signed membership revision is current for the exact requested scope. */
	Trusted = "trusted",
	/** No current signed membership revision authorizes the exact requested scope. */
	Denied = "denied",
}

	/** Exact signed-membership requirement evaluated before grant intersection. */
export interface AuthorizationMembershipRequirement
{
	/** Fleet issuer trusted for membership evidence. */
	readonly trustedIssuerId: string;
	/** Silo containing the subject and requested resources. */
	readonly siloId: string;
	/** Human subject whose current membership is required. */
	readonly subjectId: string;
	/** Stable signed assertion identifier required by the request. */
	readonly assertionId: string;
	/** Trusted current epoch-millisecond time. */
	readonly nowEpochMs: number;
	/** Maximum permitted signed membership age. */
	readonly maximumStalenessMs: number;
}

/** Fail-closed result returned by the signed-membership authority port. */
export type AuthorizationMembershipDecision =
	| { readonly outcome: "trusted"; readonly revision: number; readonly trustedUntilEpochMs: number }
	| { readonly outcome: "denied"; readonly reason: string; readonly revision: number };

/**
 * Asks whether a person currently holds a signed membership for the requested scope.
 *
 * Kept as a port so access resolution never learns how memberships are signed or stored. This is a
 * mandatory first gate: membership may never be inferred from the grants a subject happens to have.
 *
 * Called by: ./effective-access.ts (`__ResolveEffectiveAccess`).
 * Implemented by: libs/backend/server/iam/membership/main/src/prisma-membership-authority.ts.
 */
export interface AuthorizationMembershipAuthority
{
	/**
	 * Checks the caller's membership for one scope at one instant.
	 * @param requirement - The scope, the subject, the trusted current time, and how stale a signed
	 *   membership may be.
	 * @returns `trusted` with the revision and the instant it stops being trusted, or `denied` with a
	 *   reason. The caller must still check the returned expiry itself — see `membership_stale` in
	 *   {@link ResolveEffectiveAccessResult}.
	 */
	verifyCurrentMembership(requirement: AuthorizationMembershipRequirement): Promise<AuthorizationMembershipDecision>;
}

/**
 * Reads the grants that might apply to one subject.
 *
 * Returns candidates only — no filtering by capability or resource — because the decision itself is
 * pure domain code that must see every candidate to apply deny-over-allow and priority ordering.
 *
 * Called by: ./effective-access.ts. Implemented by: ./prisma-authorization-grants.ts.
 */
export type AuthorizationGrantRepository = AuthorizationContextRepository;

/**
 * One request to work out what an agent may do on a person's behalf.
 *
 * The answer is an intersection: a capability survives only if the person is allowed it AND the
 * agent's own authority is allowed it, and only if it is inside both the revision's published
 * maximum and the set compiled for this run. Neither side can widen the other.
 */
export interface ResolveEffectiveAccessCommand
{
	/** Current signed membership requirement for the human actor. */
	readonly membership: AuthorizationMembershipRequirement;
	/** Human actor whose grants form one side of the intersection. */
	readonly actorSubjectId: string;
	/** Stable AgentService authority subject whose grants form the other side. */
	readonly agentServiceSubjectId: string;
	/** Exact product boundary requested. */
	readonly boundary: AuthorizationBoundary;
	/** Exact resource locator requested within the independent scope. */
	readonly resource: AuthorizationResourceLocator;
	/** Candidate immutable capabilities requested for the run or action. */
	readonly capabilities: readonly CapabilityReference[];
	/** Immutable maximum capability set published with the AgentRevision. */
	readonly agentRevisionCapabilityCeiling: readonly CapabilityReference[];
	/** Immutable effective capability set compiled for this run. */
	readonly runCapabilitySet: readonly CapabilityReference[];
}

/**
 * Both sides' decisions for one capability, kept whether it was allowed or not.
 *
 * Returned on denials too, so "why was this refused?" can be answered without re-running the
 * evaluation.
 */
export interface EffectiveCapabilityEvidence
{
	/** Immutable capability that was evaluated. */
	readonly capability: CapabilityReference;
	/** Human actor's deterministic grant decision. */
	readonly actorDecision: AuthorizationDecision;
	/** AgentService authority's deterministic grant decision. */
	readonly agentServiceDecision: AuthorizationDecision;
}

/**
 * What the caller may actually do, or precisely why not.
 *
 * `allowed` lists only capabilities both sides permit, in a stable order, with the membership
 * revision that authorised it. The denial reasons say where the request died: `invalid_command`
 * (malformed input, checked before any query), `membership_denied` / `membership_stale` (the first
 * gate), `outside_revision_ceiling` / `outside_run_capability_set` (asked for something this agent
 * revision or run never published), `empty_intersection` (both sides were asked, neither pair
 * agreed). Only the last one carries per-capability evidence.
 */
export type ResolveEffectiveAccessResult =
	| { readonly outcome: "allowed"; readonly fleetMembershipRevision: number; readonly capabilities: readonly CapabilityReference[]; readonly evidence: readonly EffectiveCapabilityEvidence[] }
	| { readonly outcome: "denied"; readonly reason: "invalid_command" | "membership_denied" | "membership_stale" | "outside_revision_ceiling" | "outside_run_capability_set" | "empty_intersection"; readonly membershipReason?: string; readonly evidence: readonly EffectiveCapabilityEvidence[] };
