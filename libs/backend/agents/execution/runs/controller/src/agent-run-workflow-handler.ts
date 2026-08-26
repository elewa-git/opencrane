import type { V1Job, V1Pod } from "@kubernetes/client-node";

import { AgentRunTaskDeclaration, AgentRunTaskTerminalStates } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import type { AgentRunTaskInput, AgentRunTaskResult, AgentRunWorkflowControllerRecord, AgentRunWorkflowObservation } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import { _AgentRuntimeAttemptKeySecretName, _BuildAgentRuntimeAttemptKeySecret } from "@opencrane/backend/agents/runtime/controller";
import { __BuildSuspendedAgentRuntimeJob } from "@opencrane/backend/agents/runtime/k8s-launcher";
import { WorkflowTaskRetryableError, WorkflowTaskTerminalError } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowTaskDefinition } from "@opencrane/backend/server/infra/workflows/contract";

import type { AgentRunWorkflowHandlerOptions } from "./agent-run-workflow-handler.types";

/** Returns the immutable UID Kubernetes assigned to the suspended Job. */
function _JobUid(job: V1Job): string
{
	const uid = job.metadata?.uid?.trim();
	if (!uid)
	{
		throw new WorkflowTaskTerminalError("Kubernetes did not return an immutable UID for the runtime Job.");
	}
	return uid;
}

/** Returns the immutable UID Kubernetes assigned to the first Job-owned Pod. */
function _PodUid(pod: V1Pod): string
{
	const uid = pod.metadata?.uid?.trim();
	if (!uid)
	{
		throw new WorkflowTaskTerminalError("Kubernetes did not return an immutable UID for the runtime Pod.");
	}
	return uid;
}

/** Suspends through the workflow engine instead of recording a transient missing Pod as task state. */
async function _Wait(context: Parameters<IWorkflowTaskDefinition<AgentRunTaskInput, AgentRunTaskResult>["run"]>[0], milliseconds: number): Promise<void>
{
	if (!Number.isSafeInteger(milliseconds) || milliseconds < 100 || milliseconds > 60_000)
	{
		throw new Error("AgentRun workflow requires a 100-60000ms polling interval.");
	}
	await context.sleepUntil(new Date(Date.now() + milliseconds));
}

/** Preserves declared task failures and makes other dependency failures use the task retry policy. */
async function _RetryExternal<TResult>(operation: () => Promise<TResult>): Promise<TResult>
{
	try
	{
		return await operation();
	}
	catch (error)
	{
		if (error instanceof WorkflowTaskRetryableError || error instanceof WorkflowTaskTerminalError)
		{
			throw error;
		}
		throw new WorkflowTaskRetryableError("AgentRun workflow dependency is temporarily unavailable.");
	}
}

/** Resolves the server-selected profile and refuses a cross-namespace Job. */
function _Profile(record: AgentRunWorkflowControllerRecord, options: AgentRunWorkflowHandlerOptions)
{
	const profile = options.profiles[record.workloadProfile];
	if (!profile || profile.namespace !== record.namespace || profile.serverNamespace === record.namespace)
	{
		throw new WorkflowTaskTerminalError("AgentRun workflow does not match its fixed runtime profile.");
	}
	return profile;
}

/** Maps a server-owned task observation to the task's public terminal result. */
function _TerminalResult(input: AgentRunTaskInput, observation: AgentRunWorkflowObservation): AgentRunTaskResult | null
{
	if (observation === "completed")
	{
		return { runId: input.runId, attempt: input.attempt, terminalState: AgentRunTaskTerminalStates.Completed };
	}
	if (observation === "failed")
	{
		return { runId: input.runId, attempt: input.attempt, terminalState: AgentRunTaskTerminalStates.Failed };
	}
	if (observation === "cancelled" || observation === "stale")
	{
		return { runId: input.runId, attempt: input.attempt, terminalState: AgentRunTaskTerminalStates.Cancelled };
	}
	return null;
}

/**
 * Creates the saved-task executor for one AgentRun attempt.
 *
 * The handler creates or adopts the suspended Job, creates its Job-owned model-key Secret without
 * checkpointing that key, records the Job and first Pod through the server, and waits for the
 * server-owned terminal state. It reloads authority after every restart, so a cancelled or retried
 * attempt cannot reuse facts from an earlier handler run.
 *
 * @param options - Provides the server authority, restricted Kubernetes adapter, profiles, and delay.
 * @returns The controller-hosted definition for the task admitted with the AgentRun transaction.
 * @throws WorkflowTaskTerminalError when the task no longer matches current server or Kubernetes identity.
 * @throws WorkflowTaskRetryableError when a controller dependency is temporarily unavailable.
 * @see AgentRunTaskDeclaration for the shared task name and retry policy.
 */
export function __CreateAgentRunWorkflowHandler(options: AgentRunWorkflowHandlerOptions): IWorkflowTaskDefinition<AgentRunTaskInput, AgentRunTaskResult>
{
	return {
		...AgentRunTaskDeclaration,
		async run(context, input): Promise<AgentRunTaskResult>
		{
			// 1. Read mutable authority outside a checkpoint, because cancellation and retry must take effect after a restart.
			const record = await _RetryExternal(async function _LoadForTask() { return await options.authority.loadForTask(input, context.task); });
			if (record === null || record.siloId !== input.siloId || record.runId !== input.runId || record.attempt !== input.attempt)
			{
				return { runId: input.runId, attempt: input.attempt, terminalState: AgentRunTaskTerminalStates.Cancelled };
			}
			const profile = _Profile(record, options);
			const assignment = { runId: record.runId, attempt: record.attempt, agentServiceId: record.agentServiceId, agentRevisionId: record.agentRevisionId, siloId: record.siloId, namespace: record.namespace, bootstrapReference: record.bootstrapReference, litellmKeySecretName: _AgentRuntimeAttemptKeySecretName(record.bootstrapReference) };
			const job = __BuildSuspendedAgentRuntimeJob(assignment, profile);

			// 2. Keep the Job suspended until the server records its Kubernetes UID and bootstrap reference.
			const assigned = await context.checkpoint({ stepName: "ensure-suspended-job" }, async function _EnsureSuspendedJob(): Promise<V1Job>
			{
				return await _RetryExternal(async function _EnsureJob() { return await options.kubernetes.ensureSuspendedJob(job); });
			});
			const workloadUid = _JobUid(assigned);
			const attemptKey = await _RetryExternal(async function _MintAttemptKey() { return await options.authority.mintAttemptKey(input, context.task); });
			if (attemptKey === null)
			{
				throw new WorkflowTaskTerminalError("AgentRun attempt is no longer available.");
			}
			await _RetryExternal(async function _EnsureAttemptKeySecret(): Promise<void>
			{
				await options.kubernetes.ensureAttemptKeySecret(_BuildAgentRuntimeAttemptKeySecret(assigned, workloadUid, assignment.litellmKeySecretName, attemptKey.key));
			});
			await context.checkpoint({ stepName: "bind-assignment" }, async function _BindAssignment(): Promise<void>
			{
				const outcome = await _RetryExternal(async function _Bind() { return await options.authority.bindAssignment(input, context.task, { workloadUid, workloadProfile: record.workloadProfile, serviceAccountName: profile.serviceAccountName }); });
				if (outcome === "conflict")
				{
					throw new WorkflowTaskTerminalError("AgentRun assignment no longer matches the saved task.");
				}
			});

			// 3. Take a fresh server fence before release, so cancellation wins before Kubernetes starts the Job.
			const releaseClaim = await _RetryExternal(async function _ClaimRelease() { return await options.authority.claimRelease(input, context.task, workloadUid); });
			if (releaseClaim === null)
			{
				return { runId: input.runId, attempt: input.attempt, terminalState: AgentRunTaskTerminalStates.Cancelled };
			}
			await context.checkpoint({ stepName: "release-job" }, async function _ReleaseJob(): Promise<void>
			{
				await _RetryExternal(async function _Release() { return await options.kubernetes.releaseJob(job, workloadUid, record.assignmentExpiresAt, releaseClaim.expiresAt); });
			});
			let pod: V1Pod | null = null;
			while (pod === null)
			{
				pod = await _RetryExternal(async function _FindPod() { return await options.kubernetes.findFirstPod(job, workloadUid, profile.serviceAccountName); });
				if (pod === null)
				{
					await _Wait(context, options.pollIntervalMilliseconds);
				}
			}
			await context.checkpoint({ stepName: "bind-first-pod" }, async function _BindFirstPod(): Promise<void>
			{
				const outcome = await _RetryExternal(async function _Bind() { return await options.authority.bindFirstPod(input, context.task, { workloadUid, podUid: _PodUid(pod) }); });
				if (outcome === "conflict")
				{
					throw new WorkflowTaskTerminalError("AgentRun first Pod no longer matches the saved task.");
				}
			});

			// 4. Poll server-owned lifecycle state; task checkpoints never make runtime terminal decisions.
			while (true)
			{
				const terminal = _TerminalResult(input, await _RetryExternal(async function _Observe() { return await options.authority.observe(input, context.task); }));
				if (terminal !== null)
				{
					return terminal;
				}
				await _Wait(context, options.pollIntervalMilliseconds);
			}
		},
	};
}
