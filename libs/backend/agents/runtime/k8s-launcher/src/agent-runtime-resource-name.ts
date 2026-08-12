import { createHash } from "node:crypto";

import type { AgentRuntimeJobAssignment } from "./agent-runtime-job.types.js";
import { _IsBoundedAgentRuntimeCoordinate } from "./agent-runtime-profile.js";

/** Validate assignment coordinates that cross from durable authority into Kubernetes metadata. */
export function _AssertAgentRuntimeJobAssignment(assignment: AgentRuntimeJobAssignment): void
{
	if (!Number.isSafeInteger(assignment.attempt) || assignment.attempt < 1)
	{
		throw new Error("agent runtime attempt must be a positive safe integer");
	}
	for (const value of [assignment.runId, assignment.agentServiceId, assignment.agentRevisionId, assignment.siloId, assignment.namespace, assignment.bootstrapReference])
	{
		if (!_IsBoundedAgentRuntimeCoordinate(value))
		{
			throw new Error("agent runtime assignment contains an invalid authority coordinate");
		}
	}
	if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(assignment.namespace) || assignment.namespace.length > 63)
	{
		throw new Error("agent runtime namespace must be a valid DNS label");
	}
	if (!/^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/.test(assignment.litellmKeySecretName) || assignment.litellmKeySecretName.length > 253)
	{
		throw new Error("agent runtime assignment requires a valid LiteLLM key Secret name");
	}
}

/** Derive the stable Kubernetes resource name from one validated run-attempt assignment. */
export function _AgentRuntimeAttemptResourceName(assignment: AgentRuntimeJobAssignment): string
{
	const digest = createHash("sha256").update(`${assignment.siloId}\u0000${assignment.runId}\u0000${assignment.attempt}`).digest("hex").slice(0, 24);
	return `agent-runtime-a${assignment.attempt}-${digest}`;
}

/**
 * Derive the deterministic runtime Job name from its durable attempt identity.
 * @param siloId - Silo authority containing the run.
 * @param runId - Logical run identifier.
 * @param attempt - Positive attempt number within the run.
 * @returns Collision-resistant Kubernetes resource name for the exact attempt.
 */
export function __AgentRuntimeAttemptResourceName(siloId: string, runId: string, attempt: number): string
{
	const assignment = { siloId, runId, attempt, agentServiceId: "name-derivation", agentRevisionId: "name-derivation", namespace: "runtime", bootstrapReference: "name-derivation", litellmKeySecretName: "name-derivation" };
	_AssertAgentRuntimeJobAssignment(assignment);
	return _AgentRuntimeAttemptResourceName(assignment);
}
