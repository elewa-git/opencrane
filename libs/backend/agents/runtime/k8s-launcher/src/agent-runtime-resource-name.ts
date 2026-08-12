import { createHash } from "node:crypto";

import type { AgentRuntimeJobAssignment } from "./agent-runtime-job.types.js";
import { _IsBoundedAgentRuntimeCoordinate } from "./agent-runtime-profile.js";

/**
 * Throw unless every assignment field is safe to write into Kubernetes names, labels, and annotations.
 *
 * These values come from the database and end up addressing real cluster objects, so they are
 * checked here rather than trusted: the attempt must be a positive integer, each identifier must be
 * non-empty, at most 256 characters, and free of control characters, the namespace must be a DNS
 * label, and the Secret name must be a valid DNS subdomain.
 *
 * Called by: {@link __BuildSuspendedAgentRuntimeJob} and {@link __AgentRuntimeAttemptResourceName}.
 * @param assignment - Recorded run coordinates about to be written into a Job.
 * @throws When any of the above fails. Nothing is returned, so passing means the whole assignment
 * is safe to use.
 * @see {@link _IsBoundedAgentRuntimeCoordinate}
 */
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

/**
 * Derive the attempt's resource name: a fixed prefix, the attempt number, and a hash of silo, run,
 * and attempt. Expects an already-validated assignment — it does no checking of its own.
 *
 * The hash keeps the name short enough for Kubernetes while staying unique per attempt, and the
 * attempt number stays readable in the clear so a Job can be identified at a glance.
 */
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
