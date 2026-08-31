/** Facts needed to decide whether terminal work can expose a Kubernetes Job for cleanup. */
interface _McpRuntimeTerminalWorkload<TState>
{
	/** Current lifecycle state of the Kubernetes workload. */
	readonly workloadState: TState;
	/** Saved Kubernetes Job UID, or null until assignment commits. */
	readonly workloadUid: string | null;
	/** Number of controller claim deliveries made for this execution. */
	readonly deliveryCount: number;
	/** Time when the current controller claim began. */
	readonly claimedAt: Date | null;
	/** Time when the current controller claim expires. */
	readonly claimExpiresAt: Date | null;
}

/** Repository-owned enum values used by the engine-free terminal decision. */
interface _McpRuntimeWorkloadStates<TState>
{
	/** The controller may claim this work, or has claimed it without saving a Job UID yet. */
	readonly Pending: TState;
	/** The controller saved the Job UID but has not released the suspended Job. */
	readonly Assigned: TState;
	/** The controller released the Job but its companion has not registered yet. */
	readonly Released: TState;
	/** The companion registered and may claim its saved command. */
	readonly Registered: TState;
	/** The execution no longer accepts controller or companion work. */
	readonly Closed: TState;
}

/**
 * Decide how unused runtime work must close after its command becomes terminal.
 *
 * A claimed Pending execution stays Pending until the controller records the Job UID. The late
 * assignment then moves it to Closed, which makes the Job visible to the cleanup controller. Work
 * that was never claimed can close immediately because no Kubernetes Job can exist.
 *
 * Called by: MCP task cancellation and workflow-attempt exhaustion.
 *
 * @returns The workload state to save, or null when the stored fields conflict and terminal
 * persistence must stop.
 */
export function _McpTerminalWorkloadState<TState>(execution: _McpRuntimeTerminalWorkload<TState>, states: _McpRuntimeWorkloadStates<TState>): TState | null
{
	if (execution.workloadState === states.Pending)
	{
		if (execution.workloadUid !== null)
			return null;
		if (execution.deliveryCount === 0 && execution.claimedAt === null && execution.claimExpiresAt === null)
			return states.Closed;
		if (execution.deliveryCount > 0 && execution.claimedAt !== null && execution.claimExpiresAt !== null)
			return states.Pending;
		return null;
	}
	if (execution.workloadState === states.Assigned || execution.workloadState === states.Released || execution.workloadState === states.Registered)
		return execution.workloadUid === null ? null : states.Closed;
	return null;
}
