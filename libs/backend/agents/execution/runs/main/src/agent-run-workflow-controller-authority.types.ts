import type { AttemptModelKeyIssuerWithRevocation } from "./attempt-model-key.types";

/**
 * Supplies the fixed runtime settings for AgentRun workflow controller operations.
 *
 * The application composition selects these values. A controller task cannot choose a namespace,
 * a workload lifetime, or a model-key issuer for itself.
 */
export interface AgentRunWorkflowControllerAuthorityOptions
{
	/** Names the namespace that contains personal warm runtime Pods. */
	readonly personalRuntimeNamespace: string;
	/** Names the namespace that contains managed warm runtime Pods. */
	readonly managedRuntimeNamespace: string;
	/** Limits how long a saved runtime assignment may remain usable. */
	readonly assignmentTtlMilliseconds: number;
	/** Mints the transient model key after the database transaction has committed. */
	readonly issueAttemptModelKey: AttemptModelKeyIssuerWithRevocation;
}
