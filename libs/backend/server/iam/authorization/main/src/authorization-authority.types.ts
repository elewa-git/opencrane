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
	/** Identifies the PostgreSQL AuditDecision row inserted with the admitted mutation when its transaction commits. */
	readonly decisionEvidenceId: string;
	/** Digest of the complete decision record. */
	readonly decisionDigest: `sha256:${string}`;
	/** Digest of the reviewed product policy catalogue. */
	readonly policyRevisionHash: `sha256:${string}`;
	/** Digest of the winning current grant set. */
	readonly effectiveAuthorizationDigest: `sha256:${string}`;
}

/**
 * Holds the decision digests before the recorder inserts its audit row.
 *
 * The authority derives this draft from the allowed decision, then gives it to
 * {@link ProductAuthorizationDecisionRecorder}. It deliberately has no `decisionEvidenceId`: the
 * database assigns that identifier when the recorder writes the `AuditDecision` row.
 */
export interface ProductAuthorizationAdmissionEvidenceDraft
{
	/** Digest of the complete decision record. */
	readonly decisionDigest: `sha256:${string}`;
	/** Digest of the reviewed product policy catalogue. */
	readonly policyRevisionHash: `sha256:${string}`;
	/** Digest of the winning current grant set. */
	readonly effectiveAuthorizationDigest: `sha256:${string}`;
}

/**
 * Identifies the decision row that the transaction-bound recorder inserted.
 *
 * The authority adds this identifier to allowed admission evidence after recording. A caller can
 * persist that evidence with its protected change, which keeps the reference and audit row in one
 * transaction.
 */
export interface ProductAuthorizationDecisionReceipt
{
	/** Identifies the immutable PostgreSQL AuditDecision evidence row when the caller commits. */
	readonly decisionEvidenceId: string;
}

/** Result of a mutation or effect admission. */
export interface AdmitProductAuthorizationResult extends ProductAuthorizationResult
{
	/** Evidence written in the same transaction, or null when the action was denied. */
	readonly evidence: ProductAuthorizationAdmissionEvidence | null;
}

/**
 * Appends authority-derived evidence through the caller's open transaction.
 *
 * {@link __AuthorizationAuthority} calls this port only for allowed mutation or effect decisions,
 * after it has derived the decision digests. Implementations must write through that same transaction
 * and return the inserted `AuditDecision` identifier; otherwise callers cannot retain a reference
 * that commits with the protected change.
 */
export interface ProductAuthorizationDecisionRecorder
{
	/**
	 * Persists one allowed mutation or effect decision and returns its audit-row identifier.
	 * @param command - The action coordinates whose protected change shares this transaction.
	 * @param result - The allowed policy result whose outcome and reason are recorded.
	 * @param evidence - The authority-derived decision digests to store in the audit row.
	 * @returns The identifier to add to the caller's allowed admission evidence.
	 */
	record(command: AdmitProductAuthorizationCommand, result: ProductAuthorizationResult, evidence: ProductAuthorizationAdmissionEvidenceDraft): Promise<ProductAuthorizationDecisionReceipt>;
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
