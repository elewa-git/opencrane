/** Verified OIDC facts admitted against the silo selected by the trusted request host. */
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
	 * Called by: {@link ___AuthMiddleware} before any authenticated product route runs.
	 * @returns The exact local Principal, or null when the projection cannot prove the identity tuple.
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
