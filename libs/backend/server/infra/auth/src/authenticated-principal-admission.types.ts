/**
 * Carries identity coordinates that server middleware has verified against startup configuration
 * and the request host. Production OIDC and Tier 3 development middleware build this input; request
 * bodies must never supply it.
 */
export interface AuthenticatedPrincipalAdmissionInput
{
	/** Silo derived from the trusted request host. */
	readonly siloId: string;
	/** Issuer already matched to the startup-selected authentication authority. */
	readonly issuer: string;
	/** Stable subject from the verified external or fixed development authority. */
	readonly subject: string;
}

/**
 * Carries the local Principal admitted after its stored identity matches every verified coordinate.
 * Product routes use this request value for authorization and ownership; raw session claims alone
 * cannot replace it.
 */
export interface AuthenticatedRequestPrincipal
{
	/** Identifies the local Principal used by product authorization and ownership. */
	readonly principalId: string;
	/** Silo selected from the trusted request host and matched by the local Principal. */
	readonly siloId: string;
	/** Verified issuer used to resolve the local Principal. */
	readonly issuer: string;
	/** Verified subject used to resolve the local Principal. */
	readonly subject: string;
}

/**
 * Converts a server-verified identity tuple into the local Principal attached to a product request.
 * Returning `null` denies the request as unauthenticated; throwing reports the identity projection
 * as unavailable, so callers must not treat those outcomes as equivalent.
 */
export interface AuthenticatedPrincipalAdmission
{
	/**
	 * Resolves a verified identity and returns the Principal whose stored tuple still matches it.
	 *
	 * Called by: {@link ___AuthMiddleware} and {@link ___DevelopmentAuthMiddleware} before any authenticated product route runs.
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
			/** Holds the Principal admitted for this request after authentication succeeds. */
			authenticatedPrincipal?: AuthenticatedRequestPrincipal;
		}
	}
}
