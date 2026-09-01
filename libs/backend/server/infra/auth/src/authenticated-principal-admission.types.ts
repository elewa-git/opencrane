/**
 * Carries identity coordinates that server middleware has verified against startup configuration
 * and the request host. Production OIDC and Tier 2 development middleware build this input; request
 * bodies must never supply it.
 */
export interface AuthenticatedPrincipalAdmissionInput
{
	/** Silo derived from the trusted request host. */
	readonly siloId: string;
	/** OIDC issuer already matched to the configured authentication authority. */
	readonly issuer: string;
	/** Stable subject from the verified OIDC token. */
	readonly subject: string;
}

/** Durable local identity attached only after projection and exact Principal resolution succeed. */
export interface AuthenticatedRequestPrincipal
{
	/** Stable local Principal ID used by product authorization and ownership. */
	readonly principalId: string;
	/** Silo selected from the trusted request host and matched by the local Principal. */
	readonly siloId: string;
	/** Verified OIDC issuer used to resolve the local Principal. */
	readonly issuer: string;
	/** Verified OIDC subject used to resolve the local Principal. */
	readonly subject: string;
}

/** Resolves the exact local Principal established by the silo-bound login before route admission. */
export interface AuthenticatedPrincipalAdmission
{
	/**
	 * Resolve one verified identity and return its exact durable Principal.
	 *
	 * Called by: {@link _AdmitBrowserSession}, the shared durable identity gate for production and Tier 2 browser authentication.
	 * @param input - Identity coordinates established by the active authentication mode.
	 * @returns The matched local Principal, or `null` when the projection cannot prove the tuple.
	 * @throws When the identity projection cannot be read or reconciled.
	 */
	admit(input: AuthenticatedPrincipalAdmissionInput): Promise<AuthenticatedRequestPrincipal | null>;
}

declare global
{
	namespace Express
	{
		interface Request
		{
			/** Durable identity established by the authenticated admission middleware. */
			authenticatedPrincipal?: AuthenticatedRequestPrincipal;
		}
	}
}
