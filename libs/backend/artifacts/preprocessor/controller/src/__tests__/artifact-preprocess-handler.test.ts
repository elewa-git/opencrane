import { describe, expect, it, vi } from "vitest";

import { RuntimeWorkloadClaimClasses } from "@opencrane/backend/agents/runtime/workloads/contract";
import { __ArtifactPreprocessOutcomeEventName, ArtifactPreprocessOutcomeKinds, ArtifactPreprocessTaskDeclaration } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import type { ArtifactPreprocessOutcome } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import { WorkflowTaskCancelledError, WorkflowTaskRetryableError, WorkflowTaskTerminalError } from "@opencrane/backend/server/infra/workflows/contract";

import { __CreateArtifactPreprocessHandler } from "../artifact-preprocess-handler";
import type { ArtifactPreprocessHandlerOptions, ArtifactPreprocessTaskContext } from "../artifact-preprocess-handler.types";

/** Returns the fixed deployment profile that the PDF Job builder accepts. */
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
		resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "1", memory: "512Mi" } },
	};
}

/** Returns one server-issued claim for the selected delivery. */
function _Record(deliveryCount: number)
{
	return { preprocessJobId: "preprocess-1", siloId: "silo-1", claim: { claimId: `claim-${deliveryCount}`, siloId: "silo-1", workloadClass: RuntimeWorkloadClaimClasses.ArtifactPreprocess, profileName: "pdf-preprocessor", idempotencyKey: "artifact-preprocess:preprocess-1", executionReference: "preprocess-1", claimedAt: new Date(Date.now()).toISOString(), deliveryCount, expiresAt: new Date(Date.now() + 300_000).toISOString() } };
}

/** Returns the persisted successful outcome for one delivery. */
function _Completed(deliveryCount: number): ArtifactPreprocessOutcome
{
	return { kind: ArtifactPreprocessOutcomeKinds.Completed, preprocessJobId: "preprocess-1", deliveryCount, completionDigest: `sha256:${"c".repeat(64)}` };
}

/** Returns one task context that caches checkpoints and private events like a replaying workflow engine. */
function _Context()
{
	const checkpoints: string[] = [];
	const sleeps: { readonly instant: Date; readonly stepName?: string }[] = [];
	const waitedEvents: string[] = [];
	const checkpointValues = new Map<string, unknown>();
	const eventValues = new Map<string, unknown>();
	const context: ArtifactPreprocessTaskContext = {
		task: { taskId: "task-1", taskName: ArtifactPreprocessTaskDeclaration.taskName, idempotencyKey: "artifact-preprocess:preprocess-1" },
		async checkpoint(step, operation)
		{
			checkpoints.push(step.stepName);
			if (checkpointValues.has(step.stepName))
			{
				return checkpointValues.get(step.stepName) as Awaited<ReturnType<typeof operation>>;
			}
			const value = await operation();
			checkpointValues.set(step.stepName, value);
			return value;
		},
		async sleepUntil(instant, stepName)
		{
			sleeps.push({ instant, stepName });
		},
		async waitForEvent<TPayload>(eventName: string)
		{
			waitedEvents.push(eventName);
			if (!eventValues.has(eventName))
			{
				const match = /:([1-9][0-9]*)$/u.exec(eventName);
				const deliveryCount = Number(match?.[1]);
				eventValues.set(eventName, { preprocessJobId: "preprocess-1", deliveryCount });
			}
			return { eventName, payload: eventValues.get(eventName) as TPayload };
		},
	};
	return { context, checkpoints, sleeps, waitedEvents };
}

/** Returns the server and Kubernetes ports for one claimed PDF preprocessing task. */
function _Options(overrides: Partial<ArtifactPreprocessHandlerOptions> = {})
{
	const authority = {
		claimForTask: vi.fn().mockResolvedValue(_Record(1)),
		bindWorkload: vi.fn().mockResolvedValue("bound"),
		bindFirstPod: vi.fn().mockResolvedValue("bound"),
		loadOutcome: vi.fn().mockResolvedValue(_Completed(1)),
		complete: vi.fn().mockResolvedValue("completed"),
	};
	const kubernetes = {
		ensureSuspendedJob: vi.fn().mockResolvedValue({ metadata: { uid: "job-uid-1" } }),
		releaseJob: vi.fn().mockResolvedValue({ metadata: { uid: "job-uid-1" } }),
		findFirstPod: vi.fn().mockResolvedValue({ metadata: { uid: "pod-uid-1" } }),
		deleteJob: vi.fn().mockResolvedValue(undefined),
	};
	return {
		options: { authority, kubernetes, profile: _Profile(), podWaitMilliseconds: 100, ...overrides } satisfies ArtifactPreprocessHandlerOptions,
		authority,
		kubernetes,
	};
}

describe("artifact preprocessing workflow handler", function _DescribeArtifactPreprocessHandler()
{
	it("binds one suspended Job and its first Pod before cleanup follows persisted completion", async function _BindsJobAndPod()
	{
		const { options, authority, kubernetes } = _Options();
		const { context, checkpoints, waitedEvents } = _Context();
		expect(__CreateArtifactPreprocessHandler(options)).toMatchObject(ArtifactPreprocessTaskDeclaration);

		const result = await __CreateArtifactPreprocessHandler(options).run(context as never, { siloId: "silo-1", preprocessJobId: "preprocess-1" });

		expect(result).toEqual({ preprocessJobId: "preprocess-1", completionDigest: `sha256:${"c".repeat(64)}` });
		expect(checkpoints).toEqual(["delivery-1:claim-preprocess", "delivery-1:ensure-suspended-job", "delivery-1:bind-workload", "delivery-1:release-job", "delivery-1:observe-first-pod", "delivery-1:bind-first-pod", "delivery-1:load-preprocess-outcome", "delivery-1:complete-preprocess", "delivery-1:delete-outcome-job"]);
		expect(waitedEvents).toEqual([__ArtifactPreprocessOutcomeEventName(1)]);
		expect(authority.bindWorkload).toHaveBeenCalledWith("preprocess-1", context.task, expect.objectContaining({ bootstrapReference: expect.any(String), namespace: "opencrane-artifact-preprocessor", binding: expect.objectContaining({ claimId: "claim-1", workloadUid: "job-uid-1" }) }));
		expect(kubernetes.deleteJob).toHaveBeenCalledWith(expect.any(Object), "job-uid-1");
	});

	it("uses separate checkpoints, event names, and UIDs for the next delivery after a retryable outcome", async function _RunsNextDelivery()
	{
		const { options, authority, kubernetes } = _Options();
		authority.claimForTask.mockResolvedValueOnce(_Record(1)).mockResolvedValueOnce(_Record(2));
		authority.loadOutcome.mockResolvedValueOnce({ kind: ArtifactPreprocessOutcomeKinds.RetryableFailed, preprocessJobId: "preprocess-1", deliveryCount: 1, retryAt: new Date(0).toISOString() }).mockResolvedValueOnce(_Completed(2));
		kubernetes.ensureSuspendedJob.mockResolvedValueOnce({ metadata: { uid: "job-uid-1" } }).mockResolvedValueOnce({ metadata: { uid: "job-uid-2" } });
		kubernetes.findFirstPod.mockResolvedValueOnce({ metadata: { uid: "pod-uid-1" } }).mockResolvedValueOnce({ metadata: { uid: "pod-uid-2" } });
		const { context, checkpoints, sleeps, waitedEvents } = _Context();

		await expect(__CreateArtifactPreprocessHandler(options).run(context as never, { siloId: "silo-1", preprocessJobId: "preprocess-1" })).resolves.toEqual({ preprocessJobId: "preprocess-1", completionDigest: `sha256:${"c".repeat(64)}` });

		expect(authority.claimForTask).toHaveBeenCalledTimes(2);
		expect(checkpoints).toContain("delivery-2:claim-preprocess");
		expect(waitedEvents).toEqual([__ArtifactPreprocessOutcomeEventName(1), __ArtifactPreprocessOutcomeEventName(2)]);
		expect(kubernetes.deleteJob).toHaveBeenNthCalledWith(1, expect.any(Object), "job-uid-1");
		expect(kubernetes.deleteJob).toHaveBeenNthCalledWith(2, expect.any(Object), "job-uid-2");
		expect(sleeps).toContainEqual({ instant: new Date(0), stepName: "delivery-1:wait-for-retry" });
	});

	it("replays ambiguous completed cleanup against the same UID without claiming another delivery", async function _ReplaysCompletedDelete()
	{
		const { options, authority, kubernetes } = _Options();
		kubernetes.deleteJob.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce(undefined);
		const { context } = _Context();
		const handler = __CreateArtifactPreprocessHandler(options);

		await expect(handler.run(context as never, { siloId: "silo-1", preprocessJobId: "preprocess-1" })).rejects.toBeInstanceOf(WorkflowTaskRetryableError);
		await expect(handler.run(context as never, { siloId: "silo-1", preprocessJobId: "preprocess-1" })).resolves.toEqual({ preprocessJobId: "preprocess-1", completionDigest: `sha256:${"c".repeat(64)}` });

		expect(authority.claimForTask).toHaveBeenCalledOnce();
		expect(kubernetes.findFirstPod).toHaveBeenCalledOnce();
		expect(kubernetes.deleteJob).toHaveBeenCalledTimes(2);
		expect(kubernetes.deleteJob).toHaveBeenNthCalledWith(2, expect.any(Object), "job-uid-1");
	});

	it("replays persisted cleanup after the original workload claim expires", async function _ReplaysExpiredCleanup()
	{
		const now = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(now);
		const { options, authority, kubernetes } = _Options();
		const record = _Record(1);
		authority.claimForTask.mockResolvedValue({ ...record, claim: { ...record.claim, claimedAt: new Date(now).toISOString(), expiresAt: new Date(now + 1_000).toISOString() } });
		kubernetes.deleteJob.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce(undefined);
		const { context } = _Context();
		const handler = __CreateArtifactPreprocessHandler(options);

		await expect(handler.run(context as never, { siloId: "silo-1", preprocessJobId: "preprocess-1" })).rejects.toBeInstanceOf(WorkflowTaskRetryableError);
		clock.mockReturnValue(now + 2_000);
		await expect(handler.run(context as never, { siloId: "silo-1", preprocessJobId: "preprocess-1" })).resolves.toEqual({ preprocessJobId: "preprocess-1", completionDigest: `sha256:${"c".repeat(64)}` });

		expect(authority.claimForTask).toHaveBeenCalledOnce();
		expect(kubernetes.deleteJob).toHaveBeenCalledTimes(2);
		clock.mockRestore();
	});

	it("replays ambiguous terminal cleanup before preserving the terminal outcome", async function _ReplaysTerminalDelete()
	{
		const { options, authority, kubernetes } = _Options();
		authority.loadOutcome.mockResolvedValue({ kind: ArtifactPreprocessOutcomeKinds.TerminalFailed, preprocessJobId: "preprocess-1", deliveryCount: 1 });
		kubernetes.deleteJob.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce(undefined);
		const { context } = _Context();
		const handler = __CreateArtifactPreprocessHandler(options);

		await expect(handler.run(context as never, { siloId: "silo-1", preprocessJobId: "preprocess-1" })).rejects.toBeInstanceOf(WorkflowTaskRetryableError);
		await expect(handler.run(context as never, { siloId: "silo-1", preprocessJobId: "preprocess-1" })).rejects.toBeInstanceOf(WorkflowTaskTerminalError);

		expect(authority.claimForTask).toHaveBeenCalledOnce();
		expect(kubernetes.deleteJob).toHaveBeenCalledTimes(2);
	});

	it("leaves the Job when controller observation is ambiguous", async function _LeavesAmbiguousObservation()
	{
		const { options, kubernetes } = _Options();
		kubernetes.findFirstPod.mockRejectedValue(new Error("Kubernetes timeout"));
		const { context } = _Context();

		await expect(__CreateArtifactPreprocessHandler(options).run(context as never, { siloId: "silo-1", preprocessJobId: "preprocess-1" })).rejects.toBeInstanceOf(WorkflowTaskRetryableError);

		expect(kubernetes.deleteJob).not.toHaveBeenCalled();
	});

	it("does not claim cleanup after raw workflow cancellation", async function _LeavesCancelledTask()
	{
		const { options, kubernetes } = _Options();
		const { context } = _Context();
		context.waitForEvent = vi.fn().mockRejectedValue(new WorkflowTaskCancelledError("task-1"));

		await expect(__CreateArtifactPreprocessHandler(options).run(context as never, { siloId: "silo-1", preprocessJobId: "preprocess-1" })).rejects.toBeInstanceOf(WorkflowTaskCancelledError);

		expect(kubernetes.deleteJob).not.toHaveBeenCalled();
	});

	it("uses a named durable sleep while the released Job has no Pod", async function _SleepsForPod()
	{
		const { options, kubernetes } = _Options();
		kubernetes.findFirstPod.mockResolvedValueOnce(null).mockResolvedValueOnce({ metadata: { uid: "pod-uid-1" } });
		const { context, sleeps } = _Context();

		await __CreateArtifactPreprocessHandler(options).run(context as never, { siloId: "silo-1", preprocessJobId: "preprocess-1" });

		expect(sleeps[0]?.stepName).toBe("delivery-1:wait-for-pod-1");
		expect(kubernetes.findFirstPod).toHaveBeenCalledTimes(2);
	});
});
