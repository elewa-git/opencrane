import { __BuildGovernedSkillWorkloadJob, SkillWorkloadKinds, type SkillWorkloadJobProfile } from "@opencrane/backend/agents/skills/k8s-launcher";
import { __CreateSkillWorkloadBootstrapReference } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import { SkillWorkloadControllerReconcileOutcomes, type SkillWorkloadControllerOptions, type SkillWorkloadControllerProfiles, type SkillWorkloadControllerReconcileResult, type SkillWorkloadControllerReleaseReconcileResult } from "./skill-workload-controller.types";

/** Return the Job UID Kubernetes assigned, and fail if the API did not send one. */
function _RequireWorkloadUid(uid: string | undefined): string
{
	if (!uid || uid.trim().length === 0)
	{
		throw new Error("Kubernetes did not return an immutable UID for the suspended governed skill Job");
	}
	return uid;
}

/** Return the Pod UID Kubernetes assigned, and fail if the API did not send one. Never take it from the container. */
function _RequirePodUid(uid: string | undefined): string
{
	if (!uid || uid.trim().length === 0)
	{
		throw new Error("Kubernetes did not return an immutable UID for the first governed skill worker Pod");
	}
	return uid;
}

/** Return whether a value is a plain object — not null and not an array — so its keys can be read. */
function _IsRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === "object" && value !== null && !Array.isArray(value); }

/** Return whether an object contains exactly the expected own-property names. */
function _HasOnlyKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean { return Object.keys(value).length === expected.length && expected.every(function _HasKey(key): boolean { return Object.prototype.hasOwnProperty.call(value, key); }); }

/** Rebuild a resource map with only `cpu` and `memory`, dropping every other Kubernetes resource type. */
function _ResourceMap(value: unknown): Readonly<Record<"cpu" | "memory", string>> | null
{
	if (!_IsRecord(value) || !_HasOnlyKeys(value, ["cpu", "memory"]) || typeof value["cpu"] !== "string" || typeof value["memory"] !== "string") return null;
	return { cpu: value["cpu"], memory: value["memory"] };
}

/** Check one deployment profile field by field and rebuild it, so only known fields reach the Job builder. */
function _SkillWorkloadJobProfile(value: unknown): SkillWorkloadJobProfile | null
{
	// 1. Check the workload class first, because the checks after this depend on which class it is.
	if (!_IsRecord(value) || !_HasOnlyKeys(value, ["kind", "image", "imagePullPolicy", "serverNamespace", "namespace", "serviceAccountName", "capabilityTokenAudience", "bootstrapUrl", "capabilityTokenPath", "bootstrapReferencePath", "scratchSize", "activeDeadlineSeconds", "ttlSecondsAfterFinished", "resources"]) || (value["kind"] !== "authoring" && value["kind"] !== "tool-runner")) return null;

	// 2. Check every simple field at runtime, so the builder never gets a value that only a TypeScript cast made look valid.
	if (typeof value["image"] !== "string" || (value["imagePullPolicy"] !== "Always" && value["imagePullPolicy"] !== "IfNotPresent" && value["imagePullPolicy"] !== "Never") || typeof value["serverNamespace"] !== "string" || typeof value["namespace"] !== "string" || typeof value["serviceAccountName"] !== "string" || typeof value["capabilityTokenAudience"] !== "string" || typeof value["bootstrapUrl"] !== "string" || typeof value["capabilityTokenPath"] !== "string" || typeof value["bootstrapReferencePath"] !== "string" || typeof value["scratchSize"] !== "string" || typeof value["activeDeadlineSeconds"] !== "number" || typeof value["ttlSecondsAfterFinished"] !== "number") return null;

	// 3. Copy the resource and profile fields one by one, so no extra field from the caller reaches Kubernetes.
	const resources = value["resources"];
	if (!_IsRecord(resources) || !_HasOnlyKeys(resources, ["requests", "limits"])) return null;
	const requests = _ResourceMap(resources["requests"]);
	const limits = _ResourceMap(resources["limits"]);
	if (requests === null || limits === null) return null;
	return { kind: value["kind"], image: value["image"], imagePullPolicy: value["imagePullPolicy"], serverNamespace: value["serverNamespace"], namespace: value["namespace"], serviceAccountName: value["serviceAccountName"], capabilityTokenAudience: value["capabilityTokenAudience"], bootstrapUrl: value["bootstrapUrl"], capabilityTokenPath: value["capabilityTokenPath"], bootstrapReferencePath: value["bootstrapReferencePath"], scratchSize: value["scratchSize"], activeDeadlineSeconds: value["activeDeadlineSeconds"], ttlSecondsAfterFinished: value["ttlSecondsAfterFinished"], resources: { requests, limits } };
}

/** Check both deployment profiles by running each one through the Job builder. */
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
	const profiles = {} as { authoring: SkillWorkloadJobProfile & { readonly kind: "authoring" }; "tool-runner": SkillWorkloadJobProfile & { readonly kind: "tool-runner" } };
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
		if (kind === SkillWorkloadKinds.Authoring)
		{
			profiles.authoring = profile as SkillWorkloadJobProfile & { readonly kind: "authoring" };
		}
		else
		{
			profiles["tool-runner"] = profile as SkillWorkloadJobProfile & { readonly kind: "tool-runner" };
		}
	}
	return profiles;
}

/** Unsuspend one assigned skill Job, then record the first Pod that Job created. */
export async function __ReconcileNextSkillWorkloadRelease(options: SkillWorkloadControllerOptions, signal: AbortSignal): Promise<SkillWorkloadControllerReleaseReconcileResult>
{
	return ___DoWithTrace("agent_controller.skill_workload.release.reconcile", {}, async function _ReconcileSkillWorkloadRelease(): Promise<SkillWorkloadControllerReleaseReconcileResult>
	{
		// 1. Take a release claim from the database. Kubernetes never decides what to release, and never rebuilds this state.
		const claim = await options.authority.__ClaimRelease(signal);
		if (claim === null) return { outcome: SkillWorkloadControllerReconcileOutcomes.Idle };

		// 2. Rebuild the same Job manifest from the deployment profile for this class plus the bootstrap reference.
		if (claim.kind !== SkillWorkloadKinds.ToolRunner)
		{
			throw new Error("legacy skill workload release accepts only tool-runner claims");
		}
		const profile = options.profile;
		if (profile.serverNamespace === profile.namespace)
		{
			throw new Error("governed skill workload release does not match a bounded isolated profile");
		}
		const capabilityReference = await __CreateSkillWorkloadBootstrapReference(claim.workloadId);
		const job = __BuildGovernedSkillWorkloadJob({ jobId: claim.workloadId, siloId: claim.siloId, namespace: profile.namespace, capabilityReference }, profile);

		// 3. Flip suspend from true to false with a compare-and-swap, then record the release against the same claim.
		await options.kubernetes.releaseJob(job, claim.workloadUid, { expiresAt: claim.expiresAt });
		const released = await options.authority.__CommitRelease(claim.workloadId, { releaseClaimedAt: claim.releaseClaimedAt, releaseDeliveryCount: claim.releaseDeliveryCount, workloadUid: claim.workloadUid }, signal);
		if (released === "conflict") throw new Error("governed skill workload release lost its database claim fence");

		// 4. Record the first Pod this Job owns. A worker cannot trade its bootstrap reference until that Pod is recorded.
		const pod = await options.kubernetes.findFirstPod(job, claim.workloadUid, profile.serviceAccountName);
		if (pod === null) return { outcome: SkillWorkloadControllerReconcileOutcomes.PendingPod, workloadId: claim.workloadId, workloadUid: claim.workloadUid };
		const podUid = _RequirePodUid(pod.metadata?.uid);
		const registered = await options.authority.__RegisterFirstPod(claim.workloadId, { releaseClaimedAt: claim.releaseClaimedAt, releaseDeliveryCount: claim.releaseDeliveryCount, workloadUid: claim.workloadUid, podUid }, signal);
		if (registered === "conflict") throw new Error("governed skill workload Pod registration lost its durable release fence");
		options.log.info({ workloadId: claim.workloadId, workloadUid: claim.workloadUid, podUid, outcome: registered }, "governed skill workload released and first Pod registered");
		return { outcome: registered === "registered" ? SkillWorkloadControllerReconcileOutcomes.Registered : SkillWorkloadControllerReconcileOutcomes.Idempotent, workloadId: claim.workloadId, workloadUid: claim.workloadUid, podUid };
	});
}

/** Turn at most one claimed skill workload into a suspended Kubernetes Job, and record that Job in the database. */
export async function __ReconcileNextSkillWorkload(options: SkillWorkloadControllerOptions, signal: AbortSignal): Promise<SkillWorkloadControllerReconcileResult>
{
	return ___DoWithTrace("agent_controller.skill_workload.reconcile", {}, async function _ReconcileSkillWorkload(): Promise<SkillWorkloadControllerReconcileResult>
	{
		// 1. Read what the OpenCrane server says should run. Kubernetes never decides which work may run.
		const claim = await options.authority.__Claim(signal);
		if (claim === null) return { outcome: SkillWorkloadControllerReconcileOutcomes.Idle };

		// 2. Rebuild the same suspended Job manifest from this class's profile plus the bootstrap reference.
		if (claim.kind !== SkillWorkloadKinds.ToolRunner)
		{
			throw new Error("legacy skill workload controller accepts only tool-runner claims");
		}
		const profile = options.profile;
		const capabilityReference = await __CreateSkillWorkloadBootstrapReference(claim.workloadId);
		const job = __BuildGovernedSkillWorkloadJob({ jobId: claim.workloadId, siloId: claim.siloId, namespace: profile.namespace, capabilityReference }, profile);

		// 3. Create the suspended Job, or adopt an identical one that already exists, and use only the UID Kubernetes returned.
		const persistedJob = await options.kubernetes.ensureSuspendedJob(job);
		const workloadUid = _RequireWorkloadUid(persistedJob.metadata?.uid);

		// 4. Write the assignment back against the same claim, so an out-of-date controller replica cannot assign this Job.
		const outcome = await options.authority.__CommitAssignment(claim.workloadId, { claimedAt: claim.claimedAt, deliveryCount: claim.deliveryCount, workloadUid, bootstrapReference: capabilityReference, namespace: profile.namespace }, signal);
		if (outcome === "conflict")
		{
			throw new Error("governed skill workload assignment lost its database claim fence");
		}
		options.log.info({ workloadId: claim.workloadId, workloadUid, outcome }, "governed skill workload assigned to suspended Job");
		return { outcome: outcome === "assigned" ? SkillWorkloadControllerReconcileOutcomes.Assigned : SkillWorkloadControllerReconcileOutcomes.Idempotent, workloadId: claim.workloadId, workloadUid };
	});
}

/** Poll for work until shutdown. A failed pass is logged and the loop continues; no Kubernetes object is ever deleted or recreated. */
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
			didWork = result.outcome !== SkillWorkloadControllerReconcileOutcomes.Idle;
		}
		catch (err)
		{
			if (signal.aborted) break;
			options.log.error({ err }, "governed skill workload reconciliation failed");
		}
		try
		{
			const release = await __ReconcileNextSkillWorkloadRelease(options, signal);
			didWork = didWork || (release.outcome !== SkillWorkloadControllerReconcileOutcomes.Idle && release.outcome !== SkillWorkloadControllerReconcileOutcomes.PendingPod);
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

/** Wait one poll interval, but return straight away when shutdown starts, so the timer never holds shutdown up. */
async function _Wait(milliseconds: number, signal: AbortSignal): Promise<void>
{
	if (signal.aborted) return;
	await new Promise<void>(function _WaitForPoll(resolve)
	{
		/** Finish the wait and remove the abort listener, so the signal stops holding on to it. */
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
