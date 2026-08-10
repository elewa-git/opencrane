import type { RunInputSnapshot } from "@opencrane/contracts";

/** Stable top-level outcomes from immutable run-input assembly. */
export enum SessionAssemblyOutcomes
{
	/** Every required input was frozen into one durable snapshot. */
	Assembled = "assembled",
	/** A required authority or persistence fence refused assembly. */
	Denied = "denied",
}

/** Stable persistence outcomes attached to an assembled immutable snapshot. */
export enum RunInputSnapshotAdmissionOutcomes
{
	/** A new immutable snapshot and run were persisted. */
	Accepted = "accepted",
	/** The caller's exact durable idempotency key returned its existing snapshot. */
	Idempotent = "idempotent",
}

/** Typed refusal that stops assembly before a partial snapshot can be persisted. */
export type SessionAssemblyRefusalReason = "invalid_command" | "run_not_admittable" | "revision_unavailable" | "persona_unavailable" | "conversation_unavailable" | "memory_scope_unavailable" | "memory_unavailable" | "tool_policy_unavailable" | "skill_unavailable" | "budget_unavailable" | "membership_stale" | "identity_unavailable" | "persistence_unavailable";

/** Public result from attempting to assemble and persist one immutable runtime input. */
export type AssembleRunInputSnapshotResult = { readonly outcome: "assembled"; readonly admissionOutcome: "accepted" | "idempotent"; readonly snapshot: RunInputSnapshot } | { readonly outcome: "denied"; readonly reason: SessionAssemblyRefusalReason };
