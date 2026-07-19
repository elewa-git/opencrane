import { describe, expect, it } from "vitest";

import { __BuildRuntimeJobTemplate } from "./job-template.js";

describe("runtime Job template", function _describeRuntimeJobTemplate()
{
	it("creates only an inert zero-RBAC Job with one audience-bound token and ephemeral storage", function _buildsInertJob()
	{
		const job = __BuildRuntimeJobTemplate({ name: "agent-run-run-123-a1", labels: { "opencrane.io/run-id": "run-123" }, serviceAccountName: "agent-runtime", image: "ghcr.io/opencrane/agent-runtime@sha256:abc", projectedTokenTtlSeconds: 600 });
		const spec = job.spec!.template.spec!;
		expect(job.spec).toMatchObject({ suspend: true, backoffLimit: 0 });
		expect(spec).toMatchObject({ serviceAccountName: "agent-runtime", automountServiceAccountToken: false, restartPolicy: "Never" });
		expect(spec.containers![0]).toMatchObject({ name: "agent-runtime", securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true } });
		expect(spec.volumes).toEqual(expect.arrayContaining([expect.objectContaining({ name: "runtime-token", projected: expect.objectContaining({ sources: [expect.objectContaining({ serviceAccountToken: expect.objectContaining({ audience: "opencrane", expirationSeconds: 600 }) })] }) }), { name: "runtime-proof", emptyDir: { medium: "Memory", sizeLimit: "16Mi" } }, { name: "runtime-scratch", emptyDir: { sizeLimit: "256Mi" } }]));
	});
});
