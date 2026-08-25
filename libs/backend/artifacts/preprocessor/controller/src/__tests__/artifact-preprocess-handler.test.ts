import { describe, expect, it, vi } from "vitest";

import { RuntimeWorkloadClaimClasses } from "@opencrane/backend/agents/runtime/workloads/contract";
import { ArtifactPreprocessTaskDeclaration } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import { WorkflowTaskRetryableError } from "@opencrane/backend/server/infra/workflows/contract";

import { __CreateArtifactPreprocessHandler } from "../artifact-preprocess-handler";
import type { ArtifactPreprocessHandlerOptions, ArtifactPreprocessTaskContext } from "../artifact-preprocess-handler.types";

/** Return the fixed deployment profile that the PDF Job builder accepts. */
function _Profile()
{
	return {
		image: `ghcr.io/opencrane/artifact-preprocessor@sha256:${"a".repeat(64)}`,
		imagePullPolicy: "IfNotPresent" as const,
		serverNamespace: "opencrane",
		serverServiceName: "opencrane-server",
		namespace: "opencrane-artifact-preprocessor",
		serviceAccountName: "artifact-preprocessor",
		tokenAudience: "opencrane-artifact-preprocessor",
		openCraneInternalUrl: "http://opencrane-server.opencrane.svc.cluster.local:8081",
		tokenPath: "/var/run/opencrane/tokens/opencrane.token",
		bootstrapReferencePath: "/var/run/opencrane/bootstrap/reference",
		scratchSize: "128Mi",
		activeDeadlineSeconds: 300,
		ttlSecondsAfterFinished: 0,
		resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "1", memory: "512Mi" } },
	};
}

/** Return one task context that executes checkpoints immediately and records durable waits. */
function _Context()
{
	const checkpoints: string[] = [];
	const sleeps: Date[] = [];
	const context: ArtifactPreprocessTaskContext = {
		task: { taskId: "task-1", taskName: ArtifactPreprocessTaskDeclaration.taskName, idempotencyKey: "artifact-preprocess:preprocess-1" },
		async checkpoint(step, operation)
		{
			checkpoints.push(step.stepName);
			return await operation();
		},
		async sleepUntil(instant)
		{
			sleeps.push(instant);
		},
	};
	return { context, checkpoints, sleeps };
}

/** Return the server and Kubernetes ports for one claimed PDF preprocessing task. */
function _Options(overrides: Partial<ArtifactPreprocessHandlerOptions> = {})
{
	const job = { metadata: { uid: "job-uid-1" } };
	const pod = { metadata: { uid: "pod-uid-1" } };
	const authority = {
		claimForTask: vi.fn().mockResolvedValue({ preprocessJobId: "preprocess-1", siloId: "silo-1", claim: { claimId: "claim-1", siloId: "silo-1", workloadClass: RuntimeWorkloadClaimClasses.ArtifactPreprocess, profileName: "pdf-preprocessor", idempotencyKey: "artifact-preprocess:preprocess-1", executionReference: "preprocess-1", claimedAt: new Date(Date.now()).toISOString(), deliveryCount: 1, expiresAt: new Date(Date.now() + 300_000).toISOString() } }),
		bindWorkload: vi.fn().mockResolvedValue("bound"),
		bindFirstPod: vi.fn().mockResolvedValue("bound"),
	};
	const kubernetes = {
		ensureSuspendedJob: vi.fn().mockResolvedValue(job),
		releaseJob: vi.fn().mockResolvedValue(job),
		findFirstPod: vi.fn().mockResolvedValue(pod),
	};
	return {
		options: {
			authority,
			kubernetes,
			profile: _Profile(),
			podWaitMilliseconds: 100,
			...overrides,
		} satisfies ArtifactPreprocessHandlerOptions,
		authority,
		kubernetes,
	};
}

describe("artifact preprocessing workflow handler", function _DescribeArtifactPreprocessHandler()
{
	it("binds one suspended Job and its first Pod before the worker can access a PDF", async function _BindsJobAndPod()
	{
		const { options, authority, kubernetes } = _Options();
		const { context, checkpoints } = _Context();
		expect(__CreateArtifactPreprocessHandler(options)).toMatchObject(ArtifactPreprocessTaskDeclaration);

		const result = await __CreateArtifactPreprocessHandler(options).run(context as never, { siloId: "silo-1", preprocessJobId: "preprocess-1" });

		expect(result).toEqual({ preprocessJobId: "preprocess-1" });
		expect(checkpoints).toEqual(["claim-preprocess", "ensure-suspended-job", "bind-workload", "release-job", "bind-first-pod"]);
		expect(authority.bindWorkload).toHaveBeenCalledWith("preprocess-1", context.task, expect.objectContaining({ bootstrapReference: expect.any(String), namespace: "opencrane-artifact-preprocessor", binding: expect.objectContaining({ claimId: "claim-1", workloadUid: "job-uid-1" }) }));
		expect(authority.bindFirstPod).toHaveBeenCalledWith("preprocess-1", context.task, { binding: expect.objectContaining({ claimId: "claim-1", workloadUid: "job-uid-1", firstPodUid: "pod-uid-1" }) });
		expect(kubernetes.releaseJob).toHaveBeenCalledWith(expect.any(Object), "job-uid-1", expect.any(String));
	});

	it("uses a durable sleep while the released Job has no Pod", async function _SleepsForPod()
	{
		const { options, kubernetes } = _Options();
		kubernetes.findFirstPod.mockResolvedValueOnce(null).mockResolvedValueOnce({ metadata: { uid: "pod-uid-1" } });
		const { context, sleeps } = _Context();

		await __CreateArtifactPreprocessHandler(options).run(context as never, { siloId: "silo-1", preprocessJobId: "preprocess-1" });

		expect(sleeps).toHaveLength(1);
		expect(kubernetes.findFirstPod).toHaveBeenCalledTimes(2);
	});

	it("stops before release when the server rejects the workload claim fence", async function _StopsOnWorkloadConflict()
	{
		const { options, authority, kubernetes } = _Options();
		authority.bindWorkload.mockResolvedValue("conflict");
		const { context } = _Context();

		await expect(__CreateArtifactPreprocessHandler(options).run(context as never, { siloId: "silo-1", preprocessJobId: "preprocess-1" })).rejects.toThrow(/workload claim no longer matches/);

		expect(kubernetes.releaseJob).not.toHaveBeenCalled();
	});

	it("uses the shared retry policy when a server exchange is unavailable", async function _RetriesUnavailableServer()
	{
		const { options, authority } = _Options();
		authority.claimForTask.mockRejectedValue(new Error("temporary network failure"));
		const { context } = _Context();

		await expect(__CreateArtifactPreprocessHandler(options).run(context as never, { siloId: "silo-1", preprocessJobId: "preprocess-1" })).rejects.toBeInstanceOf(WorkflowTaskRetryableError);
	});

	it("retries when the released Job did not create a Pod before its claim expired", async function _RetriesExpiredPodWait()
	{
		const { options, authority, kubernetes } = _Options();
		authority.claimForTask.mockResolvedValue({ preprocessJobId: "preprocess-1", siloId: "silo-1", claim: { claimId: "claim-1", siloId: "silo-1", workloadClass: RuntimeWorkloadClaimClasses.ArtifactPreprocess, profileName: "pdf-preprocessor", idempotencyKey: "artifact-preprocess:preprocess-1", executionReference: "preprocess-1", claimedAt: "2020-01-01T00:00:00.000Z", deliveryCount: 1, expiresAt: "2020-01-01T00:05:00.000Z" } });
		const { context } = _Context();

		await expect(__CreateArtifactPreprocessHandler(options).run(context as never, { siloId: "silo-1", preprocessJobId: "preprocess-1" })).rejects.toBeInstanceOf(WorkflowTaskRetryableError);

		expect(kubernetes.ensureSuspendedJob).not.toHaveBeenCalled();
		expect(authority.bindWorkload).not.toHaveBeenCalled();
		expect(kubernetes.releaseJob).not.toHaveBeenCalled();
		expect(kubernetes.findFirstPod).not.toHaveBeenCalled();
	});
});
