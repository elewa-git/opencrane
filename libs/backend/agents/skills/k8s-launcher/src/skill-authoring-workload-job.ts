import type { V1Job } from "@kubernetes/client-node";

import { __BuildSkillWorkloadJobSpec, __SkillWorkloadJobName } from "./skill-workload-job.js";
import type { SkillWorkloadJobAssignment, SkillWorkloadJobProfile } from "./skill-workload-job.types.js";

/** Build the actual Job envelope owned by the skill-authoring deployable. */
export function __BuildSkillAuthoringWorkloadJob(assignment: SkillWorkloadJobAssignment, profile: SkillWorkloadJobProfile): V1Job
{
	const name = __SkillWorkloadJobName(assignment, profile);
	const annotations = { "opencrane.ai/silo-id": assignment.siloId, "opencrane.ai/job-id": assignment.jobId, "opencrane.ai/capability-reference": assignment.capabilityReference };
	return {
		apiVersion: "batch/v1",
		kind: "Job",
		metadata: { name, namespace: assignment.namespace, labels: { "app.kubernetes.io/name": "opencrane-skill-authoring", "app.kubernetes.io/component": "skill-authoring", "opencrane.ai/skill-workload": name }, annotations },
		spec: __BuildSkillWorkloadJobSpec(profile, "skill-authoring", name, annotations),
	};
}
