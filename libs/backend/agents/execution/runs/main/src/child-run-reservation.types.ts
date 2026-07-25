import type { RunInputSnapshot } from "@opencrane/contracts";

import type { GovernedChildRunSpawnAuthorization } from "./child-run-admission.types.js";

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
	/** Maximum direct children permitted by the immutable policy evaluated for this reservation. */
	readonly maximumChildrenPerParent: number;
	/** Previously authorized child coordinates and finite allocation. */
	readonly authorization: GovernedChildRunSpawnAuthorization;
}

/** Immutable authority supplied to derive one child snapshot under the parent lock. */
export interface ChildRunReservationParent
{
	/** Parent run and exact frozen snapshot used by the authorization gate. */
	readonly snapshot: RunInputSnapshot;
	/** Parent's immutable logical-run coordinates. */
	readonly agentServiceId: string;
}

/** One derived child snapshot ready for atomic persistence. */
export interface ChildRunReservationBuild
{
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
	reserve(command: ChildRunReservationCommand, build: (parent: ChildRunReservationParent) => Promise<ChildRunReservationBuild>): Promise<ChildRunReservationResult>;
}
