import type { RunInputSnapshot } from "@opencrane/contracts";

import type { ChildRunAdmissionLimits, ChildRunTargetAuthorization, PreparedChildRunAdmission } from "./child-run-admission.types";

/** Request to write one prepared child run, carrying everything needed to re-check the parent transactionally. */
export interface ChildRunReservationCommand
{
	/** Idempotency key scoped to the child run's inherited silo. */
	readonly requestIdempotencyKey: string;
	/** Exact immutable snapshot digest observed for the parent before this request. */
	readonly parentSnapshotDigest: string;
	/** Child coordinates prepared from parent authority rather than caller-supplied lineage. */
	readonly prepared: PreparedChildRunAdmission;
	/** Server-owned recursion limits rechecked with the parent. */
	readonly limits: ChildRunAdmissionLimits;
	/** Exact delegation policy rechecked with the parent. */
	readonly targetAuthorization: ChildRunTargetAuthorization;
}

/** Callback that builds the child's snapshot only after the parent is rechecked. */
export interface ChildRunReservationBuild
{
	/** Builds the immutable child runtime input from the parent-fenced prepared admission. */
	build(prepared: PreparedChildRunAdmission): Promise<ChildRunReservationBuildResult>;
}

/** Result of assembling the immutable input needed to commit an admitted child. */
export interface ChildRunReservationBuildResult
{
	/** Snapshot to persist with the child run and reservation. */
	readonly snapshot: RunInputSnapshot;
	/** Active revision whose contract was revalidated during child snapshot assembly. */
	readonly effectiveContractDigest: string;
}

/** Durable result of atomically admitting or replaying one child run. */
export type ChildRunReservationResult = { readonly outcome: "reserved" | "idempotent"; readonly snapshot: RunInputSnapshot } | { readonly outcome: "denied"; readonly reason: "invalid_command" | "invalid_parent_authority" | "parent_not_admittable" | "parent_snapshot_stale" | "depth_exceeded" | "budget_exceeded" | "fanout_exceeded" | "target_not_authorized" | "target_authorization_unavailable" | "authority_conflict" | "persistence_unavailable" };

/**
 * Writes a child run once the parent has been rechecked.
 *
 * The repository re-runs the child admission decision — limits, budget and target policy — inside a
 * Serializable transaction. A concurrent sibling forces one transaction to retry before it can
 * overspend the parent budget. The child run, snapshot, and reservation commit together.
 *
 * Implemented by `PrismaChildRunReservationRepository`. No production caller found yet: the
 * spawning path that will use it is not wired, so check before assuming this is live.
 */
export interface ChildRunReservationRepository
{
	/** Rechecks parent authority and atomically writes a child run, snapshot, and reservation. */
	reserve(command: ChildRunReservationCommand, build: ChildRunReservationBuild): Promise<ChildRunReservationResult>;
}
