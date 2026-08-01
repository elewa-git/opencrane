import type { V1Job } from "@kubernetes/client-node";

import { __BuildSkillWorkloadJobSpec, __SkillWorkloadJobName } from "./skill-workload-job.js";
import type { SkillWorkloadJobAssignment, SkillWorkloadJobProfile } from "./skill-workload-job.types.js";

/**
 * Builds the tool-runner Job envelope around the shared hardened pod policy.
 *
 * This class-specific seam makes the tool runner's identity and registry label explicit without
 * giving it a separate security policy. The returned manifest intentionally contains only bounded
 * trace metadata plus an opaque exchange reference, never tool arguments, credentials, or bytes.
 */
export function __BuildToolRunnerWorkloadJob(assignment: SkillWorkloadJobAssignment, profile: SkillWorkloadJobProfile): V1Job
{
	// 1. Derive an opaque selector-safe resource name so the Job name does not reveal durable authority ids.
	const name = __SkillWorkloadJobName(assignment, profile);
	// 2. Retain only bounded trace coordinates and the opaque exchange reference; never project source or credentials.
	const annotations = { "opencrane.ai/silo-id": assignment.siloId, "opencrane.ai/job-id": assignment.jobId, "opencrane.ai/capability-reference": assignment.capabilityReference };
	// 3. Delegate the Pod security policy to the one shared builder so both workload classes stay equally constrained.
	return {
		apiVersion: "batch/v1",
		kind: "Job",
		metadata: { name, namespace: assignment.namespace, labels: { "app.kubernetes.io/name": "opencrane-tool-runner", "app.kubernetes.io/component": "tool-runner", "opencrane.ai/skill-workload": name }, annotations },
		spec: __BuildSkillWorkloadJobSpec(profile, "tool-runner", name, annotations),
	};
}
