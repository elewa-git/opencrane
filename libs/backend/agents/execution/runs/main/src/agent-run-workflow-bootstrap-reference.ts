import { createHash } from "node:crypto";

import type { AgentRunWorkflowBootstrapReferenceInput } from "./agent-run-workflow-bootstrap-reference.types";

/**
 * Creates the deterministic non-secret reference shared by task execution and warm Pod binding.
 *
 * Called by: the AgentRun workflow controller when it reserves and binds a warm runtime. Both
 * operations derive the same value from the saved task receipt, so a retry cannot change identity.
 */
export function __AgentRunWorkflowBootstrapReference(input: AgentRunWorkflowBootstrapReferenceInput): string
{
	const canonical = JSON.stringify(["opencrane-agent-run-workflow-bootstrap-v1", input.taskId, input.runId, input.attempt, input.siloId, input.agentServiceId, input.agentRevisionId, input.inputSnapshotDigest]);
	return `bootstrap-v1_${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}
