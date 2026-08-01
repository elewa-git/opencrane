import type { Prisma } from "@prisma/client";

import type { ServiceRunInputSnapshotIdentity } from "@opencrane/contracts";
import type { FleetMembershipSignatureVerifier } from "@opencrane/backend/server/iam/membership";

/** Stable coordinates used to resolve a managed service's execution evidence. */
export interface ManagedExecutionEvidenceCommand
{
	/** Silo containing the service, revision, membership, and grants. */
	readonly siloId: string;
	/** Managed AgentService being admitted. */
	readonly agentServiceId: string;
	/** Exact active published revision selected for the run. */
	readonly agentRevisionId: string;
}

/** Transaction fence supplied by the run-input assembler. */
export interface ManagedExecutionEvidenceTransaction
{
	/** Shared Prisma transaction used for every authority read and membership acceptance write. */
	readonly prisma: Prisma.TransactionClient;
	/** Server-owned admission instant in epoch milliseconds. */
	readonly admittedAtEpochMs: number;
}

/** Frozen identity and capability evidence for one managed-service run. */
export interface ManagedExecutionEvidence
{
	/** Tagged service identity containing signed membership and exact effective scope attachments. */
	readonly identity: ServiceRunInputSnapshotIdentity;
	/** Digest of the complete managed-service capability-bearing revision evidence. */
	readonly capabilitySetDigest: string;
}

/** Fail-closed result from resolving managed execution evidence. */
export type ManagedExecutionEvidenceResult =
	| { readonly outcome: "loaded"; readonly value: ManagedExecutionEvidence }
	| { readonly outcome: "denied"; readonly reason: "run_not_admittable" | "membership_stale" | "identity_unavailable" | "tool_policy_unavailable" | "memory_scope_unavailable" };

/** Boundary consumed by run-input assembly without moving service authority into the app. */
export interface ManagedExecutionEvidenceAuthority
{
	/** Resolves evidence through the caller's already-open admission transaction. */
	load(command: ManagedExecutionEvidenceCommand, transaction: ManagedExecutionEvidenceTransaction): Promise<ManagedExecutionEvidenceResult>;
}

/** Configuration for the production managed-service evidence authority. */
export interface ManagedExecutionEvidenceConfig
{
	/** Fleet issuer trusted for service-principal membership. */
	readonly trustedIssuerId: string;
	/** Maximum accepted age of the newest signed membership revision. */
	readonly maximumStalenessMs: number;
	/** Cryptographic verifier backed by the exact mounted fleet key ring. */
	readonly verifier: FleetMembershipSignatureVerifier;
}
