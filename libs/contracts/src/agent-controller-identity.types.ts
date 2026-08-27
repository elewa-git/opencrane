/** Names the only projected-token audience the server accepts from the AgentRun workflow controller. */
export const AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE = "opencrane-agent-controller";

/** Names the Kubernetes ServiceAccount allowed to create and release AgentRun workflow Jobs. */
export const AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME = "agent-controller";

/** Names the database authority that permits cleanup of a runtime Job. */
export enum RunWorkloadCleanupModes
{
	/** Limits cleanup to a Job whose immutable UID the assignment already recorded. */
	Assigned = "assigned",
	/** Limits cleanup to an old suspended Job that never reached an assignment record. */
	UnassignedOrphan = "unassigned_orphan",
}
