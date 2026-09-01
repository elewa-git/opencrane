import type { AgentRunTerminalReason, Prisma, RuntimeCommandKind, WorkloadKind } from "@prisma/client";

import type { CompiledRunInput, RunInputSnapshot, RuntimeExternalActionCandidate } from "@opencrane/contracts";
import type { ExpireElicitationBatchCommand, OpenElicitationCommand, RuntimeElicitationUnitOfWork } from "@opencrane/backend/agents/execution/elicitation";
import type { ExecutionSubject } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";
import type { ToolInvocationRunRecoveryAuthority } from "@opencrane/backend/server/iam/authorization";

import type { RuntimeAdmissionRunState } from "./runtime-protocol-authority.types";
import type { RuntimeWaitReasons } from "./runtime-wait-reasons.types";
import type { RuntimeExternalActionAuthorizationEvidence } from "./runtime-external-action-authorization.types";

/** Exact Prisma transaction shared by runtime admission collaborators. */
export type RuntimeDispatchTransaction = Prisma.TransactionClient;

/**
 * Turns an immutable snapshot into the literal input carried on `start_attempt`.
 *
 * The dispatch authority calls it inside the same Serializable transaction that loads the snapshot, so it
 * reads only immutable records and must return byte-identical output for a given snapshot and live
 * attempt on every mint and idempotent redelivery. The runtime treats the returned payload as opaque.
 */
export type RunInputCompiler = (snapshot: RunInputSnapshot, attempt: number, transaction: Prisma.TransactionClient) => Promise<CompiledRunInput>;

/**
 * Deployment-fixed settings for creating and expiring runtime commands.
 *
 * Validated once in the {@link PrismaRuntimeDispatchAuthority} constructor, which throws when the
 * two namespaces are equal or invalid, or the lifetime is outside 1s-300s. The namespaces are a
 * security boundary rather than a convenience: a Pod whose namespace is neither of these gets no
 * command at all, and personal and managed runtimes are kept apart so a personal Pod can never be
 * served a managed run's work.
 *
 * Called by: apps/opencrane/src/app/runtime-composition.ts builds it from `InternalRuntimeConfig`
 * and passes it to `__CreateProductionRuntimeDispatchAuthority`.
 */
export interface RuntimeDispatchAuthorityConfig
{
	/** Dedicated namespace containing personal runtime Pods and no server workload. */
	readonly personalRuntimeNamespace: string;
	/** Dedicated namespace containing managed runtime Pods and no personal workload identity. */
	readonly managedRuntimeNamespace: string;
	/** How long a new command stays valid. It is never longer than the assignment lease. */
	readonly commandTtlMilliseconds: number;
}

/**
 * The Pod identity the transport has already verified, and that this package trusts.
 *
 * Produced by Kubernetes TokenReview in the transport layer, never parsed from a request body.
 * Every dispatch method starts by checking these fields against the stored WorkloadAssignment, so a
 * Pod can only ever be served the run its own assignment names.
 *
 * Called by: passed in on every stream and candidate call by
 * libs/backend/server/infra/agent-runtime-stream/src/agent-runtime-stream.ts.
 */
export interface RuntimeStreamWorkloadIdentity
{
	/** Kubernetes ServiceAccount subject returned by TokenReview. */
	readonly subject: string;
	/** Kubernetes namespace parsed from the authenticated subject. */
	readonly namespace: string;
	/** Kubernetes ServiceAccount name parsed from the authenticated subject. */
	readonly serviceAccountName: string;
	/** Kubernetes Pod UID asserted by TokenReview for this projected token. */
	readonly podUid: string;
}

/** Terminal lifecycle persistence supplied by the composition root without reversing library dependencies. */
export interface RuntimeEventReporter
{
	/** Validate and persist an already-fenced canonical runtime event in the current transaction. */
	reportInTransaction(transaction: Prisma.TransactionClient, command: { readonly runId: string; readonly attempt: number; readonly sourceIsStartAttempt: boolean; readonly eventType: string; readonly payload: JsonValue }): Promise<{ readonly outcome: "reported" | "denied"; readonly reason?: string }>;
}

/** Runs-owned recovery transition used when no safe runtime command can be built. */
export type RuntimeDispatchRecoveryAuthority = Pick<ToolInvocationRunRecoveryAuthority, "enterRecoveryRequiredInTransaction">;

/** Rechecks current product authority before dispatch admits one durable external effect. */
export interface RuntimeExternalActionAuthorization
{
	/**
	 * Admit the exact frozen tool action through the central authority on the dispatch transaction.
	 *
	 * The implementation must recheck current lifecycle and grant state. Returning null leaves both
	 * the candidate id and its ToolInvocation absent, so a runtime can never interpret a stale frozen
	 * snapshot as current permission. An admitted result carries all authority-derived evidence that
	 * the caller must persist with the ToolInvocation on this transaction.
	 */
	admitInTransaction(transaction: Prisma.TransactionClient, context: RuntimeDispatchContext, candidate: RuntimeExternalActionCandidate, now: Date): Promise<RuntimeExternalActionAuthorizationEvidence | null>;
}

/** Transaction-bound lifecycle and central-grant adapter used by runtime effect admission. */
export interface RuntimeExternalActionAuthorizationRepository
{
	/** Recheck and record the exact external action using this repository's transaction. */
	admit(context: RuntimeDispatchContext, candidate: RuntimeExternalActionCandidate, now: Date): Promise<RuntimeExternalActionAuthorizationEvidence | null>;
}

/**
 * Closes approvals whose deadline has passed, in the caller's transaction.
 *
 * A run waiting for a person to approve a tool call cannot move on by itself. Command polling
 * therefore runs this first, inside the transaction that already holds the run lock, so expiry and
 * the command decision see the same state and cannot race each other. When it is not wired a
 * waiting run simply never advances: `__NextCommand` returns null rather than guess that the wait
 * is over.
 *
 * Called by: `PrismaRuntimeCommandDecisionUnitOfWork.expireWaiting`
 * (prisma-runtime-command-decision-unit-of-work.ts), reached from `_nextCommand`. Implemented by
 * `__ExpireDeferredToolApprovalBatch`, wired in production-runtime-dispatch.ts.
 */
export interface RuntimeApprovalExpiry
{
	/**
	 * Close every overdue approval for one waiting attempt.
	 *
	 * @param transaction - The dispatch transaction, which already holds the run lock.
	 * @param command - Run, attempt, and the trusted server time to compare deadlines against.
	 * @returns `expiredCount` - how many approvals were closed. `resumed` - whether closing them
	 * released the run, which is what lets command polling then decide a resume command. The caller
	 * re-reads the run state afterwards rather than trusting either number.
	 */
	expireInTransaction(transaction: Prisma.TransactionClient, command: { readonly runId: string; readonly attempt: number; readonly now: Date }): Promise<{ readonly expiredCount: number; readonly resumed: boolean }>;
}

/**
 * Binds runtime elicitation work to the transaction opened by dispatch.
 *
 * The factory keeps the protocol package independent from Prisma elicitation storage while ensuring
 * the concrete adapter cannot open a nested transaction.
 *
 * Called by: `_admitCandidate` and `_nextCommand` in prisma-runtime-dispatch-authority.ts. Production
 * composition provides it through `_CreateProductionRuntimeElicitationUnitOfWorkFactory`.
 */
export interface RuntimeElicitationUnitOfWorkFactory
{
	/** Bind generic request work to the caller's existing transaction without starting another one. */
	bind(transaction: Prisma.TransactionClient): RuntimeElicitationUnitOfWork;
}

/**
 * Decides the next command for one poll, and closes overdue approvals, on the caller's transaction.
 *
 * Kept as a port so the dispatch authority never reads approval or tool-result tables itself: it
 * hands over the run's state and the commands already sent, and gets back one decision. Everything
 * it does must use the caller's transaction, because the decision is only sound while the run lock
 * is held.
 *
 * Called by: `_nextCommand` in prisma-runtime-dispatch-authority.ts. Implemented by
 * `PrismaRuntimeCommandDecisionUnitOfWork`.
 */
export interface RuntimeCommandDecisionUnitOfWork
{
	/**
	 * Read every server-proven wait reason while the caller still holds the run lock.
	 *
	 * @param context - Exact run, attempt, and current run state.
	 * @returns A deduplicated, stable-order list containing no participant or tool content.
	 */
	readWaitReasons(context: { readonly runId: string; readonly attempt: number; readonly runState: RuntimeAdmissionRunState }): Promise<readonly RuntimeWaitReasons[]>;
	/**
	 * Close overdue approvals while the caller holds the lock on the waiting run.
	 *
	 * @param context - Run, attempt, and current run state.
	 * @param approvalExpiry - The injected expiry port, or null when none was wired.
	 * @param elicitationUnitOfWork - Generic request expiry already bound to the caller transaction.
	 * @param now - Trusted server time.
	 * @returns `not_required` - the run is not waiting for approval; carry on and decide a command.
	 * `applied` - deadlines were processed, which obliges the caller to re-read the run before
	 * deciding, because it may now be resumable or cancelling. `unavailable` - the run is waiting but
	 * no expiry port exists, which obliges the caller to send nothing at all.
	 */
	expireWaiting(context: { readonly runId: string; readonly attempt: number; readonly runState: RuntimeAdmissionRunState }, approvalExpiry: RuntimeApprovalExpiry | null, elicitationUnitOfWork: RuntimeElicitationUnitOfWork, now: Date): Promise<"not_required" | "applied" | "unavailable">;
	/**
	 * Pick the next command kind from the run's saved state and the commands already sent.
	 *
	 * @param context - Run, attempt, and current run state.
	 * @param commands - Commands already sent for this attempt, so a second start or cancel cannot be
	 * produced.
	 * @returns The kind to create, or null when nothing is due right now - the normal idle answer,
	 * not an error.
	 */
	decide(context: { readonly runId: string; readonly attempt: number; readonly runState: RuntimeAdmissionRunState }, commands: readonly { readonly kind: RuntimeCommandKind }[]): Promise<RuntimeCommandKind | null>;
}

/** Owns the one-use runtime-instance binding inside the dispatch transaction. */
export interface RuntimeStreamBindingRepository
{
	/** Binds an empty stream, keeps the same owner, or rejects a competing runtime instance. */
	bind(context: { readonly runId: string; readonly attempt: number }, runtimeInstanceId: string): Promise<string | null>;
}

/** Database facts about one connected runtime Pod's run and assignment. */
export interface RuntimeDispatchContext
{
	/** Run authorised for the connected Pod. */
	readonly runId: string;
	/** Run attempt this workload assignment was issued for. */
	readonly attempt: number;
	/** AgentService executed by the workload. */
	readonly agentServiceId: string;
	/** Immutable AgentRevision the runtime runs. */
	readonly agentRevisionId: string;
	/** Silo in which the assignment is valid. */
	readonly siloId: string;
	/** State of the owning run. */
	readonly runState: RuntimeAdmissionRunState;
	/** Why the run is ending. */
	readonly terminalReason: AgentRunTerminalReason | null;
	/** Digest of the assignment's fixed identity fields. */
	readonly assignmentDigest: string;
	/** Digest of the immutable input snapshot. */
	readonly inputSnapshotDigest: string;
	/** Immutable input snapshot sent with the first command. */
	readonly snapshot: RunInputSnapshot;
	/** Agent-session conversation from the snapshot. */
	readonly conversationId: string | null;
	/** Approved persona revision, when present. */
	readonly personaRevisionId: string | null;
	/** Exact identity, principal, evidence, run, and computer lease admitted for this attempt. */
	readonly executionSubject: ExecutionSubject;
	/** Verified workload profile selected for this computer realization. */
	readonly workloadProfile: string;
	/** Expected Kubernetes ServiceAccount. */
	readonly serviceAccountName: string;
	/** Kubernetes workload kind. */
	readonly workloadKind: WorkloadKind;
	/** Registered runtime Pod UID. */
	readonly podUid: string;
	/** Assignment lease expiry in epoch milliseconds. */
	readonly leaseExpiresAtEpochMs: number;
	/** Assignment issue time. */
	readonly assignmentIssuedAt: string;
	/** Assignment expiry time. */
	readonly assignmentExpiresAt: string;
}

/** Stored command fields needed for redelivery and sequence checks. */
export interface DispatchedCommandRow
{
	/** Server-issued idempotency key. */
	readonly commandId: string;
	/** Monotonic command sequence. */
	readonly sequence: number;
	/** Stored command kind. */
	readonly kind: RuntimeCommandKind;
	/** Lease fence carried by the command. */
	readonly fence: number;
	/** Saved resume payload, when present. */
	readonly payload: Prisma.JsonValue | null;
	/** Command issue time. */
	readonly issuedAt: Date;
	/** Command expiry time. */
	readonly expiresAt: Date;
}

/**
 * The answer to one candidate the runtime offered.
 *
 * `accepted: true` means the proposal is durable: the runtime may go ahead, and the transport
 * answers 202. `accepted: false` means it must not, and the transport answers 409 - this authority
 * never sets the transport's optional `retryable` flag, so every refusal is final for that exact
 * candidate. Conflating the two is the dangerous mistake: a runtime that treats a refusal as
 * acceptance performs an effect the server has no record of, and nothing will ever deliver its
 * result.
 *
 * The reasons fall into five groups, and the right response differs for each.
 * - Stale connection - `namespace_mismatch`, `unknown_workload`, `no_active_stream`,
 *   `runtime_instance_mismatch`, `fence_mismatch`, `assignment_mismatch`, `expired`,
 *   `command_not_accepted`: this Pod no longer owns the work. Stop and let the stream be rebound;
 *   retrying the same candidate cannot succeed.
 * - The run is over - `terminal_run`: it finished or is cancelling. Abandon the work. A candidate
 *   is never accepted during cancellation, so cancelled work can neither continue nor reopen a
 *   finished run.
 * - The runtime asked for something it may not do - `invalid_candidate`, `unsupported_protocol`,
 *   `runtime_cancellation_not_authoritative`, `runtime_tool_lifecycle_not_authoritative`,
 *   `external_action_invalid`: a bug in the runtime, not a race. Do not retry.
 * - Current permission was withdrawn - `external_action_not_authorized`: abandon the exact action;
 *   a new run admission is required before current grants may authorize another proposal.
 * - The server could not take it - `event_reporter_unavailable`, `event_report_denied` or any
 *   reason the injected event reporter returns, `external_action_conflict`,
 *   `external_action_replay_conflict`: nothing was written.
 *   `external_action_replay_conflict` specifically means a candidate id that was already accepted
 *   came back with different arguments, which must never be retried under that id.
 *
 * @see PrismaRuntimeDispatchAuthority.__AdmitCandidate which returns this.
 * @see RuntimeCandidateAdmission in agent-runtime-stream.types.ts for the transport-facing shape.
 */
export interface RuntimeCandidateDispatchResult
{
	/** True when the proposal is now durable, including a repeat of one already accepted. */
	readonly accepted: boolean;
	/** Why it was refused; absent when accepted. See the four groups on {@link RuntimeCandidateDispatchResult}. */
	readonly reason?: string;
}
