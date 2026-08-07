import type { AuthorizationScope } from "./authorization-scope.types.js";
import type { CapabilityReference } from "./capability.types.js";
import type { AuthorizationResourceLocator } from "./resource-locator.types.js";

/** Effect applied by an authorization grant. */
export type AuthorizationGrantEffect = "allow" | "deny";

/** Prioritized capability grant for one subject and scope. */
export interface AuthorizationGrant
{
	/** Stable grant identifier used in audit evidence. */
	grantId: string;
	/** Stable silo identifier in which the grant is valid. */
	siloId: string;
	/** Stable subject identifier receiving the grant. */
	subjectId: string;
	/** Independent resource scope covered by the grant. */
	scope: AuthorizationScope;
	/** Immutable capability catalog reference covered by the grant. */
	capability: CapabilityReference;
	/** Exact resource covered by the grant, with no implicit wildcard or hierarchy. */
	resource: AuthorizationResourceLocator;
	/** Allow or deny effect applied when this grant wins. */
	effect: AuthorizationGrantEffect;
	/** Non-negative integer precedence where a larger number has higher priority. */
	priority: number;
	/** Trusted epoch-millisecond boundary at which the grant becomes valid. */
	validFromEpochMs: number;
	/** Optional exclusive epoch-millisecond expiry boundary. */
	expiresAtEpochMs: number | null;
	/** Optional epoch-millisecond revocation time; any recorded revocation disables the grant. */
	revokedAtEpochMs: number | null;
}

/** Authorization request evaluated against grants. */
export interface AuthorizationRequest
{
	/** Stable silo identifier containing the requested action. */
	siloId: string;
	/** Stable identifier of the subject attempting the action. */
	subjectId: string;
	/** Exact independent resource scope targeted by the action. */
	scope: AuthorizationScope;
	/** Immutable capability reference required by the action. */
	capability: CapabilityReference;
	/** Exact resource targeted by the action. */
	resource: AuthorizationResourceLocator;
	/** Trusted current epoch-millisecond time used for grant validity. */
	nowEpochMs: number;
}

/** Reason returned by deterministic grant evaluation. */
export type AuthorizationDecisionReason =
	"winning_allow"
	| "winning_deny"
	| "no_matching_grant"
	| "invalid_request_time"
	| "invalid_grant_priority"
	| "invalid_grant_validity";

/** Stable result vocabulary emitted by deterministic authorization evaluation. */
export enum AuthorizationDecisionOutcomes
{
	/** At least one valid winning grant permits the exact request. */
	Allow = "allow",
	/** No valid winning grant permits the exact request, so evaluation fails closed. */
	Deny = "deny",
}

/** Fail-closed result of deterministic grant evaluation. */
export interface AuthorizationDecision
{
	/** Final authorization outcome. */
	outcome: AuthorizationDecisionOutcomes;
	/** Stable reason explaining the decision. */
	reason: AuthorizationDecisionReason;
	/** Grant identifiers at the winning priority or invalid boundary. */
	grantIds: readonly string[];
	/** Winning priority when valid matching grants exist. */
	winningPriority?: number;
}
