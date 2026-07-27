/** Coarse capability flags the UI uses to show/hide management controls. */
export interface Capabilities
{
	/** May reach the operator console (tenant/policy/budget management). */
	isOperator: boolean;

	/**
	 * Whether the session is a WeOwnAI **platform** operator — one who manages
	 * customers/ClusterTenants across the fleet from the super-opencrane-ui app,
	 * as opposed to a customer admin operating within a single account.
	 */
	isPlatformOperator: boolean;

	/**
	 * Whether the session is a **customer admin** — a customer's own
	 * administrator who manages agents and governed capabilities inside their
	 * ClusterTenant, as opposed to {@link isPlatformOperator}.
	 */
	customerAdmin: boolean;

	/** May onboard, configure, suspend, or delete customers (ClusterTenants). */
	manageCustomers: boolean;

	/** May edit AccessPolicy and dataset grants. */
	managePolicies: boolean;

	/** May set global or per-account AI budgets and provider keys. */
	manageBudgets: boolean;
}

/** The authenticated user identity, mirrored from `GET /auth/me`. */
export interface SessionUser
{
	/** Stable subject identifier from the identity provider. */
	sub: string;

	/** Email address, when the provider supplies one. */
	email?: string;

	/** Display name, when the provider supplies one. */
	name?: string;

	/**
	 * IdP role/group claims, derived by the OpenCrane server from the OIDC token's
	 * `roles`/`groups` claims and declared by the pinned `/auth/me` contract.
	 *
	 * Kept optional here for fail-closed defensiveness: a present `false`/`null` is
	 * authoritative, while `undefined` (an older backend or a mock gateway that
	 * omits the claim) grants nothing rather than elevating the session — see
	 * {@link _DeriveCapabilities}.
	 */
	groups?: string[];

	/**
	 * Whether the session is a WeOwnAI **platform** operator (manages the fleet).
	 * Optional for the same fail-closed reason as {@link groups}: the contract
	 * marks it required, but a missing claim must grant nothing, not elevate.
	 */
	isPlatformOperator?: boolean;

	/** Whether the session is a **customer/org admin** within its ClusterTenant (fail-closed-optional, as {@link isPlatformOperator}). */
	isOrgAdmin?: boolean;

	/** The caller's ClusterTenant (account/org), or `null` when bound to none. */
	clusterTenant?: string | null;
}
