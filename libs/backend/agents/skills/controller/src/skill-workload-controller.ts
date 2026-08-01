import { __BuildGovernedSkillWorkloadJob, type SkillWorkloadJobProfile } from "@opencrane/backend/agents/skills/k8s-launcher";
import { __CreateSkillWorkloadBootstrapReference } from "@opencrane/contracts";
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

/** Require the immutable Pod UID returned by Kubernetes instead of trusting a container value. */
function _RequirePodUid(uid: string | undefined): string
{
	if (!uid || uid.trim().length === 0)
	{
		throw new Error("Kubernetes did not return an immutable UID for the first governed skill worker Pod");
	}
	return uid;
}

/** Return whether a boundary value is one non-array object with inspectable properties. */
function _IsRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === "object" && value !== null && !Array.isArray(value); }

/** Return whether an object contains exactly the expected own-property names. */
function _HasOnlyKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean { return Object.keys(value).length === expected.length && expected.every(function _HasKey(key): boolean { return Object.prototype.hasOwnProperty.call(value, key); }); }

/** Canonicalize one CPU-and-memory resource map without forwarding extended Kubernetes resources. */
function _ResourceMap(value: unknown): Readonly<Record<"cpu" | "memory", string>> | null
{
	if (!_IsRecord(value) || !_HasOnlyKeys(value, ["cpu", "memory"]) || typeof value["cpu"] !== "string" || typeof value["memory"] !== "string") return null;
	return { cpu: value["cpu"], memory: value["memory"] };
}

/** Validate and canonicalize one untrusted deployment profile for the hardened Job builder. */
function _SkillWorkloadJobProfile(value: unknown): SkillWorkloadJobProfile | null
{
	// 1. Require the fixed workload discriminant before class-specific validation can run.
	if (!_IsRecord(value) || !_HasOnlyKeys(value, ["kind", "image", "imagePullPolicy", "serverNamespace", "namespace", "serviceAccountName", "capabilityTokenAudience", "bootstrapUrl", "capabilityTokenPath", "bootstrapReferencePath", "scratchSize", "activeDeadlineSeconds", "ttlSecondsAfterFinished", "resources"]) || (value["kind"] !== "authoring" && value["kind"] !== "tool-runner")) return null;

	// 2. Require every scalar field so the canonical builder never receives an assertion-created value.
	if (typeof value["image"] !== "string" || (value["imagePullPolicy"] !== "Always" && value["imagePullPolicy"] !== "IfNotPresent" && value["imagePullPolicy"] !== "Never") || typeof value["serverNamespace"] !== "string" || typeof value["namespace"] !== "string" || typeof value["serviceAccountName"] !== "string" || typeof value["capabilityTokenAudience"] !== "string" || typeof value["bootstrapUrl"] !== "string" || typeof value["capabilityTokenPath"] !== "string" || typeof value["bootstrapReferencePath"] !== "string" || typeof value["scratchSize"] !== "string" || typeof value["activeDeadlineSeconds"] !== "number" || typeof value["ttlSecondsAfterFinished"] !== "number") return null;

	// 3. Rebuild exact resource and profile objects so no unreviewed field can reach Kubernetes.
	const resources = value["resources"];
	if (!_IsRecord(resources) || !_HasOnlyKeys(resources, ["requests", "limits"])) return null;
	const requests = _ResourceMap(resources["requests"]);
	const limits = _ResourceMap(resources["limits"]);
	if (requests === null || limits === null) return null;
	return { kind: value["kind"], image: value["image"], imagePullPolicy: value["imagePullPolicy"], serverNamespace: value["serverNamespace"], namespace: value["namespace"], serviceAccountName: value["serviceAccountName"], capabilityTokenAudience: value["capabilityTokenAudience"], bootstrapUrl: value["bootstrapUrl"], capabilityTokenPath: value["capabilityTokenPath"], bootstrapReferencePath: value["bootstrapReferencePath"], scratchSize: value["scratchSize"], activeDeadlineSeconds: value["activeDeadlineSeconds"], ttlSecondsAfterFinished: value["ttlSecondsAfterFinished"], resources: { requests, limits } };
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
		const profile = _SkillWorkloadJobProfile(candidate[kind]);
		if (profile === null)
		{
			throw new Error(`skill workload controller ${kind} profile must be one complete bounded object`);
		}
		if (profile.kind !== kind)
		{
			throw new Error(`skill workload controller ${kind} profile has the wrong workload class`);
		}
		__BuildGovernedSkillWorkloadJob({ jobId: "profile-validation", siloId: "profile-validation", namespace: profile.namespace, capabilityReference: `skill-bootstrap-v1_${"0".repeat(64)}` }, profile);
		profiles[kind] = profile;
	}
	return profiles;
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
		const capabilityReference = await __CreateSkillWorkloadBootstrapReference(claim.workloadId);
		const job = __BuildGovernedSkillWorkloadJob({ jobId: claim.workloadId, siloId: claim.siloId, namespace: profile.namespace, capabilityReference }, profile);

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
		const capabilityReference = await __CreateSkillWorkloadBootstrapReference(claim.workloadId);
		const job = __BuildGovernedSkillWorkloadJob({ jobId: claim.workloadId, siloId: claim.siloId, namespace: profile.namespace, capabilityReference }, profile);

		// 3. Create or exact-adopt the inert Job and accept only the API-issued immutable UID.
		const persistedJob = await options.kubernetes.__EnsureSuspendedJob(job);
		const workloadUid = _RequireWorkloadUid(persistedJob.metadata?.uid);

		// 4. Commit the same database claim generation; a stale replica can never assign this Job.
		const outcome = await options.authority.__CommitAssignment(claim.workloadId, { claimedAt: claim.claimedAt, deliveryCount: claim.deliveryCount, workloadUid, bootstrapReference: capabilityReference, namespace: profile.namespace }, signal);
		if (outcome === "conflict")
		{
			throw new Error("governed skill workload assignment lost its database claim fence");
		}
		options.log.info({ workloadId: claim.workloadId, workloadUid, outcome }, "governed skill workload assigned to suspended Job");
		return { outcome, workloadId: claim.workloadId, workloadUid };
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
