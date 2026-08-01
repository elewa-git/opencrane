import type { RunInputSnapshot } from "@opencrane/contracts";

/** Typed refusal that stops assembly before a partial snapshot can be persisted. */
export type SessionAssemblyRefusalReason = "invalid_command" | "run_not_admittable" | "revision_unavailable" | "persona_unavailable" | "thread_unavailable" | "memory_scope_unavailable" | "tool_policy_unavailable" | "skill_unavailable" | "budget_unavailable" | "membership_stale" | "identity_unavailable" | "persistence_unavailable";

/** Public result from attempting to assemble and persist one immutable runtime input. */
export type AssembleRunInputSnapshotResult = { readonly outcome: "assembled"; readonly admissionOutcome: "accepted" | "idempotent"; readonly snapshot: RunInputSnapshot } | { readonly outcome: "denied"; readonly reason: SessionAssemblyRefusalReason };
