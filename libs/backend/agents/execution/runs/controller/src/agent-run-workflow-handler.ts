import type { V1Job, V1Pod } from "@kubernetes/client-node";

import { AgentRunTaskDeclaration, AgentRunTaskTerminalStates } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import type { AgentRunTaskInput, AgentRunTaskResult, AgentRunWorkflowAttemptKey, AgentRunWorkflowControllerRecord, AgentRunWorkflowObservation } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import { _AgentRuntimeAttemptKeySecretName, _BuildAgentRuntimeAttemptKeySecret } from "@opencrane/backend/agents/runtime/controller";
import { __BuildSuspendedAgentRuntimeJob } from "@opencrane/backend/agents/runtime/k8s-launcher";
import { WorkflowTaskRetryableError, WorkflowTaskTerminalError } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowTaskContext, IWorkflowTaskDefinition } from "@opencrane/backend/server/infra/workflows/contract";

import type { AgentRunWorkflowHandlerOptions } from "./agent-run-workflow-handler.types";

/** Returns the immutable UID Kubernetes assigned to the suspended Job. */
function _jobUid(job: V1Job): string
{
	const uid = job.metadata?.uid?.trim();
	if (!uid)
	{
		throw new WorkflowTaskTerminalError("Kubernetes did not return an immutable UID for the runtime Job.");
	}
	return uid;
}

/** Returns the immutable UID Kubernetes assigned to the first Job-owned Pod. */
function _podUid(pod: V1Pod): string
{
	const uid = pod.metadata?.uid?.trim();
	if (!uid)
	{
		throw new WorkflowTaskTerminalError("Kubernetes did not return an immutable UID for the runtime Pod.");
	}
	return uid;
}

/** Suspends through the workflow engine so polling waits can continue after a controller restart. */
async function _wait(context: IWorkflowTaskContext, milliseconds: number): Promise<void>
{
	if (!Number.isSafeInteger(milliseconds) || milliseconds < 100 || milliseconds > 60_000)
	{
		throw new Error("AgentRun workflow requires a 100-60000ms polling interval.");
	}
	await context.sleepUntil(new Date(Date.now() + milliseconds));
}

/** Preserves declared task failures and makes other dependency failures use the task retry policy. */
async function _retryExternal<TResult>(operation: () => Promise<TResult>): Promise<TResult>
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

/** Rejects a server record unless its profile keeps the Job in the deployment-owned runtime namespace. */
function _profile(record: AgentRunWorkflowControllerRecord, options: AgentRunWorkflowHandlerOptions)
{
	const profile = options.profiles[record.workloadProfile];
	if (!profile || profile.namespace !== record.namespace || profile.serverNamespace === record.namespace)
	{
		throw new WorkflowTaskTerminalError("AgentRun workflow does not match its fixed runtime profile.");
	}
	return profile;
}

/** Maps a server-owned task observation to the task's public terminal result. */
function _terminalResult(input: AgentRunTaskInput, observation: AgentRunWorkflowObservation): AgentRunTaskResult | null
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

/** Tracks whether later workflow steps must revoke the key this handler minted. */
function _cleanupState()
{
	return {
		attemptKeyMustBeRevoked: false,
		attemptKey: null as AgentRunWorkflowAttemptKey | null,
		released: false,
	};
}

/** Returns the public cancellation result for a stale or fenced AgentRun attempt. */
function _cancelledResult(input: AgentRunTaskInput): AgentRunTaskResult
{
	return { runId: input.runId, attempt: input.attempt, terminalState: AgentRunTaskTerminalStates.Cancelled };
}

/** Reloads mutable server authority so a restarted task cannot reuse an earlier attempt record. */
async function _loadCurrentAttempt(options: AgentRunWorkflowHandlerOptions, context: IWorkflowTaskContext, input: AgentRunTaskInput): Promise<AgentRunWorkflowControllerRecord | null>
{
	const record = await _retryExternal(async function _loadForTask() { return await options.authority.loadForTask(input, context.task); });
	if (record === null || record.siloId !== input.siloId || record.runId !== input.runId || record.attempt !== input.attempt)
	{
		return null;
	}
	return record;
}

/** Builds the suspended Job from the server record and its deployment-owned profile. */
function _buildSuspendedJob(record: AgentRunWorkflowControllerRecord, options: AgentRunWorkflowHandlerOptions): { readonly job: V1Job; readonly profile: ReturnType<typeof _profile> }
{
	const profile = _profile(record, options);
	const assignment = { runId: record.runId, attempt: record.attempt, agentServiceId: record.agentServiceId, agentRevisionId: record.agentRevisionId, siloId: record.siloId, namespace: record.namespace, bootstrapReference: record.bootstrapReference, litellmKeySecretName: _AgentRuntimeAttemptKeySecretName(record.bootstrapReference) };
	const job = __BuildSuspendedAgentRuntimeJob(assignment, profile);
	return { job, profile };
}

/** Sends the minted key for revocation without putting its raw value in a workflow checkpoint. */
async function _revokeAttemptKey(options: AgentRunWorkflowHandlerOptions, context: IWorkflowTaskContext, input: AgentRunTaskInput, attemptKey: AgentRunWorkflowAttemptKey): Promise<void>
{
	await _retryExternal(async function _revokeKey(): Promise<void>
	{
		await options.authority.revokeAttemptKey(input, context.task, attemptKey);
	});
}

/** Revokes the key only after this handler created the Secret that now owns it. */
async function _revokeAttemptKeyIfRequired(options: AgentRunWorkflowHandlerOptions, context: IWorkflowTaskContext, input: AgentRunTaskInput, state: ReturnType<typeof _cleanupState>): Promise<void>
{
	if (!state.attemptKeyMustBeRevoked || state.attemptKey === null)
	{
		return;
	}
	await _revokeAttemptKey(options, context, input, state.attemptKey);
}

/** Creates or adopts the suspended Job, installs its key, and binds the server assignment. */
async function _ensureAndBindSuspendedAssignment(options: AgentRunWorkflowHandlerOptions, context: IWorkflowTaskContext, input: AgentRunTaskInput, record: AgentRunWorkflowControllerRecord, job: V1Job, profile: ReturnType<typeof _profile>, state: ReturnType<typeof _cleanupState>): Promise<string>
{
	// 1. Adopt only the exact suspended Job before any runtime code can start.
	const assigned = await context.checkpoint({ stepName: "ensure-suspended-job" }, async function _ensureSuspendedJob(): Promise<V1Job>
	{
		return await _retryExternal(async function _ensureJob() { return await options.kubernetes.ensureSuspendedJob(job); });
	});
	const workloadUid = _jobUid(assigned);

	// 2. Mint the transient key outside checkpoints because workflow state must never retain the secret value.
	state.attemptKey = await _retryExternal(async function _mintAttemptKey() { return await options.authority.mintAttemptKey(input, context.task); });
	if (state.attemptKey === null)
	{
		throw new WorkflowTaskTerminalError("AgentRun attempt is no longer available.");
	}
	const attemptKey = state.attemptKey;
	const secret = _BuildAgentRuntimeAttemptKeySecret(assigned, workloadUid, _AgentRuntimeAttemptKeySecretName(record.bootstrapReference), attemptKey.key);
	const secretOutcome = await _retryExternal(async function _ensureAttemptKeySecret(): Promise<"created" | "alreadyExists">
	{
		return await options.kubernetes.ensureAttemptKeySecret(secret);
	});
	state.attemptKeyMustBeRevoked = secretOutcome === "created";
	if (!state.attemptKeyMustBeRevoked)
	{
		await _revokeAttemptKey(options, context, input, attemptKey);
	}

	// 3. Bind the Kubernetes UID before the later release fence may start the Job.
	await context.checkpoint({ stepName: "bind-assignment" }, async function _bindAssignmentCheckpoint(): Promise<void>
	{
		const command = { workloadUid, workloadProfile: record.workloadProfile, serviceAccountName: profile.serviceAccountName };
		const outcome = await _retryExternal(async function _bindAssignment() { return await options.authority.bindAssignment(input, context.task, command); });
		if (outcome === "conflict")
		{
			await _revokeAttemptKeyIfRequired(options, context, input, state);
			throw new WorkflowTaskTerminalError("AgentRun assignment no longer matches the saved task.");
		}
	});
	return workloadUid;
}

/** Starts the bound Job only when a fresh server release fence still permits it. */
async function _claimAndReleaseJob(options: AgentRunWorkflowHandlerOptions, context: IWorkflowTaskContext, input: AgentRunTaskInput, record: AgentRunWorkflowControllerRecord, job: V1Job, workloadUid: string, state: ReturnType<typeof _cleanupState>): Promise<boolean>
{
	const releaseClaim = await _retryExternal(async function _claimRelease() { return await options.authority.claimRelease(input, context.task, workloadUid); });
	if (releaseClaim === null)
	{
		await _revokeAttemptKeyIfRequired(options, context, input, state);
		return false;
	}
	await context.checkpoint({ stepName: "release-job" }, async function _releaseJobCheckpoint(): Promise<void>
	{
		await _retryExternal(async function _releaseJob() { return await options.kubernetes.releaseJob(job, workloadUid, record.assignmentExpiresAt, releaseClaim.expiresAt); });
	});
	state.released = true;
	return true;
}

/** Waits for the first Pod owned by the bound Job and records its Kubernetes UID through the server. */
async function _waitForAndBindFirstPod(options: AgentRunWorkflowHandlerOptions, context: IWorkflowTaskContext, input: AgentRunTaskInput, job: V1Job, workloadUid: string, profile: ReturnType<typeof _profile>): Promise<void>
{
	let pod: V1Pod | null = null;
	while (pod === null)
	{
		pod = await _retryExternal(async function _findPod() { return await options.kubernetes.findFirstPod(job, workloadUid, profile.serviceAccountName); });
		if (pod === null)
		{
			await _wait(context, options.pollIntervalMilliseconds);
		}
	}
	const firstPod = pod;
	await context.checkpoint({ stepName: "bind-first-pod" }, async function _bindFirstPodCheckpoint(): Promise<void>
	{
		const command = { workloadUid, podUid: _podUid(firstPod) };
		const outcome = await _retryExternal(async function _bindFirstPod() { return await options.authority.bindFirstPod(input, context.task, command); });
		if (outcome === "conflict")
		{
			throw new WorkflowTaskTerminalError("AgentRun first Pod no longer matches the saved task.");
		}
	});
}

/** Polls server-owned lifecycle state and revokes the key for every non-completed terminal result. */
async function _waitForTerminalResult(options: AgentRunWorkflowHandlerOptions, context: IWorkflowTaskContext, input: AgentRunTaskInput, state: ReturnType<typeof _cleanupState>): Promise<AgentRunTaskResult>
{
	while (true)
	{
		const observation = await _retryExternal(async function _observe() { return await options.authority.observe(input, context.task); });
		const terminal = _terminalResult(input, observation);
		if (terminal !== null)
		{
			if (terminal.terminalState !== AgentRunTaskTerminalStates.Completed)
			{
				await _revokeAttemptKeyIfRequired(options, context, input, state);
			}
			return terminal;
		}
		await _wait(context, options.pollIntervalMilliseconds);
	}
}

/** Runs the named AgentRun steps while leaving lifecycle authority with the server. */
async function _executeAgentRunTask(options: AgentRunWorkflowHandlerOptions, context: IWorkflowTaskContext, input: AgentRunTaskInput, state: ReturnType<typeof _cleanupState>): Promise<AgentRunTaskResult>
{
	// 1. Reload current authority so cancellation and retry take effect after a restart.
	const record = await _loadCurrentAttempt(options, context, input);
	if (record === null)
	{
		// Ask the server to fail and clean up any live run still owned by this receipt. Its receipt
		// fence makes this a no-op when cancellation or a newer attempt already ended our authority.
		await _retryExternal(async function _TerminalizeUnavailableAttempt(): Promise<void>
		{
			await options.authority.terminalizeFailedTask(input, context.task);
		});
		return _cancelledResult(input);
	}

	// 2. Keep the Job suspended until Kubernetes identity and the transient key are bound.
	const prepared = _buildSuspendedJob(record, options);
	const workloadUid = await _ensureAndBindSuspendedAssignment(options, context, input, record, prepared.job, prepared.profile, state);

	// 3. Take a fresh server fence before allowing Kubernetes to start the Job.
	const released = await _claimAndReleaseJob(options, context, input, record, prepared.job, workloadUid, state);
	if (!released)
	{
		return _cancelledResult(input);
	}

	// 4. Bind the first Pod so later runtime traffic stays fenced to one Kubernetes identity.
	await _waitForAndBindFirstPod(options, context, input, prepared.job, workloadUid, prepared.profile);

	// 5. Poll server-owned lifecycle state because checkpoints never decide the runtime outcome.
	return await _waitForTerminalResult(options, context, input, state);
}

/** Executes one task and applies terminal cleanup without changing retryable failure semantics. */
async function _runAgentRunTask(options: AgentRunWorkflowHandlerOptions, context: IWorkflowTaskContext, input: AgentRunTaskInput): Promise<AgentRunTaskResult>
{
	const state = _cleanupState();
	try
	{
		return await _executeAgentRunTask(options, context, input, state);
	}
	catch (error)
	{
		if (error instanceof WorkflowTaskTerminalError)
		{
			if (state.released)
			{
				await _revokeAttemptKeyIfRequired(options, context, input, state);
			}
			await _retryExternal(async function _terminalize() { await options.authority.terminalizeFailedTask(input, context.task); });
		}
		throw error;
	}
}

/**
 * Creates the saved-task executor for one AgentRun attempt.
 *
 * The returned task creates or adopts the suspended Job, installs its Job-owned model-key Secret
 * without checkpointing the raw key, records the Job and first Pod through the server, and waits for
 * the server-owned terminal state. It reloads the server record for every delivery, so cancellation
 * and retry decisions take effect instead of replaying an earlier record.
 *
 * Called by: `apps/agent-controller/src/index.ts` when it registers the control-plane task queue.
 * @param options - Provides the server authority, restricted Kubernetes adapter, profiles, and delay.
 * @returns The controller-hosted definition whose `run` method returns the server's terminal result,
 * or throws a terminal or retryable task error when setup cannot continue.
 * @see AgentRunTaskDeclaration for the shared task name and retry policy.
 */
export function __CreateAgentRunWorkflowHandler(options: AgentRunWorkflowHandlerOptions): IWorkflowTaskDefinition<AgentRunTaskInput, AgentRunTaskResult>
{
	return {
		...AgentRunTaskDeclaration,
		async run(context, input): Promise<AgentRunTaskResult>
		{
			return await _runAgentRunTask(options, context, input);
		},
	};
}
