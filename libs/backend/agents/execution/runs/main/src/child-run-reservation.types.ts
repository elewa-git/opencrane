import type { RunInputSnapshot } from "@opencrane/contracts";
import type { Prisma } from "@prisma/client";

import type { GovernedChildRunBudget, GovernedChildRunSpawnAuthorization, GovernedChildRunSpawnRequest } from "./child-run-admission.types.js";

/** Immutable caller coordinates for one transaction-fenced governed child-run reservation. */
export interface ChildRunReservationCommand
{
	/** New durable child run identifier. */
	readonly childRunId: string;
	/** Same-silo idempotency key that returns the first durable child only. */
	readonly requestIdempotencyKey: string;
	/** Locked parent run identifier. */
	readonly parentRunId: string;
	/** Expected parent snapshot digest, preventing stale-parent compilation. */
	readonly parentSnapshotDigest: string;
	/** Exact running attempt whose runtime candidate is allowed to create this child. */
	readonly parentAttempt: number;
	/** Maximum direct children permitted by the immutable policy evaluated for this reservation. */
	readonly maximumChildrenPerParent: number;
	/** Untrusted runtime request that the locked callback must authorize before persistence. */
	readonly request: GovernedChildRunSpawnRequest;
}

/** Immutable authority supplied to derive one child snapshot under the parent lock. */
export interface ChildRunReservationParent
{
	/** The exact transaction holding the parent lock for all child authority reads. */
	readonly transaction: Prisma.TransactionClient;
	/** Parent run and exact frozen snapshot used by the authorization gate. */
	readonly snapshot: RunInputSnapshot;
	/** Parent's immutable logical-run coordinates. */
	readonly agentServiceId: string;
	/** Root run identifier inherited by every descendant reservation. */
	readonly rootRunId: string;
	/** Number of parent-to-child edges from the root to the locked parent. */
	readonly depth: number;
	/** Direct children already durably reserved below the locked parent. */
	readonly existingChildCount: number;
	/** Finite parent capacity left after every earlier durable reservation. */
	readonly remainingBudget: GovernedChildRunBudget;
	/** Server-owned instant that fixes the child deadline inside the parent's immutable deadline. */
	readonly authorizedAt: string;
}

/** One derived child snapshot ready for atomic persistence. */
export interface ChildRunReservationBuild
{
	/** Authorization derived from the untrusted request while the parent remains locked. */
	readonly authorization: GovernedChildRunSpawnAuthorization;
	/** Complete digest-sealed child input snapshot. */
	readonly snapshot: RunInputSnapshot;
	/** Published target service revision fixed for the child logical run. */
	readonly agentRevisionId: string;
	/** Effective contract digest fixed for the selected child revision. */
	readonly effectiveContractDigest: string;
}

/** Result of the one child-run reservation transaction. */
export type ChildRunReservationResult = { readonly outcome: "reserved" | "idempotent"; readonly snapshot: RunInputSnapshot } | { readonly outcome: "denied"; readonly reason: "invalid_command" | "parent_unavailable" | "parent_snapshot_stale" | "authority_conflict" | "persistence_unavailable" };

/** Transaction-fenced child-run persistence port. */
export interface ChildRunReservationRepository
{
	/** Locks parent authority, reserves finite capacity, and persists child/run snapshot/outbox as one commit. */
	reserve(command: ChildRunReservationCommand, build: (parent: ChildRunReservationParent) => Promise<ChildRunReservationBuild | null>): Promise<ChildRunReservationResult>;
}
