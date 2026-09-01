import type { StartNextRunAttemptResult } from "@opencrane/backend/agents/execution/runs";
import type { RunInputSnapshot } from "@opencrane/contracts";
import type { AgentRunId, SiloId } from "@opencrane/models/agents";

/** Describes whether the inputs authority compiled the retry's new immutable snapshot. */
export enum RetryRunInputCompileOutcomes
{
	/** The compiler returned one fresh, attempt-bound snapshot. */
	Compiled = "compiled",
	/** The compiler refused the retry without producing a snapshot. */
	Denied = "denied",
}

/** Server-derived coordinates the inputs authority needs to compile one retry attempt. */
export interface RetryRunInputCompileCommand
{
	/** Identifies the existing logical run whose next attempt is being compiled. */
	readonly runId: AgentRunId;
	/** Identifies the terminal attempt the participant observed before requesting a retry. */
	readonly expectedAttempt: number;
	/** Identifies the silo that owns the run, caller, and target computer lease. */
	readonly siloId: SiloId;
	/** Identifies the participant-visible conversation the run must still belong to. */
	readonly conversationId: string;
	/** Identifies the authenticated participant request origin without granting execution authority. */
	readonly requesterSubjectId: string;
	/** Identifies the authenticated Principal whose request provenance is frozen into the subject. */
	readonly requesterPrincipalId: string;
	/** Records the server acceptance instant shared by compilation and the retry CAS. */
	readonly acceptedAt: string;
}

/** Denials the compiler may return without widening the retry route's published result contract. */
export type RetryRunInputCompileDenialReason = Extract<StartNextRunAttemptResult, { readonly outcome: "denied" }>["reason"];

/** Result from compiling the one fresh input snapshot that a retry CAS may persist. */
export type RetryRunInputCompileResult =
	| { readonly outcome: RetryRunInputCompileOutcomes.Compiled; readonly nextInputSnapshot: RunInputSnapshot }
	| { readonly outcome: RetryRunInputCompileOutcomes.Denied; readonly reason: RetryRunInputCompileDenialReason };

/**
 * Compiles the exact next-attempt execution subject and immutable input snapshot for a retry.
 *
 * Called by: `PrismaConversationUnitOfWork.retryRun` before it calls `RunRetryAuthority.retry`.
 * Implemented by: the execution-inputs composition, which must recheck the current AgentIdentity,
 * membership, capability decision, and ConversationComputer lease. Browser requester fields are
 * provenance only; this port returns no snapshot when it cannot prove the new execution subject.
 */
export interface RetryRunInputCompiler
{
	/** Builds a fresh, current-evidence snapshot for precisely the next retry attempt. */
	compile(command: RetryRunInputCompileCommand): Promise<RetryRunInputCompileResult>;
}
