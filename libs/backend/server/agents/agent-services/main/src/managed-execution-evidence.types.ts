import type { Prisma } from "@prisma/client";

import type { ServiceRunInputSnapshotIdentity } from "@opencrane/contracts";
import type { FleetMembershipSignatureVerifier } from "@opencrane/backend/server/iam/membership";

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
	/** Server-owned admission instant in epoch milliseconds. */
	readonly admittedAtEpochMs: number;
}

/**
 * What one managed run is allowed to be and do, fixed at admission time.
 *
 * Both fields are copied onto the run's input snapshot and never recomputed later, so a run keeps the
 * access it was admitted with even if grants or membership change mid-run.
 */
export interface ManagedExecutionEvidence
{
	/** The agent's own identity for this run: its `agent-service:<id>` principal, signed fleet-membership evidence, and boundary attachments that survived the grant check. Never the human who triggered the run. */
	readonly identity: ServiceRunInputSnapshotIdentity;
	/**
	 * One SHA-256 hash fingerprinting everything this run is allowed to do.
	 *
	 * It is computed over the silo, the service, the revision id and the revision's own content digest,
	 * the agent's principal and silo, the fleet-membership revision and payload digest, the
	 * boundary attachments that survived the grant check, the model definition, the budget ceilings, the
	 * assigned skill revisions, and each integration's custody reference plus its reviewed tool
	 * definitions. Anything that widens what the agent can reach is inside; nothing about the human who
	 * pressed the button is.
	 *
	 * It is stored on the run's input snapshot and copied onto the runtime assignment handed to the pod,
	 * so a later reader can prove the pod is running the capability set that was approved. That only
	 * works if the hash is reproducible, which is why every list is sorted before hashing
	 * (`_CanonicalAttachments`, `_CanonicalSkillAssignments`, `_CanonicalIntegrationAssignments` in
	 * `prisma-managed-execution-evidence.ts`): RFC 8785 sorts object keys for us but keeps array order
	 * exactly as given. If the sort were unstable — or omitted, leaving Postgres row order to decide —
	 * two runs of the identical revision would hash differently, comparisons against the stored digest
	 * would fail for no real reason, and the digest would stop being usable as evidence.
	 *
	 * @see https://www.rfc-editor.org/rfc/rfc8785 — the canonical-JSON rules the hash relies on, and
	 *   the reason array order must be fixed by the caller rather than by the serializer.
	 */
	readonly capabilitySetDigest: string;
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
 * held, and hashes the result into a capability digest. It fails closed: any missing or stale piece
 * returns a denial rather than a partial answer.
 *
 * Implemented by: `PrismaManagedExecutionEvidenceAuthority` in
 * `db/prisma-managed-execution-evidence.ts`; built for the process by
 * `_CreateManagedExecutionEvidenceAuthority` and composed in apps/opencrane/src/index.ts.
 * Called by: `ManagedExecutionIdentityEnvelopeSource` in
 * libs/backend/agents/execution/inputs/main/src/managed-execution-identity-envelope-source.ts, and
 * passed through `__CreateManagedRunAdmissionPort` in
 * libs/backend/agents/execution/admission/main/src/managed-run-admission.composition.ts.
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
