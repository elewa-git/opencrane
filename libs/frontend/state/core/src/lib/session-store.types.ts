/**
 * Records the UI capabilities {@link _DeriveCapabilities} grants for the current application
 * surface. {@link SessionStore} derives every flag from authentication plus explicit role claims;
 * these in-memory hints hide controls but never replace authorization in the API.
 */
export interface Capabilities
{
	/** May reach the operator console for policy and budget management. */
	isOperator: boolean;

	/**
	 * Whether the session is an OpenCrane **platform** operator — one who manages
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

/**
 * Carries the transport-neutral identity returned by the configured {@link SessionGateway}.
 * {@link SessionStore} exposes it only when `sub` is present and treats omitted role booleans as
 * false, so an incomplete live response or local fixture cannot grant operator capabilities.
 */
export interface SessionUser
{
	/** Stable subject identifier from the identity provider. */
	sub: string;

	/** Email address, when the provider supplies one. */
	email?: string;

	/** Display name, when the provider supplies one. */
	name?: string;

	/** Role/group claims retained from identity; current capability derivation grants nothing from them. */
	groups?: string[];

	/**
	 * Whether the session is an OpenCrane **platform** operator (manages the fleet).
	 * This remains optional so an absent claim grants nothing through {@link _DeriveCapabilities}.
	 */
	isPlatformOperator?: boolean;

	/** Whether the session is a customer/org admin within its ClusterTenant; absence grants nothing. */
	isOrgAdmin?: boolean;

	/** The caller's ClusterTenant (account/org), or `null` when bound to none. */
	clusterTenant?: string | null;
}
