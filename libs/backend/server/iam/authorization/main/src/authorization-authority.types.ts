import type { AuthorizationBoundary, ProductAuthorizationActions, ProductAuthorizationCommand, ProductAuthorizationResourceLocator, ProductAuthorizationResult } from "@opencrane/models/authorization";
import type { ManagedAuthorizationGrantSpec } from "./managed-authorization-grants.types";

/** Actor classes written into durable authorization evidence. */
export type ProductAuthorizationActorKind = "user" | "agent-service" | "workload" | "system";

/** One product action that must commit durable authorization evidence. */
export interface AdmitProductAuthorizationCommand extends ProductAuthorizationCommand
{
	/** Class of Principal that caused the protected operation. */
	readonly actorKind: ProductAuthorizationActorKind;
	/** Stable local identifier of the actor that caused the operation. */
	readonly actorId: string;
	/** Digest of canonical action arguments, including an empty object for argument-free actions. */
	readonly argumentsDigest: `sha256:${string}`;
	/** Accepted membership revision when membership contributed to this decision. */
	readonly membershipRevision?: number;
}

/** One product action admitted across a Principal's stored personal and direct Group boundaries. */
export type AdmitPrincipalProductAuthorizationCommand = Omit<AdmitProductAuthorizationCommand, "boundary">;

/** Durable evidence derived by the authority rather than supplied as an allow assertion. */
export interface ProductAuthorizationAdmissionEvidence
{
	/** Digest of the complete decision record. */
	readonly decisionDigest: `sha256:${string}`;
	/** Digest of the reviewed product policy catalogue. */
	readonly policyRevisionHash: `sha256:${string}`;
	/** Digest of the winning current grant set. */
	readonly effectiveAuthorizationDigest: `sha256:${string}`;
}

/** Result of a mutation or effect admission. */
export interface AdmitProductAuthorizationResult extends ProductAuthorizationResult
{
	/** Evidence written in the same transaction, or null when the action was denied. */
	readonly evidence: ProductAuthorizationAdmissionEvidence | null;
}

/** Appends authority-derived evidence through the caller's open transaction. */
export interface ProductAuthorizationDecisionRecorder
{
	/** Persists one allowed non-read decision before the transaction may commit. */
	record(command: AdmitProductAuthorizationCommand, result: AdmitProductAuthorizationResult): Promise<void>;
}

/** Reads one product editor's centrally owned grant projection. */
export interface ListManagedProductAuthorizationGrantsCommand
{
	/** Silo containing the resource and grant rows. */
	readonly siloId: string;
	/** Authenticated local Principal requesting grant administration. */
	readonly principalId: string;
	/** Stable editor that exclusively owns the returned rows. */
	readonly managerId: string;
	/** Exact resource whose managed grants are requested. */
	readonly resource: ProductAuthorizationResourceLocator;
	/** Trusted server time used for current root-administration authorization. */
	readonly nowEpochMs: number;
}

/** Replaces one product editor's grant projection under central root authorization. */
export interface ReplaceManagedProductAuthorizationGrantsCommand extends ListManagedProductAuthorizationGrantsCommand
{
	/** Actor class persisted with the root authorization decision. */
	readonly actorKind: ProductAuthorizationActorKind;
	/** Stable local actor identifier persisted with the decision. */
	readonly actorId: string;
	/** Exact desired grant set for the named manager and resource. */
	readonly grants: readonly ManagedAuthorizationGrantSpec[];
	/** Database-aligned timestamp applied to revocations and new rows. */
	readonly now: Date;
}

/** Outcome of one generic managed-grant replacement. */
export interface ReplaceManagedProductAuthorizationGrantsResult extends AdmitProductAuthorizationResult
{
	/** Number of grants created or revoked, or zero when authorization denied. */
	readonly changedCount: number;
}

/** One batch catalogue request evaluated against a shared Principal, boundary, action, and clock. */
export interface ListEntitledProductResourcesCommand
{
	/** Silo derived from the trusted host and current membership state. */
	readonly siloId: string;
	/** Durable local Principal that requests catalogue visibility. */
	readonly principalId: string;
	/** Product boundary supplied from trusted resource data. */
	readonly boundary: AuthorizationBoundary;
	/** Typed action applied to every candidate resource. */
	readonly action: ProductAuthorizationActions;
	/** Candidate resources returned by the owning domain's lifecycle query. */
	readonly resources: readonly ProductAuthorizationResourceLocator[];
	/** Trusted database or server time used for grant validity. */
	readonly nowEpochMs: number;
}

/** Batch catalogue request evaluated across the Principal's stored personal and Group boundaries. */
export interface ListPrincipalEntitledProductResourcesCommand
{
	/** Silo derived from the trusted host and current membership state. */
	readonly siloId: string;
	/** Durable local Principal whose stored boundaries may cover candidates. */
	readonly principalId: string;
	/** Typed action applied to every candidate resource. */
	readonly action: ProductAuthorizationActions;
	/** Candidate resources returned by the owning domain's lifecycle query. */
	readonly resources: readonly ProductAuthorizationResourceLocator[];
	/** Trusted database or server time used for grant validity. */
	readonly nowEpochMs: number;
}

/** Central application port used by every product domain that makes a permission decision. */
export interface AuthorizationAuthority
{
	/** Decides one typed action using current product-authority state. */
	decide(command: ProductAuthorizationCommand): Promise<ProductAuthorizationResult>;
	/** Decides and records one protected mutation or external-effect admission atomically. */
	admit(command: AdmitProductAuthorizationCommand): Promise<AdmitProductAuthorizationResult>;
	/** Decides and records across the actor's stored personal and Group boundaries. */
	admitPrincipal(command: AdmitPrincipalProductAuthorizationCommand): Promise<AdmitProductAuthorizationResult>;
	/** Records a complete Principal action set only when every command is allowed. */
	admitPrincipalBatch(commands: readonly AdmitPrincipalProductAuthorizationCommand[]): Promise<readonly AdmitProductAuthorizationResult[]>;
	/** Filters a lifecycle-eligible catalogue without one database read per candidate. */
	listEntitled(command: ListEntitledProductResourcesCommand): Promise<readonly ProductAuthorizationResourceLocator[]>;
	/** Filters candidates across the Principal's stored personal and Group boundaries. */
	listPrincipalEntitled(command: ListPrincipalEntitledProductResourcesCommand): Promise<readonly ProductAuthorizationResourceLocator[]>;
	/** Lists one editor's managed grants after current root authorization. */
	listManagedGrants(command: ListManagedProductAuthorizationGrantsCommand): Promise<readonly ManagedAuthorizationGrantSpec[]>;
	/** Replaces one editor's managed grants inside the caller's protected transaction. */
	replaceManagedGrants(command: ReplaceManagedProductAuthorizationGrantsCommand): Promise<ReplaceManagedProductAuthorizationGrantsResult>;
}
