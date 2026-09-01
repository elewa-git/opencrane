/**
 * Who caused a decision, as stored on every audit row.
 *
 * `user` is a person's OIDC subject (sharing, publishing). `workload` is a running pod, identified
 * by its pod UID — what the runtime authority records. `system` is OpenCrane acting with no request
 * behind it, such as accepting a signed membership revision. `agent-service` is an agent acting in
 * its own name. Choose by who actually caused the row, not by which module writes it:
 * {@link PrismaAuditDecisionWriterRepository} maps these strings onto the Prisma enum and nothing
 * rewrites these rows afterwards.
 *
 * @see AuditDecisionRecord
 */
export type AuditDecisionActorKind = "user" | "agent-service" | "workload" | "system";

/**
 * How a decision came out: `allow` permitted it, `deny` refused it, and `error` means no decision
 * could be reached at all — a failure while evaluating, not a judgement about the request.
 *
 * Every call site in this repo records `allow` today, because refusals are returned before any
 * transaction is open; `deny` and `error` exist for call sites that need to keep the refusal.
 */
export type AuditDecisionOutcome = "allow" | "deny" | "error";

/**
 * Writes an immutable audit decision through the transaction that owns the protected change.
 *
 * The receipt identifies the inserted row so the same transaction can persist that reference beside
 * its protected change. A caller must not treat the receipt as evidence after the transaction rolls
 * back. Called by `PrismaAuthorizationAuthority`, membership, agent-service, and first-owner
 * admission adapters.
 */
export interface AuditDecisionWriterRepository
{
	/**
	 * Inserts one final authorization decision and returns its row identifier.
	 * @param decision - The decision that the caller's transaction is about to commit.
	 * @returns The identifier that a caller may persist with its protected change.
	 */
	append(decision: AuditDecisionRecord): Promise<AuditDecisionAppendReceipt>;
}

/**
 * Identifies the audit row inserted for a transaction-bound authorization decision.
 *
 * A protected domain can store this identifier with the change it admits, but both records disappear
 * when their shared transaction rolls back.
 */
export interface AuditDecisionAppendReceipt
{
	/** Identifies the immutable AuditDecision row inserted by the caller's transaction. */
	readonly decisionEvidenceId: string;
}

/**
 * One row of the append-only decision log: what was decided, about what, by whom, and under which
 * policy and capability catalog.
 *
 * The rule that matters: this row is written inside the same transaction as the change it describes
 * — the grant, the publish, the accepted membership revision. Write it separately and the two can
 * drift, leaving either a change nobody can account for or an audit row for a change that rolled
 * back. Most fields are optional because they only apply to some actors: the workload and pod fields
 * describe a running pod, `runId`/`attempt` a run, and the proof-key fields a signed runtime request.
 *
 * Called by: libs/backend/server/iam/authorization/main/src/prisma-authorization-authority.ts,
 * libs/backend/server/iam/membership/main/src/prisma-membership-authority.ts,
 * libs/backend/server/agents/agent-services (publication audit evidence), and
 * standalone-first-user-audit.ts in this package.
 * @see PrismaAuditDecisionWriterRepository
 */
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
	/** When the decision happened; leave it unset to let the database stamp the row. */
	readonly decidedAt?: Date;
}
