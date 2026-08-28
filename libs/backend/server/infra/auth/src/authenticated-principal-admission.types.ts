/** Server-verified identity facts admitted against one trusted silo authority. */
export interface AuthenticatedPrincipalAdmissionInput
{
	/** Silo derived from the trusted request host. */
	readonly siloId: string;
	/** Issuer already matched to the startup-selected authentication authority. */
	readonly issuer: string;
	/** Stable subject from the verified external or fixed development authority. */
	readonly subject: string;
}

/** Durable local identity attached only after projection and exact Principal resolution succeed. */
export interface AuthenticatedRequestPrincipal
{
	/** Stable local Principal ID used by product authorization and ownership. */
	readonly principalId: string;
	/** Silo selected from the trusted request host and matched by the local Principal. */
	readonly siloId: string;
	/** Verified issuer used to resolve the local Principal. */
	readonly issuer: string;
	/** Verified subject used to resolve the local Principal. */
	readonly subject: string;
}

/** Resolves the exact local Principal established by the silo-bound login before route admission. */
export interface AuthenticatedPrincipalAdmission
{
	/**
	 * Resolve one verified identity and return its exact durable Principal.
	 *
	 * Called by: {@link ___AuthMiddleware} and {@link ___DevelopmentAuthMiddleware} before any authenticated product route runs.
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
