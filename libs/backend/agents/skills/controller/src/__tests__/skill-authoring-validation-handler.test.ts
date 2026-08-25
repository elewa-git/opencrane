import { describe, expect, it, vi } from "vitest";

import { SkillAuthoringValidationTaskDeclaration } from "@opencrane/backend/agents/skills/workflows/contract";
import { SkillWorkloadKinds } from "@opencrane/backend/agents/skills/k8s-launcher";
import { WorkflowTaskRetryableError, type IWorkflowTaskEvent } from "@opencrane/backend/server/infra/workflows/contract";

import { __CreateSkillAuthoringValidationHandler } from "../skill-authoring-validation-handler";
import type { SkillAuthoringValidationHandlerOptions, SkillAuthoringValidationTaskContext } from "../skill-authoring-validation-handler.types";

/** Return the immutable authoring profile that the Kubernetes Job builder accepts. */
function _Profile()
{
	return {
		kind: SkillWorkloadKinds.Authoring,
		image: `ghcr.io/opencrane/skill-authoring@sha256:${"a".repeat(64)}`,
		imagePullPolicy: "IfNotPresent" as const,
		serverNamespace: "opencrane-server",
		namespace: "opencrane-skill-authoring",
		serviceAccountName: "skill-authoring-default",
		capabilityTokenAudience: "opencrane-skill-authoring",
		bootstrapUrl: "http://opencrane.opencrane.svc.cluster.local:8081/api/internal/agent-runtime",
		capabilityTokenPath: "/var/run/opencrane/tokens/capability.token",
		bootstrapReferencePath: "/var/run/opencrane/bootstrap/reference",
		scratchSize: "128Mi",
		activeDeadlineSeconds: 600,
		ttlSecondsAfterFinished: 0,
		resources: { requests: { cpu: "500m", memory: "3Gi" }, limits: { cpu: "2", memory: "4Gi" } },
	};
}

/** Build one task context that records checkpoints and returns a selected private completion event. */
function _Context(event: unknown)
{
	const checkpoints: string[] = [];
	const sleeps: Date[] = [];
	const context: SkillAuthoringValidationTaskContext = {
		task: { taskId: "task-1", taskName: "skills.authoring.validate/v1", idempotencyKey: "skill-validation:validation-1" },
		async checkpoint(step, operation)
		{
			checkpoints.push(step.stepName);
			return await operation();
		},
		async sleepUntil(instant)
		{
			sleeps.push(instant);
		},
		async waitForEvent<TPayload>(_eventName: string): Promise<IWorkflowTaskEvent<TPayload>>
		{
			return { eventName: "skill-authoring-completed", payload: event as TPayload };
		},
	};
	return { context, checkpoints, sleeps };
}

/** Build the ports that let one handler test control every server and Kubernetes result. */
function _Options(overrides: Partial<SkillAuthoringValidationHandlerOptions> = {})
{
	const job = { metadata: { uid: "job-uid-1" } };
	const pod = { metadata: { uid: "pod-uid-1" } };
	const authority = {
		claimForTask: vi.fn().mockResolvedValue({ validationId: "validation-1", siloId: "silo-1", jobId: "job-1", claim: { claimId: "claim-1", siloId: "silo-1", workloadClass: "skill-authoring-validation", profileName: "authoring", idempotencyKey: "validation-workload-key", executionReference: "validation-1", claimedAt: "2026-08-25T10:00:00.000Z", deliveryCount: 1, expiresAt: "2026-08-25T10:05:00.000Z" } }),
		bindWorkload: vi.fn().mockResolvedValue("bound"),
		bindFirstPod: vi.fn().mockResolvedValue("bound"),
		loadCompletion: vi.fn().mockResolvedValue({ validationId: "validation-1", completionDigest: `sha256:${"b".repeat(64)}` }),
		complete: vi.fn().mockResolvedValue("completed"),
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
		} satisfies SkillAuthoringValidationHandlerOptions,
		authority,
		kubernetes,
	};
}

describe("skill authoring validation workflow handler", function _DescribeSkillAuthoringValidationHandler()
{
	it("binds the Job and first Pod to one claim before waiting for a persisted completion inbox event", async function _RunsValidation()
	{
		const { options, authority, kubernetes } = _Options();
		const { context, checkpoints } = _Context({ validationId: "validation-1", completionDigest: `sha256:${"b".repeat(64)}` });
		expect(__CreateSkillAuthoringValidationHandler(options)).toMatchObject(SkillAuthoringValidationTaskDeclaration);

		const result = await __CreateSkillAuthoringValidationHandler(options).run(context as never, { siloId: "silo-1", validationId: "validation-1" });

		expect(result).toEqual({ validationId: "validation-1", completionDigest: `sha256:${"b".repeat(64)}` });
		expect(checkpoints).toEqual(["claim-validation", "ensure-suspended-job", "bind-workload", "release-job", "bind-first-pod", "load-completion-inbox", "complete-validation"]);
		expect(authority.bindWorkload).toHaveBeenCalledWith("validation-1", context.task, expect.objectContaining({ bootstrapReference: expect.any(String), namespace: "opencrane-skill-authoring", binding: expect.objectContaining({ claimId: "claim-1", workloadUid: "job-uid-1" }) }));
		expect(authority.bindFirstPod).toHaveBeenCalledWith("validation-1", context.task, { binding: expect.objectContaining({ claimId: "claim-1", workloadUid: "job-uid-1", firstPodUid: "pod-uid-1" }) });
		expect(authority.complete).toHaveBeenCalledWith("validation-1", { validationId: "validation-1", completionDigest: `sha256:${"b".repeat(64)}` }, context.task);
		expect(kubernetes.releaseJob).toHaveBeenCalledWith(expect.any(Object), "job-uid-1", "2026-08-25T10:05:00.000Z");
	});

	it("uses durable sleep instead of a controller poll loop while Kubernetes has not exposed the first Pod", async function _SleepsForPod()
	{
		const { options, kubernetes } = _Options();
		kubernetes.findFirstPod.mockResolvedValueOnce(null).mockResolvedValueOnce({ metadata: { uid: "pod-uid-1" } });
		const { context, sleeps } = _Context({ validationId: "validation-1", completionDigest: `sha256:${"b".repeat(64)}` });

		await __CreateSkillAuthoringValidationHandler(options).run(context as never, { siloId: "silo-1", validationId: "validation-1" });

		expect(sleeps).toHaveLength(1);
		expect(kubernetes.findFirstPod).toHaveBeenCalledTimes(2);
	});

	it("stops before Job release when the server rejects the workload claim fence", async function _StopsOnWorkloadConflict()
	{
		const { options, authority, kubernetes } = _Options();
		authority.bindWorkload.mockResolvedValue("conflict");
		const { context } = _Context({ validationId: "validation-1", completionDigest: `sha256:${"b".repeat(64)}` });

		await expect(__CreateSkillAuthoringValidationHandler(options).run(context as never, { siloId: "silo-1", validationId: "validation-1" })).rejects.toThrow(/workload claim no longer matches/);

		expect(kubernetes.releaseJob).not.toHaveBeenCalled();
	});

	it("uses the declaration retry policy when the controller cannot reach the server", async function _RetriesUnavailableServer()
	{
		const { options, authority } = _Options();
		authority.claimForTask.mockRejectedValue(new Error("temporary network failure"));
		const { context } = _Context({ validationId: "validation-1", completionDigest: `sha256:${"b".repeat(64)}` });

		await expect(__CreateSkillAuthoringValidationHandler(options).run(context as never, { siloId: "silo-1", validationId: "validation-1" })).rejects.toBeInstanceOf(WorkflowTaskRetryableError);
	});

	it("rejects a completion event for another validation before it can reach the server terminal writer", async function _RejectsWrongCompletion()
	{
		const { options, authority } = _Options();
		const { context } = _Context({ validationId: "validation-other", completionDigest: `sha256:${"b".repeat(64)}` });

		await expect(__CreateSkillAuthoringValidationHandler(options).run(context as never, { siloId: "silo-1", validationId: "validation-1" })).rejects.toThrow(/completion event does not match/);
		expect(authority.loadCompletion).not.toHaveBeenCalled();
		expect(authority.complete).not.toHaveBeenCalled();
	});
});
