import type { V1Job, V1Pod } from "@kubernetes/client-node";

import { SkillAuthoringValidationTaskDeclaration } from "@opencrane/backend/agents/skills/workflows/contract";
import type { SkillAuthoringValidationTaskInput } from "@opencrane/backend/agents/skills/workflows/contract";
import { __BuildGovernedSkillWorkloadJob, SkillWorkloadKinds } from "@opencrane/backend/agents/skills/k8s-launcher";
import { RuntimeWorkloadClaimClasses } from "@opencrane/backend/agents/runtime/workloads/contract";
import type { RuntimeWorkloadBinding } from "@opencrane/backend/agents/runtime/workloads/contract";
import { __CreateSkillWorkloadBootstrapReference } from "@opencrane/contracts";
import { WorkflowTaskTerminalError } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowTaskDefinition, IWorkflowTaskEvent } from "@opencrane/backend/server/infra/workflows/contract";

import type { SkillAuthoringValidationCompletion, SkillAuthoringValidationControllerRecord, SkillAuthoringValidationHandlerOptions, SkillAuthoringValidationTaskContext, SkillAuthoringValidationTaskResult } from "./skill-authoring-validation-handler.types";

/** Names the private event the server publishes after it persists a worker completion in its inbox. */
const _COMPLETION_EVENT = "skill-authoring-completed";

/** Require the immutable Kubernetes UID that the server must record before the authoring Job is released. */
function _JobUid(job: V1Job): string
{
	const uid = job.metadata?.uid?.trim();
	if (!uid)
	{
		throw new Error("Kubernetes did not return an immutable UID for the authoring validation Job");
	}
	return uid;
}

/** Require the immutable Kubernetes UID of the first Job-owned Pod before the server records it. */
function _PodUid(pod: V1Pod): string
{
	const uid = pod.metadata?.uid?.trim();
	if (!uid)
	{
		throw new Error("Kubernetes did not return an immutable UID for the authoring validation Pod");
	}
	return uid;
}

/**
 * Reads a completion identity from the private event and rejects one for another validation.
 *
 * The handler must reject that event before it calls the server terminal writer.
 */
function _Completion(event: IWorkflowTaskEvent<unknown>, validationId: string): SkillAuthoringValidationCompletion
{
	const value = event.payload;
	if (typeof value !== "object" || value === null || Array.isArray(value))
	{
		throw new WorkflowTaskTerminalError("Skill authoring completion event does not match its validation.");
	}
	const payload = value as Readonly<Record<string, unknown>>;
	const completionDigest = payload["completionDigest"];
	if (payload["validationId"] !== validationId || typeof completionDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(completionDigest))
	{
		throw new WorkflowTaskTerminalError("Skill authoring completion event does not match its validation.");
	}
	return { validationId, completionDigest };
}

/**
 * Builds the authoring Job without artifact bytes, task input, or credentials.
 *
 * The server retains those values and the worker must use the bootstrap reference after the server
 * has recorded the Job and first Pod identities.
 */
async function _Job(record: SkillAuthoringValidationControllerRecord, profile: SkillAuthoringValidationHandlerOptions["profile"]): Promise<{ readonly job: V1Job; readonly bootstrapReference: string }>
{
	if (profile.kind !== SkillWorkloadKinds.Authoring)
	{
		throw new WorkflowTaskTerminalError("Skill authoring validation requires the authoring Job profile.");
	}
	const bootstrapReference = await __CreateSkillWorkloadBootstrapReference(record.validationId);
	const job = __BuildGovernedSkillWorkloadJob({ jobId: record.jobId, siloId: record.siloId, namespace: profile.namespace, capabilityReference: bootstrapReference }, profile);
	return { job, bootstrapReference };
}

/**
 * Sleeps once before the task checks again for the first Pod its released Job created.
 *
 * The bound carries forward the former controller's supported poll range, so a missing Pod cannot
 * busy-loop Kubernetes or wait longer than that range permits.
 * @see __RunSkillWorkloadController — validates the matching 100–60,000 ms poll range.
 */
async function _WaitForPod(context: SkillAuthoringValidationTaskContext, milliseconds: number): Promise<void>
{
	if (!Number.isSafeInteger(milliseconds) || milliseconds < 100 || milliseconds > 60_000)
	{
		throw new Error("skill authoring validation requires a 100-60000ms Pod wait");
	}
	await context.sleepUntil(new Date(Date.now() + milliseconds));
}

/**
 * Registers the remote task that creates, releases, observes, and completes one Python authoring Job.
 *
 * It uses the declaration the server already admitted, claims and binds the Job UID before release,
 * then binds the first Pod before it accepts a server-persisted completion. The server remains the
 * terminal writer, so the controller never writes product state directly.
 *
 * @param options - Supplies the server authority, Kubernetes adapter, deployment profile, and Pod delay.
 * @returns A replay-safe workflow definition for one admitted validation.
 * @throws {WorkflowTaskTerminalError} When the saved validation, selected profile, completion event, or completion inbox cannot be used.
 * @see SkillAuthoringValidationTaskDeclaration — supplies the task name and retry policy shared with the server.
 */
export function __CreateSkillAuthoringValidationHandler(options: SkillAuthoringValidationHandlerOptions): IWorkflowTaskDefinition<SkillAuthoringValidationTaskInput, SkillAuthoringValidationTaskResult>
{
	return {
		...SkillAuthoringValidationTaskDeclaration,
		async run(context, input): Promise<SkillAuthoringValidationTaskResult>
		{
			// 1. Ask the server for the current claim, so a stale task cannot create a Job for another validation or silo.
			const record = await context.checkpoint({ stepName: "claim-validation" }, async function _ClaimValidation(): Promise<SkillAuthoringValidationControllerRecord>
			{
				const loaded = await options.authority.claimForTask(input.validationId, context.task);
				if (loaded === null || loaded.siloId !== input.siloId || loaded.claim.workloadClass !== RuntimeWorkloadClaimClasses.SkillAuthoringValidation || loaded.claim.profileName !== "authoring")
				{
					throw new WorkflowTaskTerminalError("Skill authoring validation is no longer available.");
				}
				return loaded;
			});

			// 2. Create or adopt a suspended Job, then bind the Kubernetes UID before any Python code can run.
			const prepared = await _Job(record, options.profile);
			const assigned = await context.checkpoint({ stepName: "ensure-suspended-job" }, async function _EnsureSuspendedJob(): Promise<V1Job>
			{
				return await options.kubernetes.ensureSuspendedJob(prepared.job);
			});
			const jobUid = _JobUid(assigned);
			const workloadBinding: RuntimeWorkloadBinding = {
				claimId: record.claim.claimId,
				claimedAt: record.claim.claimedAt,
				deliveryCount: record.claim.deliveryCount,
				profileName: record.claim.profileName,
				workloadUid: jobUid,
			};
			await context.checkpoint({ stepName: "bind-workload" }, async function _BindWorkload(): Promise<void>
			{
				const outcome = await options.authority.bindWorkload(record.validationId, context.task, { binding: workloadBinding, bootstrapReference: prepared.bootstrapReference, namespace: options.profile.namespace });
				if (outcome === "conflict")
				{
					throw new WorkflowTaskTerminalError("Skill authoring validation workload claim no longer matches.");
				}
			});

			// 3. Release only the UID the server recorded, then wait until Kubernetes exposes its sole worker Pod.
			await context.checkpoint({ stepName: "release-job" }, async function _ReleaseJob(): Promise<void>
			{
				await options.kubernetes.releaseJob(prepared.job, jobUid);
			});
			let pod: V1Pod | null = null;
			while (pod === null)
			{
				pod = await context.checkpoint({ stepName: "find-first-pod" }, async function _FindFirstPod(): Promise<V1Pod | null>
				{
					return await options.kubernetes.findFirstPod(prepared.job, jobUid, options.profile.serviceAccountName);
				});
				if (pod === null)
				{
					await _WaitForPod(context, options.podWaitMilliseconds);
				}
			}
			await context.checkpoint({ stepName: "bind-first-pod" }, async function _BindFirstPod(): Promise<void>
			{
				const outcome = await options.authority.bindFirstPod(record.validationId, context.task, { binding: { ...workloadBinding, firstPodUid: _PodUid(pod) } });
				if (outcome === "conflict")
				{
					throw new WorkflowTaskTerminalError("Skill authoring validation Pod claim no longer matches.");
				}
			});

			// 4. Wait for the server-published inbox event, then make the workflow handler the sole terminal writer.
			const event = await context.waitForEvent<unknown>(_COMPLETION_EVENT);
			const requestedCompletion = _Completion(event, record.validationId);
			const completion = await context.checkpoint({ stepName: "load-completion-inbox" }, async function _LoadCompletion(): Promise<SkillAuthoringValidationCompletion>
			{
				const loaded = await options.authority.loadCompletion(record.validationId, requestedCompletion.completionDigest, context.task);
				if (loaded === null)
				{
					throw new WorkflowTaskTerminalError("Skill authoring completion inbox is unavailable.");
				}
				return loaded;
			});
			await context.checkpoint({ stepName: "complete-validation" }, async function _CompleteValidation(): Promise<void>
			{
				const outcome = await options.authority.complete(record.validationId, completion, context.task);
				if (outcome === "conflict")
				{
					throw new WorkflowTaskTerminalError("Skill authoring validation completion no longer matches.");
				}
			});
			return { validationId: record.validationId, completionDigest: completion.completionDigest };
		},
	};
}
