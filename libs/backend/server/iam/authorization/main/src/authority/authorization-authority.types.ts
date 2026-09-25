import type { AuthorizationBoundary, ProductAuthorizationActions, ProductAuthorizationCommand, ProductAuthorizationResourceLocator, ProductAuthorizationResult } from "@opencrane/models/authorization";
import type { AuditDecisionRecord } from "@opencrane/backend/server/iam/audit-writer";
import type { ManagedAuthorizationGrantSpec } from "../grants/managed-authorization-grants.types";

/** Actor classes written into durable authorization evidence. */
export type ProductAuthorizationActorKind = "user" | "agent-service" | "workload" | "system";

/**
 * Identifies the actual authenticated Pod and its verified workload object for an effect decision.
 * The transport owner supplies these coordinates after TokenReview and exact workload binding;
 * request bodies cannot choose them. The authorization Principal remains a separate coordinate.
 * Called by: conversation proposal admission and the MCP executor claim owner.
 */
export interface ProductAuthorizationWorkloadContext
{
	/** Names the fixed audience accepted by the workload's TokenReview. */
	readonly audience: string;
	/** Names the namespace verified for this Pod. */
	readonly namespace: string;
	/** Names the projected ServiceAccount verified for this Pod. */
	readonly serviceAccountName: string;
	/** Describes the verified workload object; Sandbox-owned computers identify their actual Pod. */
	readonly workloadKind: NonNullable<AuditDecisionRecord["workloadKind"]>;
	/** Identifies that workload object by its immutable Kubernetes UID. */
	readonly workloadUid: string;
	/** Identifies the authenticated Pod that requested the effect. */
	readonly podUid: string;
}

/** Binds an effect decision to the run and revision read by its server-side admission owner. */
export interface ProductAuthorizationRunContext
{
	/** Identifies the saved run whose authority is being checked. */
	readonly runId: string;
	/** Names the positive attempt read with the run. */
	readonly attempt: number;
	/** Identifies the run's owning agent service. */
	readonly agentServiceId: string;
	/** Identifies the immutable agent revision used by that run. */
	readonly agentRevisionId: string;
}

/** One product action that must commit durable authorization evidence. */
export interface AdmitProductAuthorizationCommand extends ProductAuthorizationCommand
{
	/** Class of Principal that caused the protected operation. */
	readonly actorKind: ProductAuthorizationActorKind;
	/** Stable local identifier of the actor that caused the operation. */
	readonly actorId: string;
	/** Digest of canonical action arguments, including an empty object for argument-free actions. */
	readonly argumentsDigest: `sha256:${string}`;
	/** Required for workload actors and rejected for other actors; actorId must equal this Pod UID. */
	readonly workload?: ProductAuthorizationWorkloadContext;
	/** Contains run coordinates loaded by the admission owner, when this decision belongs to a run. */
	readonly run?: ProductAuthorizationRunContext;
	/** Accepted membership revision when membership contributed to this decision. */
	readonly membershipRevision?: number;
}

/** One product action admitted across a Principal's stored personal and direct Group boundaries. */
export type AdmitPrincipalProductAuthorizationCommand = Omit<AdmitProductAuthorizationCommand, "boundary">;

/**
 * Checks current eligibility across a Principal's stored personal and Group boundaries.
 * An allowed result records no evidence and cannot authorise a protected write or external effect;
 * its owning transaction must separately admit the concrete operation before committing it.
 */
export type DecidePrincipalProductAuthorizationCommand = Omit<ProductAuthorizationCommand, "boundary">;

/** Stored Principal boundary and allowed decision found by the authority's shared decision loop. */
export interface AllowedPrincipalProductAuthorizationDecision
{
	/** Current personal or Group boundary whose grants allow the action. */
	readonly boundary: AuthorizationBoundary;
	/** Pure decision that has not been recorded as permission to perform an operation. */
	readonly decision: ProductAuthorizationResult;
}

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

/** Replaces one product editor's grant projection under central root authorization. */
export interface ReplaceManagedProductAuthorizationGrantsCommand
{
	/** Silo containing the resource and grant rows. */
	readonly siloId: string;
	/** Authenticated local Principal requesting grant administration. */
	readonly principalId: string;
	/** Actor class persisted with the root authorization decision. */
	readonly actorKind: ProductAuthorizationActorKind;
	/** Stable local actor identifier persisted with the decision. */
	readonly actorId: string;
	/** Stable editor that exclusively owns the replaced rows. */
	readonly managerId: string;
	/** Exact resource whose managed grants are replaced. */
	readonly resource: ProductAuthorizationResourceLocator;
	/** Exact desired grant set for the named manager and resource. */
	readonly grants: readonly ManagedAuthorizationGrantSpec[];
	/** Database-aligned timestamp applied to revocations and new rows. */
	readonly now: Date;
	/** Trusted server time used for current root-administration authorization. */
	readonly nowEpochMs: number;
}

/** Outcome of one generic managed-grant replacement. */
export interface ReplaceManagedProductAuthorizationGrantsResult extends AdmitProductAuthorizationResult
{
	/** Number of grants created or revoked, or zero when authorization denied. */
	readonly changedCount: number;
}

/** Retires every live grant attached to exact product resources under current root authorization. */
export interface RetireProductAuthorizationResourceGrantsCommand
{
	/** Silo containing both the retiring resources and their grants. */
	readonly siloId: string;
	/** Authenticated local Principal requesting resource retirement. */
	readonly principalId: string;
	/** Actor class persisted with the root authorization decision. */
	readonly actorKind: ProductAuthorizationActorKind;
	/** Stable local actor identifier persisted with the decision. */
	readonly actorId: string;
	/** Exact resource coordinates that will cease to exist in the same transaction. */
	readonly resources: readonly ProductAuthorizationResourceLocator[];
	/** Database-aligned timestamp applied to every active matching grant. */
	readonly now: Date;
	/** Trusted server time used for current root-administration authorization. */
	readonly nowEpochMs: number;
}

/** Outcome of one exact-resource grant retirement. */
export interface RetireProductAuthorizationResourceGrantsResult extends AdmitProductAuthorizationResult
{
	/** Number of active grants soft-revoked, or zero when authorization was denied. */
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
	/** Checks current Principal eligibility without recording or replacing mutation/effect admission. */
	decidePrincipal(command: DecidePrincipalProductAuthorizationCommand): Promise<ProductAuthorizationResult>;
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
	/** Replaces one editor's managed grants inside the caller's protected transaction. */
	replaceManagedGrants(command: ReplaceManagedProductAuthorizationGrantsCommand): Promise<ReplaceManagedProductAuthorizationGrantsResult>;
	/** Soft-revokes every live grant on exact resources that retire in the caller's transaction. */
	retireResourceGrants(command: RetireProductAuthorizationResourceGrantsCommand): Promise<RetireProductAuthorizationResourceGrantsResult>;
}
