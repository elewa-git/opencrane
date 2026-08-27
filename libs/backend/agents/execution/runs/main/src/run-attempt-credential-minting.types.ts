/** Holds immutable snapshot facts used to derive a task-bound model-key request. */
export interface RunAttemptCredentialInput
{
	/** Carries the frozen model route selected at AgentRun admission. */
	readonly modelRoute: unknown;
	/** Carries the frozen spend ceiling selected at AgentRun admission. */
	readonly budgetPolicy: unknown;
	/** Identifies the logical run that owns the model key. */
	readonly runId: string;
	/** Identifies the exact retry attempt that owns the model key. */
	readonly attempt: number;
	/** Identifies the silo that owns this model-key request. */
	readonly siloId: string;
	/** Makes a legacy caller's key alias distinct across delivery generations. */
	readonly deliveryCount: number;
	/** Limits the model key to the server-owned assignment lifetime. */
	readonly assignmentTtlMilliseconds: number;
}

/** Holds the non-secret model-key inputs derived from one immutable AgentRun snapshot. */
export interface RunAttemptCredentialMintInputs
{
	/** Names the model key for provider-side revocation without revealing its value. */
	readonly keyAlias: string;
	/** Names the one model route the run snapshot selected. */
	readonly modelAlias: string;
	/** Limits model spend for the attempt. */
	readonly maxBudgetUsd: number;
	/** Limits model-key validity to the runtime assignment lifetime. */
	readonly expirySeconds: number;
}
