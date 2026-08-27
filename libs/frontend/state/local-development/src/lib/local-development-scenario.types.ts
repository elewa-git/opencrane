/**
 * Selects the fault or latency behaviour available to Tier 1 gateways during one browser session.
 *
 * These values are development-adapter configuration, not product state. The URL parser treats the
 * set as closed and falls back to `HappyPath` for unknown values.
 */
export enum LocalDevelopmentScenarioKinds
{
	/** Every local operation completes without an injected delay or failure. */
	HappyPath = "happy-path",
	/** Gateway operations pause briefly so loading presentation stays visible. */
	Slow = "slow",
	/** The first call for each named mutation fails and its retry succeeds. */
	Retry = "retry",
	/** The first conversation stream waits for an explicit reconnect before live progress. */
	Reconnecting = "reconnecting",
	/** Agent runs fail so the workspace can exercise retry controls. */
	FailedRun = "failed-run",
	/** Conversation streams, detail reads, and child-thread reads report that access ended. */
	AccessChanged = "access-changed"
}
