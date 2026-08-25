import { __BuildMcpbValidatorJob, type McpbValidatorJobProfile } from "@opencrane/backend/server/gateways/mcp/validator-k8s-launcher";
import { __CreateMcpbValidatorBootstrapReference } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import { McpbValidationControllerReconcileOutcomes, type McpbValidationControllerOptions, type McpbValidationControllerReconcileResult } from "./mcpb-validation-controller.types";

/** Return the UID assigned by Kubernetes, rejecting a Job that has no immutable identity. */
function _RequireWorkloadUid(value: string | undefined): string
{
	if (!value || value.trim().length === 0)
	{
		throw new Error("Kubernetes did not return an immutable UID for the suspended MCP bundle validator Job");
	}
	return value;
}

/** Validate a profile by asking the restricted Job builder to build an inert example Job. */
export function __ValidateMcpbValidationControllerProfile(value: unknown): McpbValidatorJobProfile
{
	const profile = value as McpbValidatorJobProfile;
	__BuildMcpbValidatorJob({ validationId: "profile-validation", siloId: "profile-validation", namespace: profile?.namespace ?? "", bootstrapReference: __CreateMcpbValidatorBootstrapReference("profile-validation") }, profile);
	return profile;
}

/** Claim at most one MCP bundle inspection workload, create its suspended Job, and save the Job UID. */
export async function __ReconcileNextMcpbValidation(options: McpbValidationControllerOptions, signal: AbortSignal): Promise<McpbValidationControllerReconcileResult>
{
	return ___DoWithTrace("agent_controller.mcpb_validation.reconcile", {}, async function _ReconcileMcpbValidation(): Promise<McpbValidationControllerReconcileResult>
	{
		// 1. Take work from the database authority before Kubernetes sees any new validator Job.
		const claim = await options.authority.__Claim(signal);
		if (claim === null)
		{
			return { outcome: McpbValidationControllerReconcileOutcomes.Idle };
		}

		// 2. Build the fixed, suspended Job from deployment configuration and an opaque workload reference.
		const bootstrapReference = __CreateMcpbValidatorBootstrapReference(claim.workloadId);
		const expected = __BuildMcpbValidatorJob({ validationId: claim.validationId, siloId: claim.siloId, namespace: options.profile.namespace, bootstrapReference }, options.profile);
		const job = await options.kubernetes.__EnsureSuspendedJob(expected);
		const workloadUid = _RequireWorkloadUid(job.metadata?.uid);

		// 3. Bind the Kubernetes Job to the same database claim, so a stale controller cannot assign it.
		const outcome = await options.authority.__CommitAssignment(claim.workloadId, { claimedAt: claim.claimedAt, deliveryCount: claim.deliveryCount, workloadUid }, signal);
		if (outcome === "conflict")
		{
			throw new Error("MCP bundle validator assignment lost its database claim");
		}
		options.log.info({ workloadId: claim.workloadId, workloadUid, outcome }, "MCP bundle validator Job assigned");
		return { outcome: outcome === "assigned" ? McpbValidationControllerReconcileOutcomes.Assigned : McpbValidationControllerReconcileOutcomes.Idempotent, workloadId: claim.workloadId, workloadUid };
	});
}

/** Poll saved MCP bundle inspection work until the controller process stops. */
export async function __RunMcpbValidationController(options: McpbValidationControllerOptions, signal: AbortSignal): Promise<void>
{
	if (!Number.isSafeInteger(options.pollIntervalMilliseconds) || options.pollIntervalMilliseconds < 100 || options.pollIntervalMilliseconds > 60_000)
	{
		throw new Error("MCP bundle validation controller poll interval must be between 100 and 60000ms");
	}
	while (!signal.aborted)
	{
		try
		{
			const result = await __ReconcileNextMcpbValidation(options, signal);
			if (result.outcome !== McpbValidationControllerReconcileOutcomes.Idle)
			{
				continue;
			}
		}
		catch (err)
		{
			if (signal.aborted)
			{
				break;
			}
			options.log.error({ err }, "MCP bundle validation reconciliation failed");
		}
		await _Wait(options.pollIntervalMilliseconds, signal);
	}
}

/** Wait for another poll, but finish immediately when shutdown begins. */
async function _Wait(milliseconds: number, signal: AbortSignal): Promise<void>
{
	if (signal.aborted)
	{
		return;
	}
	await new Promise<void>(function _WaitForPoll(resolve)
	{
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
