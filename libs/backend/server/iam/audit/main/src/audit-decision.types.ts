/** Actor classes retained in the append-only target decision ledger. */
export type AuditDecisionActorKind = "user" | "agent-service" | "workload" | "system";

/** Stable authorization result retained in the append-only target decision ledger. */
export type AuditDecisionOutcome = "allow" | "deny" | "error";

/** Exact target authorization evidence appended inside a driving-domain transaction. */
export interface AuditDecisionRecord
{
	/** RFC 8785 SHA-256 digest of the complete decision evidence. */
	readonly decisionDigest: string;
	/** Silo in which the decision was authoritative. */
	readonly siloId: string;
	/** Class of principal that caused the decision. */
	readonly actorKind: AuditDecisionActorKind;
	/** Exact principal identifier. */
	readonly actorId: string;
	/** Policy-enforcement audience for workload decisions. */
	readonly audience?: string;
	/** Kubernetes namespace for workload decisions. */
	readonly namespace?: string;
	/** Projected Kubernetes service account for workload decisions. */
	readonly serviceAccountName?: string;
	/** Controller-owned workload kind for workload decisions. */
	readonly workloadKind?: "job" | "deployment";
	/** Immutable controller workload UID. */
	readonly workloadUid?: string;
	/** Immutable runtime Pod UID. */
	readonly podUid?: string;
	/** Logical run identifier, when the decision belongs to a run. */
	readonly runId?: string;
	/** Positive run attempt paired with runId. */
	readonly attempt?: number;
	/** Stable AgentService identifier, when applicable. */
	readonly agentServiceId?: string;
	/** Immutable AgentRevision identifier, when applicable. */
	readonly agentRevisionId?: string;
	/** Registered RunProofKey identifier, when applicable. */
	readonly proofKeyId?: string;
	/** RFC 7638 proof-key thumbprint, when applicable. */
	readonly proofKeyThumbprint?: string;
	/** Exact resource kind evaluated by policy. */
	readonly resourceKind: string;
	/** Exact resource identifier evaluated by policy. */
	readonly resourceId: string;
	/** Exact action evaluated by policy. */
	readonly action: string;
	/** Immutable capability catalog identifier. */
	readonly catalogId: string;
	/** Positive immutable capability catalog revision. */
	readonly catalogRevision: number;
	/** Digest of the immutable capability catalog revision. */
	readonly catalogDigest: string;
	/** Digest of the canonical action arguments. */
	readonly argumentsDigest: string;
	/** Digest of the exact policy revision used for evaluation. */
	readonly policyRevisionHash: string;
	/** Digest of the effective grants and policy set. */
	readonly effectiveAuthorizationDigest: string;
	/** Accepted signed fleet-membership revision, when membership contributed. */
	readonly membershipRevision?: number;
	/** Stable authorization outcome. */
	readonly outcome: AuditDecisionOutcome;
	/** Stable machine-readable decision reason. */
	readonly reasonCode: string;
	/** Database-authoritative decision instant. */
	readonly decidedAt?: Date;
}
