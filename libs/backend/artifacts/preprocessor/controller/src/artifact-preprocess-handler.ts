import type { V1Job, V1Pod } from "@kubernetes/client-node";

import { __CreateArtifactPreprocessBootstrapReference } from "@opencrane/contracts";
import { __BuildArtifactPreprocessorJob } from "@opencrane/backend/artifacts/preprocessor/k8s-launcher";
import { ArtifactPreprocessTaskDeclaration } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import type { ArtifactPreprocessControllerRecord, ArtifactPreprocessTaskInput } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import { RuntimeWorkloadClaimClasses } from "@opencrane/backend/agents/runtime/workloads/contract";
import type { RuntimeWorkloadBinding } from "@opencrane/backend/agents/runtime/workloads/contract";
import { WorkflowTaskRetryableError, WorkflowTaskTerminalError } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowTaskDefinition, IWorkflowTaskEvent } from "@opencrane/backend/server/infra/workflows/contract";

import type { ArtifactPreprocessCompletion, ArtifactPreprocessHandlerOptions, ArtifactPreprocessTaskContext, ArtifactPreprocessTaskResult } from "./artifact-preprocess-handler.types";

/** Names the event the server publishes after it persists a PDF worker completion. */
const _COMPLETION_EVENT = "artifact-preprocess-completed";

/** Reads a completion identity from the private event and rejects another preprocessing job's event. */
function _Completion(event: IWorkflowTaskEvent<unknown>, preprocessJobId: string): ArtifactPreprocessCompletion
{
	const value = event.payload;
	if (typeof value !== "object" || value === null || Array.isArray(value))
	{
		throw new WorkflowTaskTerminalError("PDF preprocessing completion event does not match its job.");
	}
	const payload = value as Readonly<Record<string, unknown>>;
	const completionDigest = payload["completionDigest"];
	if (payload["preprocessJobId"] !== preprocessJobId || typeof completionDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(completionDigest))
	{
		throw new WorkflowTaskTerminalError("PDF preprocessing completion event does not match its job.");
	}
	return { preprocessJobId, completionDigest };
}

/** Requires the immutable UID Kubernetes assigned to a Job before it may be released. */
function _JobUid(job: V1Job): string
{
	const uid = job.metadata?.uid?.trim();
	if (!uid)
		throw new WorkflowTaskTerminalError("Kubernetes did not return an immutable UID for the PDF preprocessing Job.");
	return uid;
}

/** Requires the immutable UID Kubernetes assigned to the first Job-owned Pod. */
function _PodUid(pod: V1Pod): string
{
	const uid = pod.metadata?.uid?.trim();
	if (!uid)
		throw new WorkflowTaskTerminalError("Kubernetes did not return an immutable UID for the PDF preprocessing Pod.");
	return uid;
}

/** Build the suspended Job and opaque bootstrap reference for the server-selected preprocessing record. */
async function _Job(record: ArtifactPreprocessControllerRecord, profile: ArtifactPreprocessHandlerOptions["profile"]): Promise<{ readonly bootstrapReference: string; readonly job: V1Job }>
{
	const bootstrapReference = await __CreateArtifactPreprocessBootstrapReference(record.preprocessJobId);
	const assignment = { preprocessJobId: record.preprocessJobId, siloId: record.siloId, namespace: profile.namespace, bootstrapReference };
	return { bootstrapReference, job: __BuildArtifactPreprocessorJob(assignment, profile) };
}

/** Read the server-issued claim expiry and reject a malformed value before it controls task recovery. */
function _ClaimExpiry(expiresAt: string): number
{
	const expiry = new Date(expiresAt).getTime();
	if (!Number.isSafeInteger(expiry))
	{
		throw new WorkflowTaskTerminalError("PDF preprocessing claim has no usable expiry.");
	}
	return expiry;
}

/** Stop a stale delivery before it can create or release a workload under an expired claim. */
function _RequireActiveClaim(claimExpiry: number): void
{
	if (Date.now() >= claimExpiry)
	{
		throw new WorkflowTaskRetryableError("PDF preprocessing claim expired before it could create a worker Pod.");
	}
}

/** Sleeps once before another read for the first Pod of a released PDF preprocessing Job. */
async function _WaitForPod(context: ArtifactPreprocessTaskContext, milliseconds: number, claimExpiry: number): Promise<void>
{
	if (!Number.isSafeInteger(milliseconds) || milliseconds < 100 || milliseconds > 60_000)
		throw new Error("artifact preprocessing requires a 100-60000ms Pod wait");
	const now = Date.now();
	if (now >= claimExpiry)
	{
		throw new WorkflowTaskRetryableError("PDF preprocessing Job did not create a Pod before its claim expired.");
	}
	await context.sleepUntil(new Date(Math.min(now + milliseconds, claimExpiry)));
}

/** Convert an unavailable server or Kubernetes exchange into the task's declared retry policy. */
async function _RetryExternal<TResult>(operation: () => Promise<TResult>): Promise<TResult>
{
	try
	{
		return await operation();
	}
	catch (error)
	{
		if (error instanceof WorkflowTaskTerminalError || error instanceof WorkflowTaskRetryableError)
		{
			throw error;
		}
		throw new WorkflowTaskRetryableError("PDF preprocessing dependency is temporarily unavailable.");
	}
}

/**
 * Builds the unregistered controller task that binds one one-shot PDF preprocessing Job and applies its completion.
 *
 * No production composition registers this definition in the current tree. The tests exercise the
 * binding sequence without launching the current polling worker as a one-shot Job.
 *
 * @param options - Server authority, narrow Kubernetes port, deployment profile, and Pod delay.
 * @returns The shared task definition that binds one PDF preprocessing Job and applies its completion.
 * @see ArtifactPreprocessTaskDeclaration — owns the task name and retry policy.
 */
export function __CreateArtifactPreprocessHandler(options: ArtifactPreprocessHandlerOptions): IWorkflowTaskDefinition<ArtifactPreprocessTaskInput, ArtifactPreprocessTaskResult>
{
	return {
		...ArtifactPreprocessTaskDeclaration,
		async run(context, input): Promise<ArtifactPreprocessTaskResult>
		{
			// 1. Obtain the current server-issued claim so a stale task cannot choose another PDF or silo.
			const record = await context.checkpoint({ stepName: "claim-preprocess" }, async function _ClaimPreprocess()
			{
				const claimed = await _RetryExternal(async function _ClaimForTask()
				{
					return await options.authority.claimForTask(input.preprocessJobId, context.task);
				});
				if (claimed === null || claimed.siloId !== input.siloId || claimed.claim.workloadClass !== RuntimeWorkloadClaimClasses.ArtifactPreprocess)
					throw new WorkflowTaskTerminalError("PDF preprocessing is no longer available.");
				return claimed;
			});
			const claimExpiry = _ClaimExpiry(record.claim.expiresAt);
			_RequireActiveClaim(claimExpiry);

			// 2. Build or adopt the suspended Job, then bind its Kubernetes UID before any worker code runs.
			const prepared = await _Job(record, options.profile);
			const assigned = await context.checkpoint({ stepName: "ensure-suspended-job" }, async function _EnsureSuspendedJob(): Promise<V1Job>
			{
				return await _RetryExternal(async function _EnsureJob()
				{
					return await options.kubernetes.ensureSuspendedJob(prepared.job);
				});
			});
			const binding: RuntimeWorkloadBinding = { claimId: record.claim.claimId, claimedAt: record.claim.claimedAt, deliveryCount: record.claim.deliveryCount, profileName: record.claim.profileName, workloadUid: _JobUid(assigned) };
			await context.checkpoint({ stepName: "bind-workload" }, async function _BindWorkload(): Promise<void>
			{
				const command = { binding, bootstrapReference: prepared.bootstrapReference, namespace: options.profile.namespace };
				const outcome = await _RetryExternal(async function _BindWorkload()
				{
					return await options.authority.bindWorkload(record.preprocessJobId, context.task, command);
				});
				if (outcome === "conflict")
					throw new WorkflowTaskTerminalError("PDF preprocessing workload claim no longer matches.");
			});

			// 3. Release only the UID the server recorded, then wait for the first Pod that exact Job owns.
			await context.checkpoint({ stepName: "release-job" }, async function _ReleaseJob(): Promise<void>
			{
				await _RetryExternal(async function _ReleaseJob()
				{
					return await options.kubernetes.releaseJob(prepared.job, binding.workloadUid, record.claim.expiresAt);
				});
			});
			let pod: V1Pod | null = null;
			while (pod === null)
			{
				_RequireActiveClaim(claimExpiry);
				// 4. Read the changing Kubernetes state outside a checkpoint, because recording no Pod would replay that absence forever.
				pod = await _RetryExternal(async function _FindFirstPod()
				{
					return await options.kubernetes.findFirstPod(prepared.job, binding.workloadUid, options.profile.serviceAccountName);
				});
				if (pod === null)
					await _WaitForPod(context, options.podWaitMilliseconds, claimExpiry);
			}
			await context.checkpoint({ stepName: "bind-first-pod" }, async function _BindFirstPod(): Promise<void>
			{
				const command = { binding: { ...binding, firstPodUid: _PodUid(pod) } };
				const outcome = await _RetryExternal(async function _BindFirstPod()
				{
					return await options.authority.bindFirstPod(record.preprocessJobId, context.task, command);
				});
				if (outcome === "conflict")
					throw new WorkflowTaskTerminalError("PDF preprocessing Pod claim no longer matches.");
			});
			// 5. Wait for persisted worker evidence, then make this controller task the terminal writer.
			const event = await context.waitForEvent<unknown>(_COMPLETION_EVENT);
			const requestedCompletion = _Completion(event, record.preprocessJobId);
			const completion = await context.checkpoint({ stepName: "load-completion-inbox" }, async function _LoadCompletion(): Promise<ArtifactPreprocessCompletion>
			{
				const loaded = await _RetryExternal(async function _LoadCompletionFromServer()
				{
					return await options.authority.loadCompletion(record.preprocessJobId, requestedCompletion.completionDigest, context.task);
				});
				if (loaded === null)
				{
					throw new WorkflowTaskTerminalError("PDF preprocessing completion inbox is unavailable.");
				}
				return loaded;
			});
			await context.checkpoint({ stepName: "complete-preprocess" }, async function _CompletePreprocess(): Promise<void>
			{
				const outcome = await _RetryExternal(async function _CompleteOnServer()
				{
					return await options.authority.complete(record.preprocessJobId, completion, context.task);
				});
				if (outcome === "conflict")
				{
					throw new WorkflowTaskTerminalError("PDF preprocessing completion no longer matches.");
				}
			});
			return { preprocessJobId: record.preprocessJobId, completionDigest: completion.completionDigest };
		},
	};
}
