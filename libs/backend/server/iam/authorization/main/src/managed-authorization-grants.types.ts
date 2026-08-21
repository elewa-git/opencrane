import type { AuthorizationBoundary, AuthorizationBoundaryCoverages, AuthorizationSubject, CapabilityReference, AuthorizationResourceLocator } from "@opencrane/models/authorization";

/** One allow grant owned by a product access editor. */
export interface ManagedAuthorizationGrantSpec
{
	/** Principal or group that receives the managed grant. */
	readonly subject: AuthorizationSubject;
	/** Product boundary covered by the managed grant. */
	readonly boundary: AuthorizationBoundary;
	/** Exact or descendant coverage applied to the boundary. */
	readonly boundaryCoverage: AuthorizationBoundaryCoverages;
	/** Immutable capability granted by the editor. */
	readonly capability: CapabilityReference;
	/** Exact resource granted by the editor. */
	readonly resource: AuthorizationResourceLocator;
	/** Precedence assigned by the owning editor. */
	readonly priority: number;
	/** Principal that performed the change for audit. */
	readonly createdByPrincipalId: string;
}

/** Reconciles one editor's grants for an exact resource without touching grants from other sources. */
export interface ReconcileManagedAuthorizationGrantsCommand
{
	/** Silo that owns the grants and resource. */
	readonly siloId: string;
	/** Stable editor identifier used to isolate reconciliation ownership. */
	readonly managerId: string;
	/** Exact resource whose editor-owned grants are reconciled. */
	readonly resource: AuthorizationResourceLocator;
	/** Complete desired allow-grant set owned by this editor for the resource. */
	readonly grants: readonly ManagedAuthorizationGrantSpec[];
	/** Trusted time recorded when grants omitted from the desired set are revoked. */
	readonly now: Date;
}

/** Validated desired state produced before a managed-grant transaction writes anything. */
export interface ManagedAuthorizationGrantPlan
{
	/** Desired grants keyed by their stable authority coordinates. */
	readonly desiredByKey: ReadonlyMap<string, ManagedAuthorizationGrantSpec>;
}

/** Writes grants owned by one product editor while preserving grants from every other source. */
export interface ManagedAuthorizationGrantRepository
{
	/** Lists one editor's live grants for an exact resource. */
	listManagedResourceGrants(siloId: string, managerId: string, resource: AuthorizationResourceLocator): Promise<readonly ManagedAuthorizationGrantSpec[]>;
	/** Reconciles one editor's grants and soft-revokes entries omitted from the desired set. */
	reconcileManagedResourceGrants(command: ReconcileManagedAuthorizationGrantsCommand): Promise<number>;
}
