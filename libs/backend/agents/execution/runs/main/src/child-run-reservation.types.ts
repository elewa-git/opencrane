import type { RunInputSnapshot } from "@opencrane/contracts";

import type { ChildRunAdmissionLimits, ChildRunTargetAuthorization, PreparedChildRunAdmission } from "./child-run-admission.types.js";

/** Complete parent-fenced request to durably admit one prepared child run. */
export interface ChildRunReservationCommand
{
	/** Idempotency key scoped to the child run's inherited silo. */
	readonly requestIdempotencyKey: string;
	/** Exact immutable snapshot digest observed for the parent before this request. */
	readonly parentSnapshotDigest: string;
	/** Child coordinates prepared from parent authority rather than caller-supplied lineage. */
	readonly prepared: PreparedChildRunAdmission;
	/** Server-owned recursion limits rechecked while the parent is locked. */
	readonly limits: ChildRunAdmissionLimits;
	/** Exact delegation policy rechecked while the parent is locked. */
	readonly targetAuthorization: ChildRunTargetAuthorization;
}

/** Callback that assembles the child snapshot only after parent authority is locked and rechecked. */
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

/** Persistence boundary that owns parent locking and all durable child-admission writes. */
export interface ChildRunReservationRepository
{
	/** Rechecks parent authority and atomically writes a child run, snapshot, reservation, and outbox. */
	reserve(command: ChildRunReservationCommand, build: ChildRunReservationBuild): Promise<ChildRunReservationResult>;
}
