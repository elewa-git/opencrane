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
	/** Trusted server operation time used to activate new grants and revoke omitted grants. Reuse it for same-operation decisions; never take it from request data. Existing grant activation times remain unchanged. */
	readonly now: Date;
}

/** Removes manager-owned grants outside an approved maximum without creating replacements. */
export interface RestrictManagedAuthorizationGrantsCommand
{
	/** Silo that owns the grants and resource. */
	readonly siloId: string;
	/** Stable editor identifier used to isolate restriction ownership. */
	readonly managerId: string;
	/** Exact resource whose editor-owned grants are restricted. */
	readonly resource: AuthorizationResourceLocator;
	/** Maximum exact grant set that may remain unrevoked; absent grants are never created and existing validity dates are unchanged. */
	readonly retainedGrants: readonly ManagedAuthorizationGrantSpec[];
	/** Trusted server operation time used to revoke grants outside the retained set. */
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
	/** Reconciles one editor's grants and soft-revokes entries omitted from the desired set. */
	reconcileManagedResourceGrants(command: ReconcileManagedAuthorizationGrantsCommand): Promise<number>;
}

/** Narrows one product editor's unrevoked grants without creating or reactivating any grant. */
export interface ManagedAuthorizationGrantRestrictionRepository
{
	/** Soft-revokes unrevoked grants outside the retained maximum, including future-dated and expired grants. Retained grants keep their validity dates. */
	restrictManagedResourceGrants(command: RestrictManagedAuthorizationGrantsCommand): Promise<number>;
}
