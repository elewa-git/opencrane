import type { ExecutionSubjectAdmissionAuthority } from "@opencrane/backend/agents/execution/admission";
import type { RetryRunInputCompiler } from "@opencrane/backend/server/conversations";

/**
 * Carries the two execution-subject authorities that the OpenCrane process must compose together.
 *
 * Initial admission resolves a subject after preparation in its serializable transaction. Retry
 * compilation rechecks the same facts for the next immutable attempt. ADR 0016 requires both paths
 * to use current identity, membership, capability, and active-lease evidence before they continue.
 */
export interface ExecutionSubjectComposition
{
	/** Resolves an initial run's execution subject inside its admission transaction. */
	readonly admissionAuthority: ExecutionSubjectAdmissionAuthority;
	/** Compiles a fresh retry snapshot after rechecking identity, policy, and computer lease facts. */
	readonly retryInputCompiler: RetryRunInputCompiler;
}
