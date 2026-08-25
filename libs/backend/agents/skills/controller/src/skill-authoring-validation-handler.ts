import type { V1Job, V1Pod } from "@kubernetes/client-node";

import { __BuildGovernedSkillWorkloadJob, SkillWorkloadKinds } from "@opencrane/backend/agents/skills/k8s-launcher";
import { __CreateSkillWorkloadBootstrapReference } from "@opencrane/contracts";
import { WorkflowTaskTerminalError } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowTaskDefinition, IWorkflowTaskEvent } from "@opencrane/backend/server/infra/workflows/contract";

import { SkillAuthoringValidationTaskNames } from "./skill-authoring-validation-handler.types";
import type { SkillAuthoringValidationCompletion, SkillAuthoringValidationControllerRecord, SkillAuthoringValidationHandlerOptions, SkillAuthoringValidationTaskContext, SkillAuthoringValidationTaskInput, SkillAuthoringValidationTaskResult } from "./skill-authoring-validation-handler.types";

/** Name of the private event that wakes a task after the server persists a worker completion. */
const _COMPLETION_EVENT = "skill-authoring-completed";

/** Require the immutable Kubernetes UID assigned to one suspended authoring Job. */
function _JobUid(job: V1Job): string
{
	const uid = job.metadata?.uid?.trim();
	if (!uid)
	{
		throw new Error("Kubernetes did not return an immutable UID for the authoring validation Job");
	}
	return uid;
}

/** Require the immutable Kubernetes UID assigned to the first Job-owned authoring Pod. */
function _PodUid(pod: V1Pod): string
{
	const uid = pod.metadata?.uid?.trim();
	if (!uid)
	{
		throw new Error("Kubernetes did not return an immutable UID for the authoring validation Pod");
	}
	return uid;
}

/** Read the persisted completion identity from the private event without accepting a different validation. */
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

/** Build the authoring Job that carries no artifact bytes, task input, or credentials. */
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

/** Sleep once before the task checks again for the first Pod its released Job created. The bound matches the predecessor controller's configured poll range, so this replacement cannot busy-loop Kubernetes or wait longer than the old recovery delay. */
async function _WaitForPod(context: SkillAuthoringValidationTaskContext, milliseconds: number): Promise<void>
{
	if (!Number.isSafeInteger(milliseconds) || milliseconds < 100 || milliseconds > 60_000)
	{
		throw new Error("skill authoring validation requires a 100-60000ms Pod wait");
	}
	await context.sleepUntil(new Date(Date.now() + milliseconds));
}

/** Register the remote task that creates, releases, observes, and completes one Python authoring Job. */
export function __CreateSkillAuthoringValidationHandler(options: SkillAuthoringValidationHandlerOptions): IWorkflowTaskDefinition<SkillAuthoringValidationTaskInput, SkillAuthoringValidationTaskResult>
{
	return {
		taskName: SkillAuthoringValidationTaskNames.Validate,
		retryPolicy: options.retryPolicy,
		async run(context, input): Promise<SkillAuthoringValidationTaskResult>
		{
			// 1. Reload the server-owned row, so a stale task cannot create a Job for another validation or silo.
			const record = await context.checkpoint({ stepName: "load-validation" }, async function _LoadValidation(): Promise<SkillAuthoringValidationControllerRecord>
			{
				const loaded = await options.authority.load(input.validationId, context.task);
				if (loaded === null || loaded.siloId !== input.siloId)
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
			await context.checkpoint({ stepName: "record-job" }, async function _RecordJob(): Promise<void>
			{
				await options.authority.recordJob(record.validationId, context.task, { jobUid, bootstrapReference: prepared.bootstrapReference, namespace: options.profile.namespace });
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
			await context.checkpoint({ stepName: "record-first-pod" }, async function _RecordFirstPod(): Promise<void>
			{
				await options.authority.recordPod(record.validationId, context.task, { jobUid, podUid: _PodUid(pod) });
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
				await options.authority.complete(record.validationId, completion, context.task);
			});
			return { validationId: record.validationId, completionDigest: completion.completionDigest };
		},
	};
}
