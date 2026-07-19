/** Local-only lifecycle control for the controller's Kubernetes probe listener. */
export interface ControllerHealth
{
	/** Starts the private listener before the controller performs its first reconciliation. */
	listen(): Promise<void>;
	/** Marks the controller safe for Kubernetes readiness admission. */
	markReady(): void;
	/** Marks the controller unavailable for new readiness admission. */
	markUnready(): void;
	/** Stops probe responses before telemetry shutdown and process exit. */
	shutdown(): Promise<void>;
	/** Returns the actual bound port, including an ephemeral test port. */
	port(): number;
}

/** Bound probe-listener configuration. */
export interface ControllerHealthOptions
{
	/** TCP port used only by kubelet HTTP probes. */
	readonly port: number;
}
