import { AgentRunTaskDeclaration, AgentRunTaskTerminalStates, type AgentRunTaskInput, type AgentRunTaskResult, type AgentRunWarmRuntimeDeletionCommand, type AgentRunWorkflowControllerRecord, type AgentRunWorkflowObservation } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import type { WarmRuntimePodCandidate, WarmRuntimePoolProfile } from "@opencrane/backend/agents/runtime/k8s-launcher";
import { WorkflowTaskRetryableError, WorkflowTaskTerminalError, type IWorkflowTaskContext, type IWorkflowTaskDefinition } from "@opencrane/backend/server/infra/workflows/contract";

import type { WarmAgentRunWorkflowHandlerOptions } from "./warm-agent-run-workflow-handler.types";

/** Carries either the Pod won by reservation or a terminal result observed while competing. */
type WarmReservationResult = WarmRuntimePodCandidate | AgentRunTaskResult;

/** Suspends through Absurd so a controller restart resumes the same saved task. */
async function _Wait(context: IWorkflowTaskContext, milliseconds: number): Promise<void>
{
	await context.sleepUntil(new Date(Date.now() + milliseconds));
}

/** Maps server-owned lifecycle state to the task's terminal result. */
function _Terminal(input: AgentRunTaskInput, observation: AgentRunWorkflowObservation): AgentRunTaskResult | null
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

/** Builds the terminal cancellation result after server authority commits its exact fence. */
function _Cancelled(input: AgentRunTaskInput): AgentRunTaskResult
{
	return { runId: input.runId, attempt: input.attempt, terminalState: AgentRunTaskTerminalStates.Cancelled };
}

/** Converts an unexpected dependency failure into the task's configured retry policy. */
async function _Retry<TResult>(operation: () => Promise<TResult>): Promise<TResult>
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
		throw new WorkflowTaskRetryableError("warm AgentRun dependency is temporarily unavailable");
	}
}

/** Finalizes cancellation only when the server proves that this attempt never reserved a warm Pod. */
async function _FinalizeUnreservedCancellation(options: WarmAgentRunWorkflowHandlerOptions, context: IWorkflowTaskContext, input: AgentRunTaskInput): Promise<AgentRunTaskResult | null>
{
	const outcome = await _Retry(async function _Finalize() { return await options.authority.finalizeCancellationWithoutWarmReservation(input, context.task); });
	if (outcome === "conflict")
	{
		throw new WorkflowTaskTerminalError("warm AgentRun cancellation lost its task fence");
	}
	if (outcome === "bound" || outcome === "idempotent")
	{
		return _Cancelled(input);
	}
	return null;
}

/** Reserves a candidate, or stops when cancellation wins before any reservation commits. */
async function _Reserve(options: WarmAgentRunWorkflowHandlerOptions, context: IWorkflowTaskContext, input: AgentRunTaskInput, record: AgentRunWorkflowControllerRecord, profile: WarmRuntimePoolProfile): Promise<WarmReservationResult>
{
	while (true)
	{
		const candidates = [...await _Retry(async function _List() { return await options.kubernetes.listGenericPods(profile); })].sort(function _ByName(left, right) { return left.podName.localeCompare(right.podName); });
		for (const candidate of candidates)
		{
			const command = { generation: record.bindingGeneration, workloadProfile: record.workloadProfile, deploymentName: profile.deploymentName, deploymentUid: candidate.deploymentUid, podName: candidate.podName, podUid: candidate.podUid, podResourceVersion: candidate.resourceVersion, genericProfile: profile.genericProfile, claimedProfile: profile.claimedProfile, serviceAccountName: profile.serviceAccountName };
			const outcome = await _Retry(async function _ReserveCandidate() { return await options.authority.reserveWarmPod(input, context.task, command); });
			if (outcome !== "conflict")
			{
				return candidate;
			}
		}
		const observation = await _Retry(async function _ObserveConflict() { return await options.authority.observe(input, context.task); });
		if (observation === "cancelling")
		{
			const cancelled = await _FinalizeUnreservedCancellation(options, context, input);
			if (cancelled !== null)
			{
				return cancelled;
			}
		}
		const terminal = _Terminal(input, observation);
		if (terminal !== null)
		{
			return terminal;
		}
		await _Wait(context, options.pollIntervalMilliseconds);
	}
}

/** Distinguishes a server-owned terminal result from a Kubernetes Pod candidate. */
function _IsTerminalReservation(result: WarmReservationResult): result is AgentRunTaskResult
{
	return "terminalState" in result;
}

/** Activates one database-reserved Pod and saves the exact patch result. */
async function _Activate(options: WarmAgentRunWorkflowHandlerOptions, context: IWorkflowTaskContext, input: AgentRunTaskInput, profile: WarmRuntimePoolProfile, candidate: WarmRuntimePodCandidate, generation: number)
{
	return await context.checkpoint({ stepName: `activate-warm-profile-${generation}` }, async function _ActivateCheckpoint()
	{
		const evidence = await _Retry(async function _Patch() { return await options.kubernetes.activateProfile(candidate, profile); });
		const outcome = await _Retry(async function _Record() { return await options.authority.recordWarmProfileActivation(input, context.task, evidence); });
		if (outcome === "conflict")
		{
			throw new WorkflowTaskTerminalError("warm AgentRun profile activation lost its reservation");
		}
		return evidence;
	});
}

/** Proves the activated Pod through its selected network path. */
async function _ProveReadiness(options: WarmAgentRunWorkflowHandlerOptions, context: IWorkflowTaskContext, input: AgentRunTaskInput, profile: WarmRuntimePoolProfile, candidate: WarmRuntimePodCandidate, activation: Awaited<ReturnType<typeof _Activate>>, generation: number): Promise<void>
{
	await context.checkpoint({ stepName: `prove-warm-readiness-${generation}` }, async function _Readiness(): Promise<void>
	{
		const evidence = await _Retry(async function _Probe() { return await options.kubernetes.proveReadiness(candidate, activation, profile); });
		const outcome = await _Retry(async function _Record() { return await options.authority.recordWarmReadiness(input, context.task, evidence); });
		if (outcome === "conflict")
		{
			throw new WorkflowTaskTerminalError("warm AgentRun readiness lost its reservation");
		}
	});
}

/** Stops on cancellation so the caller's finally block deletes the reserved Pod, or on a terminal run state. */
async function _WaitForTerminal(options: WarmAgentRunWorkflowHandlerOptions, context: IWorkflowTaskContext, input: AgentRunTaskInput, profile: WarmRuntimePoolProfile, candidate: WarmRuntimePodCandidate, generation: number): Promise<AgentRunTaskResult | "replace" | "recovery_required">
{
	while (true)
	{
		const observation = await _Retry(async function _Observe() { return await options.authority.observe(input, context.task); });
		if (observation === "cancelling")
		{
			return _Cancelled(input);
		}
		const terminal = _Terminal(input, observation);
		if (terminal !== null)
		{
			return terminal;
		}
		if (observation === "recovery_required")
		{
			return "recovery_required";
		}
		const pod = await _Retry(async function _ObservePod() { return await options.kubernetes.observeClaimedPod({ namespace: profile.namespace, podName: candidate.podName, podUid: candidate.podUid, deploymentUid: candidate.deploymentUid, profile: profile.claimedProfile }, profile); });
		if (pod !== "running")
		{
			const command: AgentRunWarmRuntimeDeletionCommand = { generation, podName: candidate.podName, podUid: candidate.podUid, deploymentUid: candidate.deploymentUid, profile: profile.claimedProfile };
			const recovery = await _Retry(async function _Prepare() { return await options.authority.prepareWarmRuntimeReplacement(input, context.task, command); });
			if (recovery === "conflict")
			{
				throw new WorkflowTaskTerminalError("warm AgentRun replacement lost its binding fence");
			}
			return recovery;
		}
		await _Wait(context, options.pollIntervalMilliseconds);
	}
}

/** Deletes the exact used Pod after saving one-way deletion intent. */
async function _Delete(options: WarmAgentRunWorkflowHandlerOptions, context: IWorkflowTaskContext, input: AgentRunTaskInput, profile: WarmRuntimePoolProfile, candidate: WarmRuntimePodCandidate, activated: boolean, generation: number): Promise<void>
{
	const command: AgentRunWarmRuntimeDeletionCommand = { generation, podName: candidate.podName, podUid: candidate.podUid, deploymentUid: candidate.deploymentUid, profile: activated ? profile.claimedProfile : profile.genericProfile };
	const requested = await _Retry(async function _Request() { return await options.authority.requestWarmPodDeletion(input, context.task, command); });
	if (requested === "conflict")
	{
		throw new WorkflowTaskTerminalError("warm AgentRun deletion lost its saved Pod identity");
	}
	await _CompleteDeletion(options, context, input, profile, command);
}

/** Replays the saved delete command before the workflow reserves another generation. */
async function _CompleteDeletion(options: WarmAgentRunWorkflowHandlerOptions, context: IWorkflowTaskContext, input: AgentRunTaskInput, profile: WarmRuntimePoolProfile, command: AgentRunWarmRuntimeDeletionCommand): Promise<void>
{
	await context.checkpoint({ stepName: `delete-used-warm-pod-${command.generation}` }, async function _DeleteCheckpoint(): Promise<void>
	{
		await _Retry(async function _DeletePod() { await options.kubernetes.deletePod({ namespace: profile.namespace, podName: command.podName, podUid: command.podUid, deploymentUid: command.deploymentUid, profile: command.profile }, profile); });
	});
	while (true)
	{
		const recorded = await _Retry(async function _Record() { return await options.authority.recordWarmPodDeleted(input, context.task, command); });
		if (recorded === "conflict")
		{
			throw new WorkflowTaskTerminalError("warm AgentRun deletion could not be recorded");
		}
		if (recorded !== "deferred")
		{
			return;
		}
		await _Wait(context, options.pollIntervalMilliseconds);
	}
}

/** Runs the saved AgentRun task through every Pod generation and deletes each used Pod instead of returning it to the generic pool. */
async function _Run(options: WarmAgentRunWorkflowHandlerOptions, context: IWorkflowTaskContext, input: AgentRunTaskInput): Promise<AgentRunTaskResult>
{
	while (true)
	{
		const record = await _Retry(async function _Load() { return await options.authority.loadForTask(input, context.task); });
		if (record === null)
		{
			await options.authority.terminalizeFailedTask(input, context.task);
			return { runId: input.runId, attempt: input.attempt, terminalState: AgentRunTaskTerminalStates.Cancelled };
		}
		const terminal = _Terminal(input, record.observation);
		if (terminal !== null)
		{
			return terminal;
		}
		if (record.observation === "recovery_required")
		{
			await _Wait(context, options.pollIntervalMilliseconds);
			continue;
		}
		const profile = options.profiles[record.workloadProfile];
		if (profile === undefined || profile.namespace !== record.namespace)
		{
			throw new WorkflowTaskTerminalError("warm AgentRun has no matching deployment-owned pool profile");
		}
		if (record.pendingDeletion !== undefined)
		{
			await _CompleteDeletion(options, context, input, profile, record.pendingDeletion);
			continue;
		}
		if (record.observation === "cancelling")
		{
			const cancelled = await _FinalizeUnreservedCancellation(options, context, input);
			if (cancelled !== null)
			{
				return cancelled;
			}
		}
		const generation = record.bindingGeneration;
		const reservation = await context.checkpoint({ stepName: `reserve-generic-warm-pod-${generation}` }, async function _ReserveCheckpoint() { return await _Reserve(options, context, input, record, profile); });
		if (_IsTerminalReservation(reservation))
		{
			return reservation;
		}
		const candidate = reservation;
		let activated = false;
		let outcome: AgentRunTaskResult | "replace" | "recovery_required";
		try
		{
			const activation = await _Activate(options, context, input, profile, candidate, generation);
			activated = true;
			await _ProveReadiness(options, context, input, profile, candidate, activation, generation);
			outcome = await _WaitForTerminal(options, context, input, profile, candidate, generation);
		}
		catch (error)
		{
			if (error instanceof WorkflowTaskTerminalError)
			{
				await options.authority.terminalizeFailedTask(input, context.task);
			}
			throw error;
		}
		finally
		{
			await _Delete(options, context, input, profile, candidate, activated, generation);
		}
		if (typeof outcome !== "string")
		{
			return outcome;
		}
	}
}

/** Creates the hard-cutoff warm AgentRun task handler. */
export function __CreateWarmAgentRunWorkflowHandler(options: WarmAgentRunWorkflowHandlerOptions): IWorkflowTaskDefinition<AgentRunTaskInput, AgentRunTaskResult>
{
	if (!Number.isSafeInteger(options.pollIntervalMilliseconds) || options.pollIntervalMilliseconds < 100 || options.pollIntervalMilliseconds > 5_000)
	{
		throw new Error("warm AgentRun polling must be between 100ms and 5s");
	}
	return { ...AgentRunTaskDeclaration, async run(context, input): Promise<AgentRunTaskResult> { return await _Run(options, context, input); } };
}
