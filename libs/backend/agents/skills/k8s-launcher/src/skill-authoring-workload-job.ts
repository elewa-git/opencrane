import type { V1Job } from "@kubernetes/client-node";

import { __BuildSkillWorkloadJobSpec, __SkillWorkloadJobName } from "./skill-workload-job.js";
import type { SkillWorkloadJobAssignment, SkillWorkloadJobProfile } from "./skill-workload-job.types.js";

/**
 * Builds the skill-authoring Job envelope around the shared hardened pod policy.
 *
 * This small class-specific seam keeps the authoring image's workload identity visible to the
 * controller and workload registry. It deliberately owns metadata only; all security posture,
 * token projection, suspension, retries, and cleanup remain centralized in the shared spec.
 */
export function __BuildSkillAuthoringWorkloadJob(assignment: SkillWorkloadJobAssignment, profile: SkillWorkloadJobProfile): V1Job
{
	// 1. Derive an opaque selector-safe resource name so the Job name does not reveal durable authority ids.
	const name = __SkillWorkloadJobName(assignment, profile);
	// 2. Retain only bounded trace coordinates and the opaque exchange reference; never project source or credentials.
	const annotations = { "opencrane.ai/silo-id": assignment.siloId, "opencrane.ai/job-id": assignment.jobId, "opencrane.ai/capability-reference": assignment.capabilityReference };
	// 3. Delegate the Pod security policy to the one shared builder so both workload classes stay equally constrained.
	return {
		apiVersion: "batch/v1",
		kind: "Job",
		metadata: { name, namespace: assignment.namespace, labels: { "app.kubernetes.io/name": "opencrane-skill-authoring", "app.kubernetes.io/component": "skill-authoring", "opencrane.ai/skill-workload": name }, annotations },
		spec: __BuildSkillWorkloadJobSpec(profile, "skill-authoring", name, annotations),
	};
}
