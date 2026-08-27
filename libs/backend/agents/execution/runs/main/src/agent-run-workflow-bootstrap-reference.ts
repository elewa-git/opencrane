import { createHash } from "node:crypto";

import type { AgentRunWorkflowBootstrapReferenceInput } from "./agent-run-workflow-bootstrap-reference.types";

/**
 * Creates the deterministic non-secret reference shared by task execution and later cleanup.
 *
 * Called by: the AgentRun workflow controller and cancellation authority. Both derive this from
 * the saved task receipt, so cleanup still finds a Job if cancellation wins before assignment.
 */
export function __AgentRunWorkflowBootstrapReference(input: AgentRunWorkflowBootstrapReferenceInput): string
{
	const canonical = JSON.stringify(["opencrane-agent-run-workflow-bootstrap-v1", input.taskId, input.runId, input.attempt, input.siloId, input.agentServiceId, input.agentRevisionId, input.inputSnapshotDigest]);
	return `bootstrap-v1_${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}
