import { describe, expect, it, vi } from "vitest";

import { SkillAuthoringValidationRecoveryReasons, SkillAuthoringValidationTaskDeclaration } from "@opencrane/backend/agents/skills/workflows/contract";

import { __CreateSkillAuthoringValidationHandler } from "../skill-authoring-validation-handler";
import type { SkillAuthoringValidationHandlerOptions, SkillAuthoringValidationTaskContext } from "../skill-authoring-validation-handler.types";

/** Return the immutable authoring profile that the Kubernetes Job builder accepts. */
function _Profile()
{
	return {
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

/** Build one task context that records named checkpoints and durable sleeps. */
function _Context()
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
	};
	return { context, checkpoints, sleeps };
}

/** Build a task context that persists only successful checkpoints across handler replays. */
function _ReplayContext()
{
	const checkpoints: string[] = [];
	const sleeps: Date[] = [];
	const saved = new Map<string, unknown>();
	const context: SkillAuthoringValidationTaskContext = {
		task: { taskId: "task-1", taskName: "skills.authoring.validate/v1", idempotencyKey: "skill-validation:validation-1" },
		async checkpoint(step, operation)
		{
			checkpoints.push(step.stepName);
			if (saved.has(step.stepName))
			{
				return saved.get(step.stepName) as never;
			}
			const result = await operation();
			saved.set(step.stepName, result);
			return result;
		},
		async sleepUntil(instant)
		{
			sleeps.push(instant);
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
		claimForTask: vi.fn().mockResolvedValue({ validationId: "validation-1", siloId: "silo-1", jobId: "job-1", claim: { claimId: "claim-1", siloId: "silo-1", workloadClass: "skill-authoring-validation", profileName: "authoring", idempotencyKey: "validation-workload-key", executionReference: "validation-1", claimedAt: "2026-08-25T10:00:00.000Z", deliveryCount: 1, expiresAt: "2099-08-25T10:05:00.000Z" } }),
		loadCurrentStatus: vi.fn().mockResolvedValue("active"),
		failExpiredBeforeWorkload: vi.fn().mockResolvedValue("failed"),
		bindWorkload: vi.fn().mockResolvedValue("bound"),
		authorizeRelease: vi.fn().mockResolvedValue({ outcome: "authorized", releaseLifetimeSeconds: 300 }),
		bindFirstPod: vi.fn().mockResolvedValue("bound"),
		loadCurrentCompletion: vi.fn().mockResolvedValue({ validationId: "validation-1", completionDigest: `sha256:${"b".repeat(64)}` }),
		failUnreported: vi.fn().mockResolvedValue("failed"),
		complete: vi.fn().mockResolvedValue("completed"),
	};
	const kubernetes = {
		ensureSuspendedJob: vi.fn().mockResolvedValue(job),
		releaseJob: vi.fn().mockResolvedValue(job),
		findFirstPod: vi.fn().mockResolvedValue(pod),
		observeJob: vi.fn().mockResolvedValue("running"),
		deleteJob: vi.fn().mockResolvedValue(undefined),
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
	it("binds the Job and first Pod to one claim before reading the persisted completion inbox", async function _RunsValidation()
	{
		const { options, authority, kubernetes } = _Options();
		const { context, checkpoints } = _Context();
		expect(__CreateSkillAuthoringValidationHandler(options)).toMatchObject(SkillAuthoringValidationTaskDeclaration);

		const result = await __CreateSkillAuthoringValidationHandler(options).run(context as never, { siloId: "silo-1", validationId: "validation-1" });

		expect(result).toEqual({ validationId: "validation-1", completionDigest: `sha256:${"b".repeat(64)}` });
		expect(checkpoints).toEqual(["delivery-1:claim-validation", "delivery-1:ensure-suspended-job", "delivery-1:bind-workload", "delivery-1:release-job", "delivery-1:find-first-pod-1", "delivery-1:bind-first-pod", "delivery-1:recover-completion-1", "delivery-1:complete-validation", "delivery-1:delete-completed-job"]);
		expect(authority.bindWorkload).toHaveBeenCalledWith("validation-1", context.task, expect.objectContaining({ bootstrapReference: expect.any(String), namespace: "opencrane-skill-authoring", binding: expect.objectContaining({ claimId: "claim-1", workloadUid: "job-uid-1" }) }));
		expect(authority.bindFirstPod).toHaveBeenCalledWith("validation-1", context.task, { binding: expect.objectContaining({ claimId: "claim-1", workloadUid: "job-uid-1", firstPodUid: "pod-uid-1" }) });
		expect(authority.complete).toHaveBeenCalledWith("validation-1", { validationId: "validation-1", completionDigest: `sha256:${"b".repeat(64)}` }, context.task);
		expect(kubernetes.releaseJob).toHaveBeenCalledTimes(1);
		expect(kubernetes.releaseJob).toHaveBeenCalledWith(expect.any(Object), "job-uid-1", { lifetimeSeconds: 300 });
		expect(kubernetes.deleteJob).toHaveBeenCalledTimes(1);
	});

	it("uses durable sleep instead of a controller poll loop while Kubernetes has not exposed the first Pod", async function _SleepsForPod()
	{
		const { options, kubernetes } = _Options();
		kubernetes.findFirstPod.mockResolvedValueOnce(null).mockResolvedValueOnce({ metadata: { uid: "pod-uid-1" } });
		const { context, sleeps } = _Context();

		await __CreateSkillAuthoringValidationHandler(options).run(context as never, { siloId: "silo-1", validationId: "validation-1" });

		expect(sleeps).toHaveLength(1);
		expect(kubernetes.findFirstPod).toHaveBeenCalledTimes(2);
	});

	it("stops before Job release when the server rejects the workload claim fence", async function _StopsOnWorkloadConflict()
	{
		const { options, authority, kubernetes } = _Options();
		authority.bindWorkload.mockResolvedValue("conflict");
		const { context } = _Context();

		await expect(__CreateSkillAuthoringValidationHandler(options).run(context as never, { siloId: "silo-1", validationId: "validation-1" })).rejects.toThrow(/workload claim no longer matches/);

		expect(kubernetes.releaseJob).not.toHaveBeenCalled();
	});

	it("adopts a binding whose committed response was lost before expiring the exact bound Job", async function _RecoversAmbiguousWorkloadBind()
	{
		const now = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(now);
		const { options, authority, kubernetes } = _Options();
		authority.claimForTask.mockResolvedValue({ validationId: "validation-1", siloId: "silo-1", jobId: "job-1", claim: { claimId: "claim-1", siloId: "silo-1", workloadClass: "skill-authoring-validation", profileName: "authoring", idempotencyKey: "validation-workload-key", executionReference: "validation-1", claimedAt: new Date(now).toISOString(), deliveryCount: 1, expiresAt: new Date(now + 1_000).toISOString() } });
		authority.bindWorkload.mockRejectedValueOnce(new Error("binding response lost")).mockResolvedValue("idempotent");
		authority.authorizeRelease.mockResolvedValue("expired");
		const { context } = _ReplayContext();
		const handler = __CreateSkillAuthoringValidationHandler(options);

		await expect(handler.run(context as never, { siloId: "silo-1", validationId: "validation-1" })).rejects.toThrow(/response lost/);
		clock.mockReturnValue(now + 2_000);
		await expect(handler.run(context as never, { siloId: "silo-1", validationId: "validation-1" })).rejects.toThrow(/ended without a worker completion/);

		expect(authority.claimForTask).toHaveBeenCalledTimes(1);
		expect(authority.bindWorkload).toHaveBeenCalledTimes(2);
		expect(authority.failUnreported).toHaveBeenCalledWith("validation-1", context.task, expect.objectContaining({ workloadUid: "job-uid-1" }), SkillAuthoringValidationRecoveryReasons.ClaimExpiredWithoutWorker);
		expect(authority.failExpiredBeforeWorkload).not.toHaveBeenCalled();
		expect(kubernetes.ensureSuspendedJob).toHaveBeenCalledTimes(1);
		expect(kubernetes.releaseJob).not.toHaveBeenCalled();
		expect(kubernetes.deleteJob).toHaveBeenCalledTimes(1);
		clock.mockRestore();
	});

	it("does not create Kubernetes work after the validation was cancelled", async function _StopsAfterCancellation()
	{
		const { options, authority, kubernetes } = _Options();
		authority.claimForTask.mockResolvedValue(null);
		const { context } = _Context();

		await expect(__CreateSkillAuthoringValidationHandler(options).run(context as never, { siloId: "silo-1", validationId: "validation-1" })).rejects.toThrow(/no longer available/);
		expect(kubernetes.ensureSuspendedJob).not.toHaveBeenCalled();
		expect(kubernetes.releaseJob).not.toHaveBeenCalled();
		expect(kubernetes.deleteJob).not.toHaveBeenCalled();
	});

	it("deletes one locally created suspended Job when cancellation wins workload binding", async function _CleansCancelledWorkloadBindRace()
	{
		const { options, authority, kubernetes } = _Options();
		authority.bindWorkload.mockResolvedValue("conflict");
		authority.loadCurrentStatus.mockResolvedValue("cancelled");
		const { context } = _ReplayContext();
		const handler = __CreateSkillAuthoringValidationHandler(options);

		await expect(handler.run(context as never, { siloId: "silo-1", validationId: "validation-1" })).rejects.toThrow(/no longer active/);
		await expect(handler.run(context as never, { siloId: "silo-1", validationId: "validation-1" })).rejects.toThrow(/no longer active/);
		expect(kubernetes.ensureSuspendedJob).toHaveBeenCalledTimes(1);
		expect(kubernetes.releaseJob).not.toHaveBeenCalled();
		expect(kubernetes.deleteJob).toHaveBeenCalledTimes(1);
		expect(kubernetes.deleteJob).toHaveBeenCalledWith(expect.any(Object), "job-uid-1");
	});

	it("deletes the bound Job when cancellation wins first-Pod binding", async function _CleansCancelledPodBindRace()
	{
		const { options, authority, kubernetes } = _Options();
		authority.bindFirstPod.mockResolvedValue("conflict");
		authority.loadCurrentStatus.mockResolvedValueOnce("active").mockResolvedValue("cancelled");
		const { context } = _ReplayContext();
		const handler = __CreateSkillAuthoringValidationHandler(options);

		await expect(handler.run(context as never, { siloId: "silo-1", validationId: "validation-1" })).rejects.toThrow(/no longer active/);
		await expect(handler.run(context as never, { siloId: "silo-1", validationId: "validation-1" })).rejects.toThrow(/no longer active/);
		expect(kubernetes.ensureSuspendedJob).toHaveBeenCalledTimes(1);
		expect(kubernetes.releaseJob).toHaveBeenCalledTimes(1);
		expect(kubernetes.findFirstPod).toHaveBeenCalledTimes(1);
		expect(kubernetes.deleteJob).toHaveBeenCalledTimes(1);
		expect(kubernetes.deleteJob).toHaveBeenCalledWith(expect.any(Object), "job-uid-1");
	});

	it("deletes the bound Job once when cancellation wins a recovery compare-and-set", async function _CleansCancelledRecoveryRace()
	{
		const { options, authority, kubernetes } = _Options();
		authority.loadCurrentCompletion.mockResolvedValue(null);
		authority.loadCurrentStatus.mockResolvedValueOnce("active").mockResolvedValueOnce("active").mockResolvedValue("cancelled");
		authority.failUnreported.mockResolvedValue("conflict");
		kubernetes.observeJob.mockResolvedValue("terminal");
		const { context } = _ReplayContext();
		const handler = __CreateSkillAuthoringValidationHandler(options);

		await expect(handler.run(context as never, { siloId: "silo-1", validationId: "validation-1" })).rejects.toThrow(/no longer active/);
		await expect(handler.run(context as never, { siloId: "silo-1", validationId: "validation-1" })).rejects.toThrow(/no longer active/);
		expect(kubernetes.ensureSuspendedJob).toHaveBeenCalledTimes(1);
		expect(kubernetes.releaseJob).toHaveBeenCalledTimes(1);
		expect(kubernetes.deleteJob).toHaveBeenCalledTimes(1);
		expect(kubernetes.deleteJob).toHaveBeenCalledWith(expect.any(Object), "job-uid-1");
	});

	it("records and cleans up a terminal Job that produced no completion", async function _RecoversTerminalJob()
	{
		const { options, authority, kubernetes } = _Options();
		authority.loadCurrentCompletion.mockResolvedValue(null);
		kubernetes.observeJob.mockResolvedValue("terminal");
		const { context } = _Context();

		await expect(__CreateSkillAuthoringValidationHandler(options).run(context as never, { siloId: "silo-1", validationId: "validation-1" })).rejects.toThrow(/ended without a worker completion/);
		expect(authority.failUnreported).toHaveBeenCalledWith("validation-1", context.task, expect.objectContaining({ workloadUid: "job-uid-1", firstPodUid: "pod-uid-1" }), "job_terminal_without_completion");
		expect(authority.complete).not.toHaveBeenCalled();
		expect(kubernetes.deleteJob).toHaveBeenCalledTimes(1);
	});

	it("lets a completion committed during terminal recovery win the database race", async function _CompletionWinsRecovery()
	{
		const { options, authority, kubernetes } = _Options();
		const completion = { validationId: "validation-1", completionDigest: `sha256:${"b".repeat(64)}` };
		authority.loadCurrentCompletion.mockResolvedValueOnce(null).mockResolvedValueOnce(completion);
		authority.failUnreported.mockResolvedValue("conflict");
		kubernetes.observeJob.mockResolvedValue("terminal");
		const { context } = _Context();

		await expect(__CreateSkillAuthoringValidationHandler(options).run(context as never, { siloId: "silo-1", validationId: "validation-1" })).resolves.toEqual({ validationId: "validation-1", completionDigest: completion.completionDigest });

		expect(authority.complete).toHaveBeenCalledWith("validation-1", completion, context.task);
		expect(kubernetes.deleteJob).toHaveBeenCalledTimes(1);
	});

	it("does not delete a Job after losing the recovery compare-and-set", async function _LeavesJobAfterRecoveryConflict()
	{
		const { options, authority, kubernetes } = _Options();
		authority.loadCurrentCompletion.mockResolvedValue(null);
		authority.failUnreported.mockResolvedValue("conflict");
		kubernetes.observeJob.mockResolvedValue("terminal");
		const { context } = _Context();

		await expect(__CreateSkillAuthoringValidationHandler(options).run(context as never, { siloId: "silo-1", validationId: "validation-1" })).rejects.toThrow(/recovery no longer matches/);

		expect(kubernetes.deleteJob).not.toHaveBeenCalled();
	});

	it("renews an expired saved claim with a new delivery cycle after replay", async function _RenewsExpiredClaim()
	{
		const now = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(now);
		const { options, authority, kubernetes } = _Options();
		const first = await authority.claimForTask.mock.results.at(-1)?.value ?? await authority.claimForTask("validation-1", { taskId: "unused", taskName: "unused", idempotencyKey: "unused" });
		const record = first ?? { validationId: "validation-1", siloId: "silo-1", jobId: "job-1", claim: {} };
		const firstDelivery = { ...record, claim: { ...record.claim, claimId: "claim-1", claimedAt: new Date(now).toISOString(), deliveryCount: 1, expiresAt: new Date(now + 1_000).toISOString() } };
		const secondDelivery = { ...record, claim: { ...record.claim, claimId: "claim-1", claimedAt: new Date(now + 2_000).toISOString(), deliveryCount: 2, expiresAt: new Date(now + 302_000).toISOString() } };
		authority.claimForTask.mockReset().mockResolvedValueOnce(firstDelivery).mockResolvedValue(secondDelivery);
		authority.bindWorkload.mockResolvedValueOnce("expired").mockResolvedValue("bound");
		kubernetes.ensureSuspendedJob.mockRejectedValueOnce(new Error("Kubernetes unavailable")).mockResolvedValueOnce({ metadata: { uid: "job-uid-1" } });
		const { context, checkpoints } = _ReplayContext();
		const handler = __CreateSkillAuthoringValidationHandler(options);

		await expect(handler.run(context as never, { siloId: "silo-1", validationId: "validation-1" })).rejects.toThrow(/Kubernetes unavailable/);
		clock.mockReturnValue(now + 2_000);
		await expect(handler.run(context as never, { siloId: "silo-1", validationId: "validation-1" })).resolves.toMatchObject({ validationId: "validation-1" });

		expect(authority.claimForTask).toHaveBeenCalledTimes(2);
		expect(checkpoints).toContain("delivery-2:claim-validation");
		clock.mockRestore();
	});

	it("deletes a suspended Job whose claim expires before database binding, then renews", async function _DeletesUnboundJobBeforeRenewal()
	{
		const now = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(now);
		const { options, authority, kubernetes } = _Options();
		const base = { validationId: "validation-1", siloId: "silo-1", jobId: "job-1", claim: { claimId: "claim-1", siloId: "silo-1", workloadClass: "skill-authoring-validation", profileName: "authoring", idempotencyKey: "validation-workload-key", executionReference: "validation-1" } };
		const secondDelivery = { ...base, claim: { ...base.claim, claimedAt: new Date(now + 2_000).toISOString(), deliveryCount: 2, expiresAt: new Date(now + 302_000).toISOString() } };
		authority.claimForTask.mockReset()
			.mockResolvedValueOnce({ ...base, claim: { ...base.claim, claimedAt: new Date(now).toISOString(), deliveryCount: 1, expiresAt: new Date(now + 1_000).toISOString() } })
			.mockResolvedValue(secondDelivery);
		kubernetes.ensureSuspendedJob.mockImplementationOnce(async function _ExpireAfterEnsure()
		{
			clock.mockReturnValue(now + 2_000);
			return { metadata: { uid: "job-uid-1" } };
		});
		authority.bindWorkload.mockResolvedValueOnce("expired").mockResolvedValue("bound");
		const { context } = _Context();

		await expect(__CreateSkillAuthoringValidationHandler(options).run(context as never, { siloId: "silo-1", validationId: "validation-1" })).resolves.toMatchObject({ validationId: "validation-1" });

		expect(kubernetes.deleteJob).toHaveBeenNthCalledWith(1, expect.any(Object), "job-uid-1");
		expect(authority.claimForTask).toHaveBeenCalledTimes(2);
		clock.mockRestore();
	});

	it("fails the product validation when its final unbound claim expires", async function _FailsFinalUnboundExpiry()
	{
		const now = Date.now();
		const { options, authority, kubernetes } = _Options();
		const finalClaim = { claimId: "claim-1", siloId: "silo-1", workloadClass: "skill-authoring-validation", profileName: "authoring", idempotencyKey: "validation-workload-key", executionReference: "validation-1", claimedAt: new Date(now - 301_000).toISOString(), deliveryCount: 3, expiresAt: new Date(now - 1_000).toISOString() };
		authority.claimForTask.mockResolvedValue({ validationId: "validation-1", siloId: "silo-1", jobId: "job-1", claim: finalClaim });
		authority.bindWorkload.mockResolvedValue("expired");
		const { context } = _Context();

		await expect(__CreateSkillAuthoringValidationHandler(options).run(context as never, { siloId: "silo-1", validationId: "validation-1" })).rejects.toThrow(/expired before a workload was bound/);

		expect(authority.failExpiredBeforeWorkload).toHaveBeenCalledWith("validation-1", context.task, finalClaim);
		expect(kubernetes.ensureSuspendedJob).toHaveBeenCalledTimes(1);
		expect(kubernetes.deleteJob).toHaveBeenCalledTimes(1);
	});

	it("waits when PostgreSQL has not reached the final unbound expiry", async function _WaitsForDatabaseUnboundExpiry()
	{
		const now = Date.now();
		const { options, authority, kubernetes } = _Options();
		const finalClaim = { claimId: "claim-1", siloId: "silo-1", workloadClass: "skill-authoring-validation", profileName: "authoring", idempotencyKey: "validation-workload-key", executionReference: "validation-1", claimedAt: new Date(now - 301_000).toISOString(), deliveryCount: 3, expiresAt: new Date(now - 1_000).toISOString() };
		authority.claimForTask.mockResolvedValue({ validationId: "validation-1", siloId: "silo-1", jobId: "job-1", claim: finalClaim });
		authority.bindWorkload.mockResolvedValue("expired");
		authority.failExpiredBeforeWorkload.mockResolvedValueOnce("not_expired").mockResolvedValue("failed");
		const { context, sleeps } = _ReplayContext();

		await expect(__CreateSkillAuthoringValidationHandler(options).run(context as never, { siloId: "silo-1", validationId: "validation-1" })).rejects.toThrow(/expired before a workload was bound/);

		expect(authority.failExpiredBeforeWorkload).toHaveBeenCalledTimes(2);
		expect(sleeps).toHaveLength(1);
		expect(kubernetes.ensureSuspendedJob).toHaveBeenCalledTimes(1);
		expect(kubernetes.deleteJob).toHaveBeenCalledTimes(1);
	});

	it("continues one first delivery when only the controller clock is ahead", async function _UsesDatabaseTimeForFirstDelivery()
	{
		const now = Date.now();
		const { options, authority, kubernetes } = _Options();
		authority.claimForTask.mockResolvedValue({ validationId: "validation-1", siloId: "silo-1", jobId: "job-1", claim: { claimId: "claim-1", siloId: "silo-1", workloadClass: "skill-authoring-validation", profileName: "authoring", idempotencyKey: "validation-workload-key", executionReference: "validation-1", claimedAt: new Date(now - 301_000).toISOString(), deliveryCount: 1, expiresAt: new Date(now - 1_000).toISOString() } });
		const { context } = _ReplayContext();

		await expect(__CreateSkillAuthoringValidationHandler(options).run(context as never, { siloId: "silo-1", validationId: "validation-1" })).resolves.toMatchObject({ validationId: "validation-1" });

		expect(authority.claimForTask).toHaveBeenCalledTimes(1);
		expect(authority.bindWorkload).toHaveBeenCalledTimes(1);
		expect(authority.authorizeRelease).toHaveBeenCalledTimes(1);
		expect(authority.failExpiredBeforeWorkload).not.toHaveBeenCalled();
		expect(authority.failUnreported).not.toHaveBeenCalled();
		expect(kubernetes.ensureSuspendedJob).toHaveBeenCalledTimes(1);
		expect(kubernetes.releaseJob).toHaveBeenCalledTimes(1);
		expect(kubernetes.deleteJob).toHaveBeenCalledTimes(1);
	});

	it("does not release a bound Job after database expiry when the controller clock is behind", async function _UsesDatabaseTimeBeforeRelease()
	{
		const { options, authority, kubernetes } = _Options();
		authority.authorizeRelease.mockResolvedValue("expired");
		const { context } = _ReplayContext();

		await expect(__CreateSkillAuthoringValidationHandler(options).run(context as never, { siloId: "silo-1", validationId: "validation-1" })).rejects.toThrow(/ended without a worker completion/);

		expect(authority.bindWorkload).toHaveBeenCalledTimes(1);
		expect(authority.authorizeRelease).toHaveBeenCalledTimes(1);
		expect(authority.failUnreported).toHaveBeenCalledWith("validation-1", context.task, expect.objectContaining({ workloadUid: "job-uid-1" }), SkillAuthoringValidationRecoveryReasons.ClaimExpiredWithoutWorker);
		expect(kubernetes.releaseJob).not.toHaveBeenCalled();
		expect(kubernetes.deleteJob).toHaveBeenCalledTimes(1);
	});

	it("fails and deletes a bound released Job instead of renewing its expired claim", async function _FailsBoundExpiry()
	{
		const now = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(now);
		const { options, authority, kubernetes } = _Options();
		authority.claimForTask.mockResolvedValue({ validationId: "validation-1", siloId: "silo-1", jobId: "job-1", claim: { claimId: "claim-1", siloId: "silo-1", workloadClass: "skill-authoring-validation", profileName: "authoring", idempotencyKey: "validation-workload-key", executionReference: "validation-1", claimedAt: new Date(now).toISOString(), deliveryCount: 1, expiresAt: new Date(now + 1_000).toISOString() } });
		kubernetes.releaseJob.mockImplementation(async function _ExpireAfterRelease()
		{
			clock.mockReturnValue(now + 2_000);
			return { metadata: { uid: "job-uid-1" } };
		});
		kubernetes.findFirstPod.mockResolvedValue(null);
		const { context } = _Context();

		await expect(__CreateSkillAuthoringValidationHandler(options).run(context as never, { siloId: "silo-1", validationId: "validation-1" })).rejects.toThrow(/ended without a worker completion/);

		expect(authority.claimForTask).toHaveBeenCalledTimes(1);
		expect(authority.failUnreported).toHaveBeenCalledWith("validation-1", context.task, expect.objectContaining({ workloadUid: "job-uid-1" }), SkillAuthoringValidationRecoveryReasons.ClaimExpiredWithoutWorker);
		expect(kubernetes.deleteJob).toHaveBeenCalledWith(expect.any(Object), "job-uid-1");
		clock.mockRestore();
	});

	it("waits when PostgreSQL has not reached a bound claim expiry", async function _WaitsForDatabaseBoundExpiry()
	{
		const now = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(now);
		const { options, authority, kubernetes } = _Options();
		authority.claimForTask.mockResolvedValue({ validationId: "validation-1", siloId: "silo-1", jobId: "job-1", claim: { claimId: "claim-1", siloId: "silo-1", workloadClass: "skill-authoring-validation", profileName: "authoring", idempotencyKey: "validation-workload-key", executionReference: "validation-1", claimedAt: new Date(now).toISOString(), deliveryCount: 1, expiresAt: new Date(now + 1_000).toISOString() } });
		authority.failUnreported.mockResolvedValueOnce("not_expired").mockResolvedValue("failed");
		kubernetes.releaseJob.mockImplementation(async function _ExpireAfterRelease()
		{
			clock.mockReturnValue(now + 2_000);
			return { metadata: { uid: "job-uid-1" } };
		});
		kubernetes.findFirstPod.mockResolvedValue(null);
		const { context, sleeps } = _ReplayContext();

		await expect(__CreateSkillAuthoringValidationHandler(options).run(context as never, { siloId: "silo-1", validationId: "validation-1" })).rejects.toThrow(/ended without a worker completion/);

		expect(authority.failUnreported).toHaveBeenCalledTimes(2);
		expect(sleeps).toHaveLength(1);
		expect(kubernetes.releaseJob).toHaveBeenCalledTimes(1);
		expect(kubernetes.deleteJob).toHaveBeenCalledTimes(1);
		clock.mockRestore();
	});

	it("records a missing Job before any Pod binding and cleans only its bound UID", async function _RecoversMissingJobBeforePod()
	{
		const { options, authority, kubernetes } = _Options();
		kubernetes.findFirstPod.mockResolvedValue(null);
		kubernetes.observeJob.mockResolvedValue("missing");
		const { context } = _Context();

		await expect(__CreateSkillAuthoringValidationHandler(options).run(context as never, { siloId: "silo-1", validationId: "validation-1" })).rejects.toThrow(/ended without a worker completion/);

		expect(authority.failUnreported).toHaveBeenCalledWith("validation-1", context.task, expect.not.objectContaining({ firstPodUid: expect.anything() }), "job_missing_without_completion");
		expect(kubernetes.deleteJob).toHaveBeenCalledWith(expect.any(Object), "job-uid-1");
	});

	it("rechecks a not-ready completion after a durable recovery heartbeat", async function _WaitsForCompletion()
	{
		const { options, authority, kubernetes } = _Options();
		authority.loadCurrentCompletion.mockResolvedValueOnce(null).mockResolvedValueOnce({ validationId: "validation-1", completionDigest: `sha256:${"b".repeat(64)}` });
		kubernetes.observeJob.mockResolvedValue("running");
		const { context, sleeps } = _ReplayContext();

		await __CreateSkillAuthoringValidationHandler(options).run(context as never, { siloId: "silo-1", validationId: "validation-1" });

		expect(sleeps).toHaveLength(1);
		expect(authority.loadCurrentCompletion).toHaveBeenCalledTimes(2);
	});

	it("reuses completed named steps when Absurd replays the task", async function _ReplaysNamedSteps()
	{
		const { options, authority, kubernetes } = _Options();
		const { context } = _ReplayContext();
		const handler = __CreateSkillAuthoringValidationHandler(options);

		await handler.run(context as never, { siloId: "silo-1", validationId: "validation-1" });
		await handler.run(context as never, { siloId: "silo-1", validationId: "validation-1" });

		expect(authority.claimForTask).toHaveBeenCalledTimes(1);
		expect(kubernetes.ensureSuspendedJob).toHaveBeenCalledTimes(1);
		expect(kubernetes.releaseJob).toHaveBeenCalledTimes(1);
		expect(kubernetes.deleteJob).toHaveBeenCalledTimes(1);
	});
});
