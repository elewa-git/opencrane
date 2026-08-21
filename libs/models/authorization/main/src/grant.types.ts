import type { AuthorizationBoundary, AuthorizationBoundaryCoverages, AuthorizationSubject } from "./authorization-boundary.types";
import type { CapabilityReference } from "./capability.types";
import type { AuthorizationResourceLocator } from "./resource-locator.types";

/** Whether a grant allows or denies. At the winning priority a single deny beats every allow. @see {@link __DecideAuthorization} */
export enum AuthorizationGrantEffects
{
	/** The winning grant permits the requested action. */
	Allow = "allow",
	/** The winning grant refuses the requested action. */
	Deny = "deny",
}

/** One grant: it allows or denies one capability on one resource, for one subject and product boundary, during a time window. Higher `priority` replaces lower rather than adding to it. */
export interface AuthorizationGrant
{
	/** Stable grant identifier used in audit evidence. */
	grantId: string;
	/** Stable silo identifier in which the grant is valid. */
	siloId: string;
	/** Principal or group that receives the grant. */
	subject: AuthorizationSubject;
	/** Stored product boundary covered by the grant. */
	boundary: AuthorizationBoundary;
	/** Whether the grant reaches just its boundary or the stored group subtree below it. */
	boundaryCoverage: AuthorizationBoundaryCoverages;
	/** Immutable capability catalog reference covered by the grant. */
	capability: CapabilityReference;
	/** Exact resource covered by the grant, with no implicit wildcard or hierarchy. */
	resource: AuthorizationResourceLocator;
	/** Allow or deny effect applied when this grant wins. */
	effect: AuthorizationGrantEffects;
	/** Non-negative integer precedence where a larger number has higher priority. */
	priority: number;
	/** Trusted epoch-millisecond boundary at which the grant becomes valid. */
	validFromEpochMs: number;
	/** Optional exclusive epoch-millisecond expiry boundary. */
	expiresAtEpochMs: number | null;
	/** Optional epoch-millisecond revocation time; any recorded revocation disables the grant. */
	revokedAtEpochMs: number | null;
}

/** One action being attempted. `nowEpochMs` is supplied by the caller, not read from the system clock, so a decision is reproducible from an audit record. */
export interface AuthorizationRequest
{
	/** Stable silo identifier containing the requested action. */
	siloId: string;
	/** Principal and direct stored groups being evaluated as one authorization context. */
	subjects: readonly AuthorizationSubject[];
	/** Exact stored product boundary targeted by the action. */
	boundary: AuthorizationBoundary;
	/** Immutable capability reference required by the action. */
	capability: CapabilityReference;
	/** Exact resource targeted by the action. */
	resource: AuthorizationResourceLocator;
	/** Trusted current epoch-millisecond time used for grant validity. */
	nowEpochMs: number;
}

/** Why a decision came out as it did. Safe to log; several reasons mean deny, so a caller must read `outcome` rather than inferring it from the reason. */
export type AuthorizationDecisionReason =
	"winning_allow"
	| "winning_deny"
	| "no_matching_grant"
	| "invalid_request_time"
	| "invalid_grant_priority"
	| "invalid_grant_validity"
	| "invalid_grant_boundary";

/** The two possible outcomes: allow or deny. There is no third, indeterminate answer — evaluation always resolves. */
export enum AuthorizationDecisionOutcomes
{
	/** At least one valid winning grant permits the exact request. */
	Allow = "allow",
	/** No valid winning grant permits the exact request, so evaluation fails closed. */
	Deny = "deny",
}

/** The decision. `grantIds` names the grants at the winning priority, or the offending grants when the deny was caused by malformed data — so it is evidence for an audit, not a list of grants that applied. */
export interface AuthorizationDecision
{
	/** Final authorization outcome. */
	outcome: AuthorizationDecisionOutcomes;
	/** Stable reason explaining the decision. */
	reason: AuthorizationDecisionReason;
	/** Grant identifiers at the winning priority or invalid boundary. */
	grantIds: readonly string[];
	/** The priority that decided the outcome, or absent when no valid matching grant existed. */
	winningPriority?: number;
}
