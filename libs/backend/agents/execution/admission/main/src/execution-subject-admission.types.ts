import type { ExecutionSubject } from "@opencrane/models/agents";
import { RunAdmissionDenialReasons, type InitialRunAuthority, type RunAdmissionCommand, type RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

/**
 * Resolves an execution subject after preparation inside the final admission transaction.
 *
 * Personal and managed admission compositions call this port while the transaction is still open.
 * The implementation must return `denied` instead of carrying stale identity, membership,
 * capability, or computer-lease evidence into a persisted run snapshot.
 */
export interface ExecutionSubjectAdmissionAuthority
{
	/** Resolves current authority facts while admission is open; `denied` keeps the run unadmitted. */
	load(command: RunAdmissionCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<ExecutionSubjectAdmissionLoad>;
}

/**
 * States whether admission can persist a subject from current authority evidence.
 *
 * `loaded` gives the caller the subject to seal into the immutable snapshot. `denied` identifies
 * the unavailable or stale fact, and the caller must leave the run unadmitted rather than retrying
 * with request provenance.
 */
export type ExecutionSubjectAdmissionLoad = { readonly outcome: "loaded"; readonly value: ExecutionSubject } | { readonly outcome: "denied"; readonly reason: ExecutionSubjectAdmissionDenialReason };

/** Refusal vocabulary that execution-subject issuance may return before any snapshot is persisted. */
export type ExecutionSubjectAdmissionDenialReason = "run_not_admittable" | "revision_unavailable" | "persona_unavailable" | "conversation_unavailable" | RunAdmissionDenialReasons.ActiveRun | "memory_scope_unavailable" | "memory_unavailable" | "tool_policy_unavailable" | "skill_unavailable" | "product_authorization_unavailable" | "budget_unavailable" | "membership_stale" | "identity_unavailable";
