import type { RunAdmissionTransaction } from "./run-admission.types";
import type { StartNextRunAttemptCommand, StartNextRunAttemptResult } from "./run-authority.types";

/** Describes whether the retry inputs authority compiled the next immutable snapshot. */
export enum RetryRunInputCompileOutcomes
{
	/** The compiler returned one snapshot bound to the retry's next attempt. */
	Compiled = "compiled",
	/** The compiler refused the retry without producing a snapshot. */
	Denied = "denied",
}

/**
 * Compiles the execution subject and immutable snapshot for a retry inside the run-owned transaction.
 *
 * Called by: `PrismaAgentRunRetryUnitOfWork` only after it has checked the requester, exact retry
 * replay, run, and AgentService authority in its serializable transaction. Implemented by the app
 * composition that joins the current AgentIdentity, membership, capability decision, and computer
 * lease evidence.
 */
export interface RetryRunInputCompiler
{
	/** Builds the fresh current-evidence snapshot through the exact serializable retry transaction. */
	compile(command: StartNextRunAttemptCommand, transaction: RunAdmissionTransaction): Promise<
		| { readonly outcome: RetryRunInputCompileOutcomes.Compiled; readonly nextInputSnapshot: import("@opencrane/contracts").RunInputSnapshot }
		| { readonly outcome: RetryRunInputCompileOutcomes.Denied; readonly reason: Extract<StartNextRunAttemptResult, { readonly outcome: "denied" }>["reason"] }
	>;
}
