import type { AuthorizationDecision, AuthorizationGrant, AuthorizationResourceLocator, AuthorizationScope, CapabilityReference } from "@opencrane/models/authorization";

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
	/** Exact independent authorization scope required by the request. */
	readonly scope: AuthorizationScope;
	/** Trusted current epoch-millisecond time. */
	readonly nowEpochMs: number;
	/** Maximum permitted signed membership age. */
	readonly maximumStalenessMs: number;
}

/** Fail-closed result returned by the signed-membership authority port. */
export type AuthorizationMembershipDecision =
	| { readonly outcome: "trusted"; readonly revision: number; readonly trustedUntilEpochMs: number }
	| { readonly outcome: "denied"; readonly reason: string; readonly revision: number };

/** Port to the signed fleet-membership authority without coupling to its adapter. */
export interface AuthorizationMembershipAuthority
{
	/** Evaluates the current signed membership revision for the exact request scope. */
	verifyCurrentMembership(requirement: AuthorizationMembershipRequirement): Promise<AuthorizationMembershipDecision>;
}

/** Persistence boundary for grants assigned to one exact subject in one silo. */
export interface AuthorizationGrantRepository
{
	/** Lists every candidate grant for deterministic domain evaluation. */
	listSubjectGrants(siloId: string, subjectId: string): Promise<readonly AuthorizationGrant[]>;
}

/** Command that intersects a human actor's access with an AgentService's delegated access. */
export interface ResolveEffectiveAccessCommand
{
	/** Current signed membership requirement for the human actor. */
	readonly membership: AuthorizationMembershipRequirement;
	/** Human actor whose grants form one side of the intersection. */
	readonly actorSubjectId: string;
	/** Stable AgentService authority subject whose grants form the other side. */
	readonly agentServiceSubjectId: string;
	/** Exact independent resource scope requested. */
	readonly scope: AuthorizationScope;
	/** Exact resource locator requested within the independent scope. */
	readonly resource: AuthorizationResourceLocator;
	/** Candidate immutable capabilities requested for the run or action. */
	readonly capabilities: readonly CapabilityReference[];
	/** Immutable maximum capability set published with the AgentRevision. */
	readonly agentRevisionCapabilityCeiling: readonly CapabilityReference[];
	/** Immutable effective capability set compiled for this run. */
	readonly runCapabilitySet: readonly CapabilityReference[];
}

/** Per-capability evidence retained for deterministic effective-access decisions. */
export interface EffectiveCapabilityEvidence
{
	/** Immutable capability that was evaluated. */
	readonly capability: CapabilityReference;
	/** Human actor's deterministic grant decision. */
	readonly actorDecision: AuthorizationDecision;
	/** AgentService authority's deterministic grant decision. */
	readonly agentServiceDecision: AuthorizationDecision;
}

/** Deterministic effective-access result after membership and grant intersection. */
export type ResolveEffectiveAccessResult =
	| { readonly outcome: "allowed"; readonly fleetMembershipRevision: number; readonly capabilities: readonly CapabilityReference[]; readonly evidence: readonly EffectiveCapabilityEvidence[] }
	| { readonly outcome: "denied"; readonly reason: "invalid_command" | "membership_denied" | "membership_stale" | "outside_revision_ceiling" | "outside_run_capability_set" | "empty_intersection"; readonly membershipReason?: string; readonly evidence: readonly EffectiveCapabilityEvidence[] };
