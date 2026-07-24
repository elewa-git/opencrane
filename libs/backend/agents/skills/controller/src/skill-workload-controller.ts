import { createHash } from "node:crypto";

import { __BuildGovernedSkillWorkloadJob, type SkillWorkloadJobProfile } from "@opencrane/backend/agents/skills/k8s-launcher";
import { ___DoWithTrace } from "@opencrane/observability";

import type { SkillWorkloadControllerOptions, SkillWorkloadControllerProfiles, SkillWorkloadControllerReconcileResult, SkillWorkloadControllerReleaseReconcileResult } from "./skill-workload-controller.types.js";

/** Require the immutable Kubernetes UID returned by the API rather than a derived identifier. */
function _RequireWorkloadUid(uid: string | undefined): string
{
	if (!uid || uid.trim().length === 0)
	{
		throw new Error("Kubernetes did not return an immutable UID for the suspended governed skill Job");
	}
	return uid;
}

/** Derive a stable opaque reference without projecting the workload's durable identifier into Kubernetes. */
function _CapabilityReference(workloadId: string): string
{
	if (!/^[a-zA-Z0-9_-]{1,128}$/.test(workloadId))
	{
		throw new Error("governed skill workload id is not safe to project into a capability reference");
	}
	return `skill-bootstrap-v1_${createHash("sha256").update(workloadId, "utf8").digest("hex")}`;
}

/** Require the immutable Pod UID returned by Kubernetes instead of trusting a container value. */
function _RequirePodUid(uid: string | undefined): string
{
	if (!uid || uid.trim().length === 0)
	{
		throw new Error("Kubernetes did not return an immutable UID for the first governed skill worker Pod");
	}
	return uid;
}

/** Validate both fixed deployment profiles through the canonical hardened Job builder. */
export function __ValidateSkillWorkloadControllerProfiles(value: unknown): SkillWorkloadControllerProfiles
{
	if (typeof value !== "object" || value === null || Array.isArray(value))
	{
		throw new Error("skill workload controller profiles must be one object");
	}
	const candidate = value as Partial<Record<"authoring" | "tool-runner", unknown>>;
	if (!("authoring" in candidate) || !("tool-runner" in candidate) || Object.keys(candidate).length !== 2)
	{
		throw new Error("skill workload controller requires exactly authoring and tool-runner profiles");
	}
	const profiles: Record<"authoring" | "tool-runner", SkillWorkloadJobProfile> = {} as Record<"authoring" | "tool-runner", SkillWorkloadJobProfile>;
	for (const kind of ["authoring", "tool-runner"] as const)
	{
		const profile = structuredClone(candidate[kind]) as SkillWorkloadJobProfile;
		if (profile.kind !== kind)
		{
			throw new Error(`skill workload controller ${kind} profile has the wrong workload class`);
		}
		__BuildGovernedSkillWorkloadJob({ jobId: "profile-validation", siloId: "profile-validation", namespace: profile.namespace, capabilityReference: _CapabilityReference("profile-validation") }, profile);
		profiles[kind] = profile;
	}
	return profiles;
}

/** Reconcile at most one database-fenced governed skill workload into a durable suspended Job. */
export async function __ReconcileNextSkillWorkload(options: SkillWorkloadControllerOptions, signal: AbortSignal): Promise<SkillWorkloadControllerReconcileResult>
{
	return ___DoWithTrace("agent_controller.skill_workload.reconcile", {}, async function _ReconcileSkillWorkload(): Promise<SkillWorkloadControllerReconcileResult>
	{
		// 1. Read only the server-owned desired state; Kubernetes never decides which work may run.
		const claim = await options.authority.__Claim(signal);
		if (claim === null) return { outcome: "idle" };

		// 2. Rebuild the exact hardened suspended Job from a fixed class profile and opaque reference.
		const profile = options.profiles[claim.kind];
		const job = __BuildGovernedSkillWorkloadJob({ jobId: claim.workloadId, siloId: claim.siloId, namespace: profile.namespace, capabilityReference: _CapabilityReference(claim.workloadId) }, profile);

		// 3. Create or exact-adopt the inert Job and accept only the API-issued immutable UID.
		const persistedJob = await options.kubernetes.__EnsureSuspendedJob(job);
		const workloadUid = _RequireWorkloadUid(persistedJob.metadata?.uid);

		// 4. Commit the same database claim generation; a stale replica can never assign this Job.
		const outcome = await options.authority.__CommitAssignment(claim.workloadId, { claimedAt: claim.claimedAt, deliveryCount: claim.deliveryCount, workloadUid, bootstrapReference: _CapabilityReference(claim.workloadId) }, signal);
		if (outcome === "conflict")
		{
			throw new Error("governed skill workload assignment lost its database claim fence");
		}
		options.log.info({ workloadId: claim.workloadId, workloadUid, outcome }, "governed skill workload assigned to suspended Job");
		return { outcome, workloadId: claim.workloadId, workloadUid };
	});
}

/** Release one exact assigned skill Job and record its first uniquely owned worker Pod. */
export async function __ReconcileNextSkillWorkloadRelease(options: SkillWorkloadControllerOptions, signal: AbortSignal): Promise<SkillWorkloadControllerReleaseReconcileResult>
{
	return ___DoWithTrace("agent_controller.skill_workload.release.reconcile", {}, async function _ReconcileSkillWorkloadRelease(): Promise<SkillWorkloadControllerReleaseReconcileResult>
	{
		// 1. Claim the durable release fence; Kubernetes never chooses or reconstructs authority state.
		const claim = await options.authority.__ClaimRelease(signal);
		if (claim === null) return { outcome: "idle" };

		// 2. Rebuild the exact immutable Job from deployment-owned class policy and opaque reference.
		const profile = options.profiles[claim.kind];
		if (!profile || profile.serverNamespace === profile.namespace)
		{
			throw new Error("governed skill workload release does not match a bounded isolated profile");
		}
		const job = __BuildGovernedSkillWorkloadJob({ jobId: claim.workloadId, siloId: claim.siloId, namespace: profile.namespace, capabilityReference: _CapabilityReference(claim.workloadId) }, profile);

		// 3. Compare-and-swap only suspend=true to false, then durably commit that exact release fence.
		await options.kubernetes.__EnsureSkillJobReleased(job, claim.workloadUid, claim.expiresAt);
		const released = await options.authority.__CommitRelease(claim.workloadId, { releaseClaimedAt: claim.releaseClaimedAt, releaseDeliveryCount: claim.releaseDeliveryCount, workloadUid: claim.workloadUid }, signal);
		if (released === "conflict") throw new Error("governed skill workload release lost its database claim fence");

		// 4. Bind the first exact Job-owned Pod before a worker may exchange its bootstrap reference.
		const pod = await options.kubernetes.__FindFirstSkillWorkloadPod(job, claim.workloadUid, profile.serviceAccountName);
		if (pod === null) return { outcome: "pending-pod", workloadId: claim.workloadId, workloadUid: claim.workloadUid };
		const podUid = _RequirePodUid(pod.metadata?.uid);
		const registered = await options.authority.__RegisterFirstPod(claim.workloadId, { releaseClaimedAt: claim.releaseClaimedAt, releaseDeliveryCount: claim.releaseDeliveryCount, workloadUid: claim.workloadUid, podUid }, signal);
		if (registered === "conflict") throw new Error("governed skill workload Pod registration lost its durable release fence");
		options.log.info({ workloadId: claim.workloadId, workloadUid: claim.workloadUid, podUid, outcome: registered }, "governed skill workload released and first Pod registered");
		return { outcome: registered === "registered" ? "registered" : "idempotent", workloadId: claim.workloadId, workloadUid: claim.workloadUid, podUid };
	});
}

/** Poll the skill authority until shutdown, isolating failures without replacing Kubernetes objects. */
export async function __RunSkillWorkloadController(options: SkillWorkloadControllerOptions, signal: AbortSignal): Promise<void>
{
	if (!Number.isSafeInteger(options.pollIntervalMilliseconds) || options.pollIntervalMilliseconds < 100 || options.pollIntervalMilliseconds > 60_000)
	{
		throw new Error("skill workload controller poll interval must be between 100 and 60000ms");
	}
	while (!signal.aborted)
	{
		let didWork = false;
		try
		{
			const result = await __ReconcileNextSkillWorkload(options, signal);
			didWork = result.outcome !== "idle";
		}
		catch (err)
		{
			if (signal.aborted) break;
			options.log.error({ err }, "governed skill workload reconciliation failed");
		}
		try
		{
			const release = await __ReconcileNextSkillWorkloadRelease(options, signal);
			didWork = didWork || (release.outcome !== "idle" && release.outcome !== "pending-pod");
		}
		catch (err)
		{
			if (signal.aborted) break;
			options.log.error({ err }, "governed skill workload release reconciliation failed");
		}
		if (signal.aborted) break;
		if (!didWork) await _Wait(options.pollIntervalMilliseconds, signal);
	}
}

/** Wait for one poll interval without delaying shutdown behind a timer. */
async function _Wait(milliseconds: number, signal: AbortSignal): Promise<void>
{
	if (signal.aborted) return;
	await new Promise<void>(function _WaitForPoll(resolve)
	{
		/** Complete one delay and release the listener retained by the controller signal. */
		function _CompleteWait(): void
		{
			clearTimeout(timer);
			signal.removeEventListener("abort", _CompleteWait);
			resolve();
		}
		const timer = setTimeout(_CompleteWait, milliseconds);
		signal.addEventListener("abort", _CompleteWait, { once: true });
	});
}
