import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import type { AuthenticatedPrincipalAdmissionInput } from "@opencrane/backend/server/infra/auth";

/** Builds central authorization over the identity transaction used for `/auth/me`. */
export type AuthenticatedPrincipalCapabilityAuthorizationFactory<Transaction> = (transaction: Transaction) => AuthorizationAuthority;

/** Reads current product capabilities for a verified human identity. */
export interface AuthenticatedPrincipalCapabilityReader
{
	/**
	 * Reads the current `organization:administer` decision for the identity's host silo.
	 * @param input - Silo, issuer, and subject derived from the verified session and request host.
	 * @returns True when the central authority currently allows organisation administration.
	 */
	canAdministerOrganization(input: AuthenticatedPrincipalAdmissionInput): Promise<boolean>;
}
