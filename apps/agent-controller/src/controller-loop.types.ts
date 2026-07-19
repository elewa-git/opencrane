/** Minimal readiness boundary owned by the controller process. */
export interface ControllerReadiness
{
	/** Marks the process ready only after one complete safe reconciliation. */
	markReady(): void;
	/** Withdraws readiness when reconciliation cannot establish safe authority. */
	markUnready(): void;
}

/** Structured logging contract required by one controller reconciliation. */
export interface ControllerLoopLogger
{
	/** Records one completed non-idle reconciliation with bounded coordinates. */
	info(details: Record<string, unknown>, message: string): void;
	/** Records one retryable reconciliation failure without crashing the process loop. */
	warn(details: Record<string, unknown>, message: string): void;
}
