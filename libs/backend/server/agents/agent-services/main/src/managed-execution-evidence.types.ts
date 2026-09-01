import type { Prisma } from "@prisma/client";

import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import type { FleetMembershipSignatureVerifier } from "@opencrane/backend/server/iam/membership";
import type { RevisionBoundaryAttachment } from "@opencrane/models/agents";

/** Names the exact run to check: which silo, which managed service, and which revision the caller believes is its published active revision. */
export interface ManagedExecutionEvidenceCommand
{
	/** Silo containing the service, revision, membership, and grants. */
	readonly siloId: string;
	/** Managed AgentService being admitted. */
	readonly agentServiceId: string;
	/** Exact active published revision selected for the run. */
	readonly agentRevisionId: string;
}

/**
 * The caller's open database transaction plus the admission time, passed in so evidence is read
 * inside the same transaction that writes the run.
 *
 * Sharing one transaction is the point: the service, the revision, the membership high-water mark,
 * the grants, and the run row are all read or written under it, so nothing can change underneath
 * between the check and the write.
 */
export interface ManagedExecutionEvidenceTransaction
{
	/** Shared Prisma transaction used for every authority read and membership acceptance write. */
	readonly prisma: Prisma.TransactionClient;
	/** Central authorization authority bound to the same admission transaction. */
	readonly authorization: Pick<AuthorizationAuthority, "admit" | "admitPrincipal">;
	/** Server-owned admission instant in epoch milliseconds. */
	readonly admittedAtEpochMs: number;
}

/** Identifies the managed service Principal that an external AgentIdentity history must realize. */
export interface ManagedExecutionIdentityCoordinates
{
	/** Silo that owns the service and Principal. */
	readonly siloId: string;
	/** Managed service selected for this admission. */
	readonly agentServiceId: string;
	/** Published service revision selected for this admission. */
	readonly agentRevisionId: string;
	/** Dedicated durable Principal that a checked managed AgentIdentity must realize. */
	readonly principalId: string;
}

/** Records the signed membership assertion checked for the managed service Principal. */
export interface ManagedExecutionMembershipEvidence
{
	/** Monotonic signed membership revision accepted at admission. */
	readonly revision: number;
	/** Trusted issuer that signed the accepted membership assertion. */
	readonly issuerId: string;
	/** Key identifier the trusted issuer used to sign the assertion. */
	readonly issuerKeyId: string;
	/** Exact accepted assertion identifier. */
	readonly assertionId: string;
	/** SHA-256 digest of the accepted signed membership payload. */
	readonly payloadDigest: string;
	/** Instant after which the assertion must no longer be accepted. */
	readonly trustedUntil: string;
}

/** Records the revision-scoped capability facts that an execution-subject authority must bind to a computer. */
export interface ManagedExecutionCapabilityEvidence
{
	/** SHA-256 digest of the managed revision's complete effective contract. */
	readonly effectiveContractDigest: string;
	/** Revision boundaries that survived current grant evaluation. */
	readonly effectiveBoundaryAttachments: readonly RevisionBoundaryAttachment[];
	/** SHA-256 digest of the canonical effective boundary attachments. */
	readonly effectiveBoundaryAttachmentDigest: string;
	/** Current central-authority decisions that admitted the managed Principal's capability set. */
	readonly authorizationDecisionDigests: readonly string[];
}

/**
 * Checked managed-service prerequisites for creating an execution subject.
 *
 * This package proves the Postgres-owned service, Principal, membership, revision, and grant facts.
 * It deliberately does not return an `ExecutionSubject`: AgentIdentity history and an active
 * ConversationComputer lease are Kurrent-owned facts that this package cannot invent. The app must
 * pass these values to the checked execution-subject authority that reads those histories in the
 * same admission fence.
 */
export interface ManagedExecutionEvidence
{
	/** Principal and active managed revision that a checked AgentIdentity must match. */
	readonly identity: ManagedExecutionIdentityCoordinates;
	/** Current signed membership evidence for the service Principal. */
	readonly membership: ManagedExecutionMembershipEvidence;
	/** Current revision capability evidence, still unbound to any computer lease. */
	readonly capability: ManagedExecutionCapabilityEvidence;
}

/**
 * Outcome of one evidence load. `denied` never means "partially allowed" — no run is admitted.
 * - `run_not_admittable`: the service is not a managed, active service in this silo, or the revision
 *   named is not its published active revision. The service's active revision has probably moved;
 *   re-read it.
 * - `membership_stale`: the agent principal has no signed fleet membership in the trusted issuer's
 *   newest revision, has ambiguous assertions for this silo, or the newest signature is
 *   older than `maximumStalenessMs`. Transient — retry after the issuer republishes.
 * - `memory_scope_unavailable`: the revision declares a `personal` scope (never allowed for a managed
 *   service), or declares a scope the agent's principal does not actually hold. Fix the revision or
 *   grant the scope; retrying will not help.
 * - `identity_unavailable`, `tool_policy_unavailable`: reserved for identity and tool-policy failures
 *   in the same union used by the wider run-admission path; the current implementation does not
 *   return them. NEEDS-HUMAN — confirm whether they should stay in this narrower union.
 */
export type ManagedExecutionEvidenceResult =
	| { readonly outcome: "loaded"; readonly value: ManagedExecutionEvidence }
	| { readonly outcome: "denied"; readonly reason: "run_not_admittable" | "membership_stale" | "identity_unavailable" | "tool_policy_unavailable" | "memory_scope_unavailable" };

/**
 * Answers "may this managed service run right now, and with exactly what access?".
 *
 * Run-input assembly lives in another package but must not re-implement these rules, so it calls in
 * here. One call re-reads the service and its published active revision, verifies the agent's signed
 * fleet membership, intersects the revision's declared boundary attachments against the grants actually
 * held, and returns the resulting target coordinates and evidence. It fails closed: any missing or
 * stale piece returns a denial rather than a partial answer.
 *
 * Implemented by: `PrismaManagedExecutionEvidenceAuthority` in
 * `db/prisma-managed-execution-evidence.ts`. An application composition may use this evidence
 * only with checked AgentIdentity and ConversationComputer history; this authority alone does not
 * produce an `ExecutionSubject`.
 */
export interface ManagedExecutionEvidenceAuthority
{
	/** Resolves evidence through the caller's already-open admission transaction. */
	load(command: ManagedExecutionEvidenceCommand, transaction: ManagedExecutionEvidenceTransaction): Promise<ManagedExecutionEvidenceResult>;
}

/** Deployment-chosen membership trust settings for {@link ManagedExecutionEvidenceAuthority}: which issuer to trust, how stale its evidence may be, and the key material to verify it with. Fixed once at composition; not per request. */
export interface ManagedExecutionEvidenceConfig
{
	/** The only issuer whose signed membership is accepted for agent principals. Must be non-empty; the constructor throws otherwise. */
	readonly trustedIssuerId: string;
	/** How old, in milliseconds, the newest signed membership evidence may be before a run is denied with `membership_stale`. Must be a positive safe integer; the constructor throws otherwise. */
	readonly maximumStalenessMs: number;
	/** Checks the signature on membership evidence against the issuer keys mounted into this process. Built by `_CreateFleetMembershipEvidenceConfig` from the environment. */
	readonly verifier: FleetMembershipSignatureVerifier;
}
