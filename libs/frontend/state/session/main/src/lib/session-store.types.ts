/**
 * Product authorization hints returned with the current session.
 *
 * The server reads these from `AuthorizationAuthority`; the browser uses them only to present
 * controls, while every API operation repeats its own current authorization check.
 */
export interface SessionProductCapabilities
{
	/** Whether the current local Principal may administer this organisation. */
	administerOrganization?: boolean;
}

/**
 * Records the coarse UI capabilities granted for the current application surface.
 * These in-memory hints hide controls but never replace authorization in the API.
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

	/** Product permissions read from the server's central authorization authority. */
	productCapabilities?: SessionProductCapabilities;

	/** The caller's ClusterTenant (account/org), or `null` when bound to none. */
	clusterTenant?: string | null;
}
