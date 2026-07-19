import type { V1Job } from "@kubernetes/client-node";

import type { RuntimeJobTemplateInput } from "./job-template.types.js";

/** Builds the sole target runtime Job shape; it remains suspended until a future bootstrap authority enables execution. */
export function __BuildRuntimeJobTemplate(input: RuntimeJobTemplateInput): V1Job
{
	return {
		apiVersion: "batch/v1",
		kind: "Job",
		metadata: { name: input.name, labels: input.labels },
		spec: {
			suspend: true,
			backoffLimit: 0,
			template: {
				metadata: { labels: input.labels },
				spec: {
					serviceAccountName: input.serviceAccountName,
					automountServiceAccountToken: false,
					restartPolicy: "Never",
					securityContext: { runAsNonRoot: true, runAsUser: 1000, runAsGroup: 1000, fsGroup: 1000, seccompProfile: { type: "RuntimeDefault" } },
					containers: [{ name: "agent-runtime", image: input.image, securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] }, readOnlyRootFilesystem: true }, volumeMounts: [{ name: "runtime-token", mountPath: "/var/run/opencrane/tokens", readOnly: true }, { name: "runtime-proof", mountPath: "/run/opencrane/proof", readOnly: true }, { name: "runtime-scratch", mountPath: "/run/opencrane/scratch" }] }],
					volumes: [{ name: "runtime-token", projected: { defaultMode: 0o440, sources: [{ serviceAccountToken: { path: "token", audience: "opencrane", expirationSeconds: input.projectedTokenTtlSeconds } }] } }, { name: "runtime-proof", emptyDir: { medium: "Memory", sizeLimit: "16Mi" } }, { name: "runtime-scratch", emptyDir: { sizeLimit: "256Mi" } }],
				},
			},
		},
	};
}
