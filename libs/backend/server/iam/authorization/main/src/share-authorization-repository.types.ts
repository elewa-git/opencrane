import type { JsonValue } from "@opencrane/util";
import type { AuthorizationBoundary, AuthorizationBoundaryCoverages, AuthorizationSubject } from "@opencrane/models/authorization";

/** A persisted capability-catalog revision used to bind a share to its evaluated capability. */
export interface ShareCapabilityCatalogRevision
{
	/** Stable catalog identifier controlled by the authorization authority. */
	readonly catalogId: string;
	/** Immutable revision number within the catalog. */
	readonly revision: number;
	/** Canonical digest of the capability entries in this revision. */
	readonly digest: string;
	/** Capability entries retained as canonical JSON. */
	readonly capabilities: JsonValue;
	/** System or operator identity that created the revision. */
	readonly createdBy: string;
}

/** A share-shaped authorization grant persisted for one recipient in one silo. */
export interface ShareAuthorizationGrant
{
	/** Stable authorization-grant identifier. */
	readonly id: string;
	/** Principal or group that receives the share. */
	readonly subject: AuthorizationSubject;
	/** Product boundary covered by the share. */
	readonly boundary: AuthorizationBoundary;
	/** Exact or descendant coverage assigned to the boundary. */
	readonly boundaryCoverage: AuthorizationBoundaryCoverages;
	/** Stable resource family, for example `mcp-server`. */
	readonly resourceKind: string;
	/** Exact resource instance granted to the recipient. */
	readonly resourceId: string;
	/** Subject that created this delegating grant. */
	readonly createdBy: string;
	/** Time at which the grant became durable. */
	readonly createdAt: Date;
}

/** Input for creating a least-privilege share authorization grant. */
export interface CreateShareAuthorizationGrant
{
	/** Silo that scopes every participant and resource lookup. */
	readonly siloId: string;
	/** Optional bounded product editor that owns future reconciliation of this grant. */
	readonly managerId?: string;
	/** Principal or group that receives the grant. */
	readonly subject: AuthorizationSubject;
	/** Product boundary covered by the share. */
	readonly boundary: AuthorizationBoundary;
	/** Exact or descendant coverage assigned to the boundary. */
	readonly boundaryCoverage: AuthorizationBoundaryCoverages;
	/** Catalog that owns the share capability. */
	readonly catalogId: string;
	/** Revision that defined the share capability. */
	readonly catalogRevision: number;
	/** Digest that proves the exact capability catalog revision. */
	readonly catalogDigest: string;
	/** Capability granted to the recipient. */
	readonly capabilityId: string;
	/** Resource family granted to the recipient. */
	readonly resourceKind: string;
	/** Exact resource instance granted to the recipient. */
	readonly resourceId: string;
	/** Deterministic precedence assigned to the new share grant. */
	readonly priority: number;
	/** Existing principal who is sharing this capability. */
	readonly createdByPrincipalId: string;
}

/** Result of creating a share or returning the pre-existing durable entitlement. */
export interface CreateOrFindShareAuthorizationGrantResult
{
	/** The one durable share grant matching the exact authority coordinates. */
	readonly share: ShareAuthorizationGrant;
	/** Whether this request inserted the grant instead of finding an existing one. */
	readonly created: boolean;
}

/** Reads and writes the capability-catalog and grant rows that sharing needs. */
export interface ShareAuthorizationRepository
{
	/** Creates the fixed catalog revision once, or returns the already durable digest. */
	ensureCatalogRevision(revision: ShareCapabilityCatalogRevision): Promise<string>;
	/** Atomically creates one share, or returns the existing matching grant when a concurrent insert won. */
	createOrFindExactShare(input: CreateShareAuthorizationGrant): Promise<CreateOrFindShareAuthorizationGrantResult>;
	/** Lists only live grants for the fixed share capability created in one exact silo. */
	listActiveShares(siloId: string, createdBy: string, catalogId: string, capabilityId: string): Promise<readonly ShareAuthorizationGrant[]>;
	/** Deletes a share only when it belongs to the requesting subject in the exact silo. */
	revokeOwnedShare(siloId: string, createdBy: string, grantId: string): Promise<boolean>;
	/** Deletes an exact share grant only when both the principal and bounded manager own it. */
	revokeManagedShare(siloId: string, managerId: string, createdBy: string, grantId: string): Promise<boolean>;
}
