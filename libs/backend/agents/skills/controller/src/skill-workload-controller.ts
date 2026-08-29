import { __BuildGovernedSkillWorkloadJob } from "@opencrane/backend/agents/skills/k8s-launcher";

import { _ParseSkillWorkloadControllerProfile } from "./skill-workload-controller-profile.validator";
import { __ReconcileNextSkillWorkload } from "./skill-workload-assignment-reconciler";
import { __ReconcileNextSkillWorkloadRelease } from "./skill-workload-release-reconciler";
import { SkillWorkloadControllerReconcileOutcomes, type SkillWorkloadControllerOptions, type SkillWorkloadControllerProfiles } from "./skill-workload-controller.types";

/** Re-exports assignment reconciliation at the original controller module seam. */
export { __ReconcileNextSkillWorkload } from "./skill-workload-assignment-reconciler";
/** Re-exports release reconciliation at the original controller module seam. */
export { __ReconcileNextSkillWorkloadRelease } from "./skill-workload-release-reconciler";

/**
 * Validates both deployment profiles by passing each one through the matching Job builder.
 *
 * Startup requires both `authoring` and `tool-runner` profiles, because the controller dispatches
 * each workload class by that key. A profile with the wrong class or an unbuildable Job fails
 * configuration validation before the controller claims work.
 *
 * Called by: apps/agent-controller/src/config.ts.
 * @param value - Parsed controller configuration containing the two workload-class profiles.
 * @returns The checked profiles indexed by their workload class.
 * @throws Error When a profile is missing, has unknown fields, has the wrong class, or cannot build a Job.
 */
export function __ValidateSkillWorkloadControllerProfiles(value: unknown): SkillWorkloadControllerProfiles
{
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("skill workload controller profiles must be one object");
	const candidate = value as Partial<Record<"authoring" | "tool-runner", unknown>>;
	if (!("authoring" in candidate) || !("tool-runner" in candidate) || Object.keys(candidate).length !== 2)
		throw new Error("skill workload controller requires exactly authoring and tool-runner profiles");
	const profiles = {} as Record<"authoring" | "tool-runner", SkillWorkloadControllerProfiles["authoring"]>;
	for (const kind of ["authoring", "tool-runner"] as const)
	{
		const profile = _ParseSkillWorkloadControllerProfile(candidate[kind]);
		if (profile === null)
			throw new Error(`skill workload controller ${kind} profile must be one complete bounded object`);
		if (profile.kind !== kind)
		{
			throw new Error(`skill workload controller ${kind} profile has the wrong workload class`);
		}
		__BuildGovernedSkillWorkloadJob({ jobId: "profile-validation", siloId: "profile-validation", namespace: profile.namespace, capabilityReference: `skill-bootstrap-v1_${"0".repeat(64)}` }, profile);
		profiles[kind] = profile;
	}
	return profiles;
}

/**
 * Polls for skill assignments and releases until the process drain signal aborts.
 *
 * A failed pass is logged and does not stop the other reconciliation kind. The loop never deletes
 * or recreates a Kubernetes object, so recovery continues from the server's saved claim fence.
 *
 * Called by: apps/agent-controller/src/controller-runtime.ts.
 * @param options - The server authority, Kubernetes store, class profiles, poll interval, and logger.
 * @param signal - The process drain signal that stops requests and polling.
 * @returns A promise that settles after the signal aborts the polling loop.
 * @throws Error When the configured poll interval is outside the supported range.
 */
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
