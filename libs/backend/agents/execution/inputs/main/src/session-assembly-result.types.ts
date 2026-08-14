import type { RunInputSnapshot } from "@opencrane/contracts";
import { RunAdmissionDenialReasons } from "@opencrane/backend/agents/execution/runs";

/**
 * The two things {@link __AssembleRunInputSnapshot} can return.
 *
 * Assembly is all-or-nothing: either every source loaded and one snapshot was saved, or nothing
 * was saved at all. There is no partial outcome, so a caller never has to clean up after `Denied`.
 *
 * Used by: `managed-run-admission.ts` and `personal-run-admission.ts` in
 * execution/admission/main/src, which branch on this before reading `reason` or `snapshot`.
 */
export enum SessionAssemblyOutcomes
{
	/**
	 * Every required input loaded and one immutable snapshot was saved.
	 *
	 * Read `admissionOutcome` next: it says whether this call created the run or found an existing
	 * one. See {@link RunInputSnapshotAdmissionOutcomes}.
	 */
	Assembled = "assembled",
	/**
	 * A source refused, or the write itself failed. Nothing was saved.
	 *
	 * Read `reason` to decide what to do: see {@link SessionAssemblyRefusalReason}. Do not retry
	 * blindly — most reasons will fail again with the same command.
	 */
	Denied = "denied",
}

/**
 * Whether an assembled snapshot is new, or one that already existed.
 *
 * These two must never be collapsed. `Accepted` means this call is the one that created the run,
 * so this caller owns starting the runtime for it. `Idempotent` means an earlier call already
 * created that run and this one only re-read its snapshot. A caller that treats `Idempotent` as
 * `Accepted` dispatches a second runtime for a run that is already executing.
 *
 * Used by: `_CreateManagedRunAdmissionPortWithGate` (execution/admission/main/src/managed-run-admission.ts)
 * and `__CreatePersonalRunAdmissionPortWithGate` (execution/admission/main/src/personal-run-admission.ts),
 * which each map these onto their own accepted/idempotent outcome.
 */
export enum RunInputSnapshotAdmissionOutcomes
{
	/**
	 * This call created the run and saved a new immutable snapshot.
	 *
	 * The caller owns whatever happens next for this run.
	 */
	Accepted = "accepted",
	/**
	 * This `requestIdempotencyKey` was already used, so the returned snapshot is the original one.
	 *
	 * Nothing was written. Report success to the caller, but do not start a runtime — the run this
	 * snapshot belongs to was already admitted.
	 */
	Idempotent = "idempotent",
}

/**
 * Why assembly refused. Every one of these fires before anything is written, so the caller never
 * has to undo a partial run.
 *
 * What each reason obliges the caller to do:
 * - `invalid_command` - the command itself is malformed (a blank id, or a trigger that does not
 *   match the identity kind). A programming error; retrying the same command always fails again.
 * - `run_not_admittable` - the AgentService is missing, not active, or its kind does not match the
 *   caller's identity kind. Also returned when the idempotency key belongs to a different run.
 *   Do not retry with the same key.
 * - `revision_unavailable` - the service's active-revision pointer and the revision itself
 *   disagree, or the revision is not published. Someone is mid-publish; retry later.
 * - `persona_unavailable` - a personal run has no approved persona, or a managed run somehow
 *   carried one. The user must get a persona revision approved first.
 * - `conversation_unavailable` - the conversation is closed, the caller is no longer a participant,
 *   their org membership is gone, or a non-conversational run arrived with messages. Not retryable
 *   as sent.
 * - `active_run` ({@link RunAdmissionDenialReasons.ActiveRun}) - another run that has not finished
 *   already owns this conversation. Wait for it to end, then retry.
 * - `memory_scope_unavailable` - this run's kind or identity is not eligible for the memory source
 *   that was wired in. A composition mistake, not a user error.
 * - `memory_unavailable` - the memory gateway failed while selecting facts. Assembly fails closed
 *   here on purpose, rather than freezing an empty memory set that would look like "no facts".
 *   Safe to retry.
 * - `tool_policy_unavailable` - the revision is no longer published, or an integration is
 *   inactive, or its custody reference expired, or a tool definition failed review, or an assigned
 *   skill/artifact is not a published revision in this silo. An operator must fix the revision.
 * - `skill_unavailable` - the skill re-check at the end of admission refused: a skill revision was
 *   named twice, never assigned, revoked, from another silo, or not published.
 * - `budget_unavailable` - the revision's budget is missing, malformed, or holds values that
 *   cannot be represented. An operator must fix the revision.
 * - `membership_stale` - signed fleet membership is missing, did not verify, or its trust window
 *   has already expired at admission time. The user must re-authenticate or membership must be
 *   re-signed.
 * - `identity_unavailable` - the resolved identity does not match the run (wrong kind, wrong
 *   service principal, or an invalid digest). Fail the request; never fall back to a weaker
 *   identity.
 * - `persistence_unavailable` - the write failed without a classifiable result. This is the only
 *   reason that is safe to retry with the SAME idempotency key.
 *
 * Consumed by: `_runAdmissionDenial` in
 * libs/backend/server/conversations/main/src/db/prisma-conversation-unit-of-work.ts, which maps these
 * onto the conversation write denials the HTTP layer returns. A new member added here without
 * updating that mapper falls through to its default.
 */
export type SessionAssemblyRefusalReason = "invalid_command" | "run_not_admittable" | "revision_unavailable" | "persona_unavailable" | "conversation_unavailable" | RunAdmissionDenialReasons.ActiveRun | "memory_scope_unavailable" | "memory_unavailable" | "tool_policy_unavailable" | "skill_unavailable" | "budget_unavailable" | "membership_stale" | "identity_unavailable" | "persistence_unavailable";

/**
 * What {@link __AssembleRunInputSnapshot} returns.
 *
 * Check `outcome` first. On `assembled`, `snapshot` is the immutable input the runtime will be
 * given, and `admissionOutcome` says whether this call created the run (`accepted`) or found an
 * existing one (`idempotent`) — see {@link RunInputSnapshotAdmissionOutcomes} for why those two
 * must stay apart. On `denied`, nothing was written and `reason` says what to do next; see
 * {@link SessionAssemblyRefusalReason}.
 *
 * Used by: `ManagedSnapshotAssembler` and `PersonalRunSnapshotAssembler` in
 * execution/admission/main/src, which are the only two shapes that call the assembler.
 */
export type AssembleRunInputSnapshotResult = { readonly outcome: "assembled"; readonly admissionOutcome: "accepted" | "idempotent"; readonly snapshot: RunInputSnapshot } | { readonly outcome: "denied"; readonly reason: SessionAssemblyRefusalReason };
