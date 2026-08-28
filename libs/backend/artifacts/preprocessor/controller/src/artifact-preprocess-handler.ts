import type { V1Job, V1Pod } from "@kubernetes/client-node";

import { __CreateArtifactPreprocessBootstrapReference } from "@opencrane/contracts";
import { __BuildArtifactPreprocessorJob } from "@opencrane/backend/artifacts/preprocessor/k8s-launcher";
import { __ArtifactPreprocessOutcomeEventName, ArtifactPreprocessOutcomeKinds, ArtifactPreprocessTaskDeclaration } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import type { ArtifactPreprocessControllerRecord, ArtifactPreprocessOutcome, ArtifactPreprocessOutcomeSignal, ArtifactPreprocessTaskInput } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import { RuntimeWorkloadClaimClasses } from "@opencrane/backend/agents/runtime/workloads/contract";
import type { RuntimeWorkloadBinding } from "@opencrane/backend/agents/runtime/workloads/contract";
import { WorkflowTaskRetryableError, WorkflowTaskTerminalError } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowTaskDefinition, IWorkflowTaskEvent } from "@opencrane/backend/server/infra/workflows/contract";

import type { ArtifactPreprocessCompletion, ArtifactPreprocessHandlerOptions, ArtifactPreprocessTaskContext, ArtifactPreprocessTaskResult } from "./artifact-preprocess-handler.types";

/** Reports that Kubernetes has not created the first Pod yet without saving that absence. */
class _ArtifactPreprocessPodNotReadyError extends Error
{
	/** Creates the private control-flow signal caught by the delivery polling loop. */
	constructor()
	{
		super("PDF preprocessing Job has not created its first Pod yet.");
		this.name = "ArtifactPreprocessPodNotReadyError";
	}
}

/** Reads a delivery identity from the private event and rejects another preprocessing job's event. */
function _OutcomeSignal(event: IWorkflowTaskEvent<unknown>, preprocessJobId: string, deliveryCount: number): ArtifactPreprocessOutcomeSignal
{
	const value = event.payload;
	if (typeof value !== "object" || value === null || Array.isArray(value))
	{
		throw new WorkflowTaskTerminalError("PDF preprocessing outcome event does not match its job.");
	}
	const payload = value as Readonly<Record<string, unknown>>;
	if (payload["preprocessJobId"] !== preprocessJobId || payload["deliveryCount"] !== deliveryCount)
	{
		throw new WorkflowTaskTerminalError("PDF preprocessing outcome event does not match its job.");
	}
	return { preprocessJobId, deliveryCount };
}

/** Requires the immutable UID Kubernetes assigned to a Job before it may be released. */
function _JobUid(job: V1Job): string
{
	const uid = job.metadata?.uid?.trim();
	if (!uid)
	{
		throw new WorkflowTaskTerminalError("Kubernetes did not return an immutable UID for the PDF preprocessing Job.");
	}
	return uid;
}

/** Requires the immutable UID Kubernetes assigned to the first Job-owned Pod. */
function _PodUid(pod: V1Pod): string
{
	const uid = pod.metadata?.uid?.trim();
	if (!uid)
	{
		throw new WorkflowTaskTerminalError("Kubernetes did not return an immutable UID for the PDF preprocessing Pod.");
	}
	return uid;
}

/** Builds the suspended Job and opaque bootstrap reference for the server-selected preprocessing record. */
async function _Job(record: ArtifactPreprocessControllerRecord, profile: ArtifactPreprocessHandlerOptions["profile"]): Promise<{ readonly bootstrapReference: string; readonly job: V1Job }>
{
	const bootstrapReference = await __CreateArtifactPreprocessBootstrapReference(record.preprocessJobId);
	const assignment = { preprocessJobId: record.preprocessJobId, siloId: record.siloId, namespace: profile.namespace, bootstrapReference };
	return { bootstrapReference, job: __BuildArtifactPreprocessorJob(assignment, profile) };
}

/** Reads the server-issued claim expiry and rejects a malformed value before it controls task recovery. */
function _ClaimExpiry(expiresAt: string): number
{
	const expiry = new Date(expiresAt).getTime();
	if (!Number.isSafeInteger(expiry))
	{
		throw new WorkflowTaskTerminalError("PDF preprocessing claim has no usable expiry.");
	}
	return expiry;
}

/** Stops a stale delivery before it can create or release a workload under an expired claim. */
function _RequireActiveClaim(claimExpiry: number): void
{
	if (Date.now() >= claimExpiry)
	{
		throw new WorkflowTaskRetryableError("PDF preprocessing claim expired before it could create a worker Pod.");
	}
}

/** Builds one stable checkpoint name for a delivery cycle within the long-lived workflow task. */
function _CheckpointName(cycle: number, stepName: string): string
{
	return `delivery-${cycle}:${stepName}`;
}

/** Reads the database-owned retry instant before it controls the next durable workflow sleep. */
function _RetryAt(value: string): Date
{
	const retryAt = new Date(value);
	if (Number.isNaN(retryAt.getTime()))
	{
		throw new WorkflowTaskTerminalError("PDF preprocessing retry outcome has no usable retry time.");
	}
	return retryAt;
}

/** Sleeps once before another read for the first Pod of a released PDF preprocessing Job. */
async function _WaitForPod(context: ArtifactPreprocessTaskContext, milliseconds: number, claimExpiry: number, stepName: string): Promise<void>
{
	if (!Number.isSafeInteger(milliseconds) || milliseconds < 100 || milliseconds > 60_000)
	{
		throw new Error("artifact preprocessing requires a 100-60000ms Pod wait");
	}
	const now = Date.now();
	if (now >= claimExpiry)
	{
		throw new WorkflowTaskRetryableError("PDF preprocessing Job did not create a Pod before its claim expired.");
	}
	await context.sleepUntil(new Date(Math.min(now + milliseconds, claimExpiry)), stepName);
}

/** Converts an unavailable server or Kubernetes exchange into the task's declared retry policy. */
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
 * Builds the controller task that binds one one-shot PDF preprocessing Job and applies its completion.
 *
 * Called by: `apps/agent-controller/src/index.ts`, which registers the task when the deployment
 * supplies an artifact-preprocessor profile.
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
			let cycle = 1;
			while (true)
			{
				// 1. Obtain this cycle's server-issued claim so replay cannot choose another PDF or silo.
				const record = await context.checkpoint({ stepName: _CheckpointName(cycle, "claim-preprocess") }, async function _ClaimPreprocess()
				{
					const claimed = await _RetryExternal(async function _ClaimForTask()
					{
						return await options.authority.claimForTask(input.preprocessJobId, context.task);
					});
					if (claimed === null || claimed.siloId !== input.siloId || claimed.claim.workloadClass !== RuntimeWorkloadClaimClasses.ArtifactPreprocess)
					{
						throw new WorkflowTaskTerminalError("PDF preprocessing is no longer available.");
					}
					return claimed;
				});
				const claimExpiry = _ClaimExpiry(record.claim.expiresAt);
				_RequireActiveClaim(claimExpiry);

				// 2. Build or adopt the suspended Job, then bind its Kubernetes UID before any worker code runs.
				const prepared = await _Job(record, options.profile);
				const assigned = await context.checkpoint({ stepName: _CheckpointName(cycle, "ensure-suspended-job") }, async function _EnsureSuspendedJob(): Promise<V1Job>
				{
					return await _RetryExternal(async function _EnsureJob()
					{
						return await options.kubernetes.ensureSuspendedJob(prepared.job);
					});
				});
				const binding: RuntimeWorkloadBinding = { claimId: record.claim.claimId, claimedAt: record.claim.claimedAt, deliveryCount: record.claim.deliveryCount, profileName: record.claim.profileName, workloadUid: _JobUid(assigned) };
				await context.checkpoint({ stepName: _CheckpointName(cycle, "bind-workload") }, async function _BindWorkload(): Promise<void>
				{
					const command = { binding, bootstrapReference: prepared.bootstrapReference, namespace: options.profile.namespace };
					const outcome = await _RetryExternal(async function _BindWorkload()
					{
						return await options.authority.bindWorkload(record.preprocessJobId, context.task, command);
					});
					if (outcome === "conflict")
					{
						throw new WorkflowTaskTerminalError("PDF preprocessing workload claim no longer matches.");
					}
				});

				// 3. Release only the UID the server recorded, then save the first Pod that exact Job owns.
				await context.checkpoint({ stepName: _CheckpointName(cycle, "release-job") }, async function _ReleaseJob(): Promise<void>
				{
					await _RetryExternal(async function _ReleaseJob()
					{
						return await options.kubernetes.releaseJob(prepared.job, binding.workloadUid, record.claim.expiresAt);
					});
				});
				let pod: V1Pod | null = null;
				let observation = 1;
				while (pod === null)
				{
					try
					{
						pod = await context.checkpoint({ stepName: _CheckpointName(cycle, "observe-first-pod") }, async function _ObserveFirstPod(): Promise<V1Pod>
						{
							_RequireActiveClaim(claimExpiry);
							const observed = await _RetryExternal(async function _FindFirstPod()
							{
								return await options.kubernetes.findFirstPod(prepared.job, binding.workloadUid, options.profile.serviceAccountName);
							});
							if (observed === null)
							{
								throw new _ArtifactPreprocessPodNotReadyError();
							}
							return observed;
						});
					}
					catch (error)
					{
						if (!(error instanceof _ArtifactPreprocessPodNotReadyError))
						{
							throw error;
						}
						await _WaitForPod(context, options.podWaitMilliseconds, claimExpiry, _CheckpointName(cycle, `wait-for-pod-${observation}`));
						observation += 1;
					}
				}
				await context.checkpoint({ stepName: _CheckpointName(cycle, "bind-first-pod") }, async function _BindFirstPod(): Promise<void>
				{
					const command = { binding: { ...binding, firstPodUid: _PodUid(pod) } };
					const outcome = await _RetryExternal(async function _BindFirstPod()
					{
						return await options.authority.bindFirstPod(record.preprocessJobId, context.task, command);
					});
					if (outcome === "conflict")
					{
						throw new WorkflowTaskTerminalError("PDF preprocessing Pod claim no longer matches.");
					}
				});

				// 4. Wait for a delivery-scoped wake-up, then reload the persisted outcome before cleanup.
				const event: IWorkflowTaskEvent<unknown> = await context.waitForEvent<unknown>(__ArtifactPreprocessOutcomeEventName(record.claim.deliveryCount));
				const signal = _OutcomeSignal(event, record.preprocessJobId, record.claim.deliveryCount);
				const outcome = await context.checkpoint({ stepName: _CheckpointName(cycle, "load-preprocess-outcome") }, async function _LoadOutcome(): Promise<ArtifactPreprocessOutcome>
				{
					const loaded = await _RetryExternal(async function _LoadOutcomeFromServer()
					{
						return await options.authority.loadOutcome(signal.preprocessJobId, signal.deliveryCount, context.task);
					});
					if (loaded === null)
					{
						throw new WorkflowTaskRetryableError("PDF preprocessing outcome is not visible yet.");
					}
					return loaded;
				});
				if (outcome.kind === ArtifactPreprocessOutcomeKinds.Completed)
				{
					await context.checkpoint({ stepName: _CheckpointName(cycle, "complete-preprocess") }, async function _CompletePreprocess(): Promise<void>
					{
						const completionOutcome = await _RetryExternal(async function _CompleteOnServer()
						{
							return await options.authority.complete(record.preprocessJobId, outcome, context.task);
						});
						if (completionOutcome === "conflict")
						{
							throw new WorkflowTaskTerminalError("PDF preprocessing completion no longer matches.");
						}
					});
				}

				// 5. A persisted outcome authorizes deletion; retry repeats the UID-fenced call after an ambiguous response.
				await context.checkpoint({ stepName: _CheckpointName(cycle, "delete-outcome-job") }, async function _DeleteOutcomeJob(): Promise<void>
				{
					await _RetryExternal(async function _DeleteOutcomeJob()
					{
						await options.kubernetes.deleteJob(prepared.job, binding.workloadUid);
					});
				});
				if (outcome.kind === ArtifactPreprocessOutcomeKinds.RetryableFailed)
				{
					// 6. Sleep without consuming an engine retry, then use new checkpoint names for the next delivery.
					await context.sleepUntil(_RetryAt(outcome.retryAt), _CheckpointName(cycle, "wait-for-retry"));
					cycle += 1;
					continue;
				}
				if (outcome.kind === ArtifactPreprocessOutcomeKinds.TerminalFailed)
				{
					throw new WorkflowTaskTerminalError("PDF preprocessing worker exhausted its delivery limit.");
				}
				return { preprocessJobId: record.preprocessJobId, completionDigest: outcome.completionDigest };
			}
		},
	};
}
