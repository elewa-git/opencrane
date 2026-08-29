import type { V1Job } from "@kubernetes/client-node";

import { __BuildSkillWorkloadJobSpec, __SkillWorkloadJobName } from "./skill-workload-job";
import type { SkillWorkloadJobAssignment, SkillWorkloadJobProfile } from "./skill-workload-job.types";

/**
 * Builds the Job object for a skill-authoring workload. The Pod spec inside it comes from
 * `__BuildSkillWorkloadJobSpec`, which owns the common restricted Job envelope.
 *
 * This function exists so the authoring class has its own named entry point that the controller and
 * the workload registry can find. It sets metadata only. Everything about security — the security
 * context, the token mounts, `suspend`, retries, and cleanup — stays in the shared spec builder.
 */
export function __BuildSkillAuthoringWorkloadJob(assignment: SkillWorkloadJobAssignment, profile: SkillWorkloadJobProfile): V1Job
{
	// 1. Derive an opaque selector-safe resource name so the Job name does not reveal durable authority ids.
	const name = __SkillWorkloadJobName(assignment, profile);
	// 2. Put only the silo id, the job id, and the bootstrap reference in annotations. Never put source code or credentials there.
	const annotations = { "opencrane.ai/silo-id": assignment.siloId, "opencrane.ai/job-id": assignment.jobId, "opencrane.ai/capability-reference": assignment.capabilityReference };
	// 3. Let the shared spec builder set the Pod security policy, so both workload classes are locked down the same way.
	return {
		apiVersion: "batch/v1",
		kind: "Job",
		metadata: { name, namespace: assignment.namespace, labels: { "app.kubernetes.io/name": "opencrane-skill-authoring", "app.kubernetes.io/component": "skill-authoring", "opencrane.ai/skill-workload": name }, annotations },
		spec: __BuildSkillWorkloadJobSpec(profile, "skill-authoring", name, annotations),
	};
}
