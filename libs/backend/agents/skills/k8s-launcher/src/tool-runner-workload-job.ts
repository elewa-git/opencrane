import type { V1Job } from "@kubernetes/client-node";

import { __BuildSkillWorkloadJobSpec, __SkillWorkloadJobName } from "./skill-workload-job.js";
import type { SkillWorkloadJobAssignment, SkillWorkloadJobProfile } from "./skill-workload-job.types.js";

/**
 * Builds the Job object for a tool-runner workload. The Pod spec inside it comes from
 * `__BuildSkillWorkloadJobSpec`, which both workload classes share.
 *
 * This function gives the tool runner its own ServiceAccount and registry label without giving it a
 * security policy of its own. The manifest it returns holds only the silo id, the job id, and the
 * opaque bootstrap reference — never tool arguments, credentials, or tool bytes.
 */
export function __BuildToolRunnerWorkloadJob(assignment: SkillWorkloadJobAssignment, profile: SkillWorkloadJobProfile): V1Job
{
	// 1. Derive an opaque selector-safe resource name so the Job name does not reveal durable authority ids.
	const name = __SkillWorkloadJobName(assignment, profile);
	// 2. Put only the silo id, the job id, and the bootstrap reference in annotations. Never put source code or credentials there.
	const annotations = { "opencrane.ai/silo-id": assignment.siloId, "opencrane.ai/job-id": assignment.jobId, "opencrane.ai/capability-reference": assignment.capabilityReference };
	// 3. Let the shared spec builder set the Pod security policy, so both workload classes are locked down the same way.
	return {
		apiVersion: "batch/v1",
		kind: "Job",
		metadata: { name, namespace: assignment.namespace, labels: { "app.kubernetes.io/name": "opencrane-tool-runner", "app.kubernetes.io/component": "tool-runner", "opencrane.ai/skill-workload": name }, annotations },
		spec: __BuildSkillWorkloadJobSpec(profile, "tool-runner", name, annotations),
	};
}
