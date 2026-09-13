import type { AuthorizationBoundary, AuthorizationBoundaryContext, AuthorizationGrant, AuthorizationSubject } from "@opencrane/models/authorization";

/** Reads authorization inputs from product authority before the pure decision runs. */
export interface AuthorizationContextRepository
{
	/** Resolves one principal plus groups with a direct stored membership. */
	resolvePrincipalSubjects(siloId: string, principalId: string): Promise<readonly AuthorizationSubject[]>;
	/** Loads hierarchy evidence for the requested boundary from the silo database. */
	resolveBoundaryContext(siloId: string, boundary: AuthorizationBoundary): Promise<AuthorizationBoundaryContext>;
	/** Lists candidate grants for the resolved principal and direct groups. */
	listSubjectGrants(siloId: string, subjects: readonly AuthorizationSubject[]): Promise<readonly AuthorizationGrant[]>;
}
