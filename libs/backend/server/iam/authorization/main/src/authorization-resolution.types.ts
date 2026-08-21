import type { AuthorizationBoundary, AuthorizationBoundaryContext, AuthorizationDecision, AuthorizationGrant, AuthorizationRequest, AuthorizationSubject, CapabilityReference, AuthorizationResourceLocator } from "@opencrane/models/authorization";

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

/** One generic authorization request made for an authenticated local principal. */
export interface ResolvePrincipalAuthorizationCommand
{
	/** Silo derived from trusted deployment and membership state. */
	readonly siloId: string;
	/** Local principal resolved from the verified login identity. */
	readonly principalId: string;
	/** Product boundary targeted by the action. */
	readonly boundary: AuthorizationBoundary;
	/** Immutable capability required by the action. */
	readonly capability: CapabilityReference;
	/** Exact resource targeted by the action. */
	readonly resource: AuthorizationResourceLocator;
	/** Trusted time used for grant validity checks. */
	readonly nowEpochMs: number;
}

/** The generic principal authorization result returned to product adapters. */
export type ResolvePrincipalAuthorizationResult = AuthorizationDecision;
