import { AgentRunTaskDeclaration, AgentRunTaskTerminalStates, type AgentRunTaskInput, type AgentRunTaskResult, type AgentRunWarmRuntimeDeletionCommand, type AgentRunWorkflowObservation } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import type { WarmRuntimePodCandidate, WarmRuntimePoolProfile } from "@opencrane/backend/agents/runtime/k8s-launcher";
import { WorkflowTaskRetryableError, WorkflowTaskTerminalError, type IWorkflowTaskContext, type IWorkflowTaskDefinition } from "@opencrane/backend/server/infra/workflows/contract";

import type { WarmAgentRunWorkflowHandlerOptions } from "./warm-agent-run-workflow-handler.types";

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

/** Reserves the first candidate that wins the database uniqueness fence. */
async function _Reserve(options: WarmAgentRunWorkflowHandlerOptions, context: IWorkflowTaskContext, input: AgentRunTaskInput, profileName: string, profile: WarmRuntimePoolProfile): Promise<WarmRuntimePodCandidate>
{
	while (true)
	{
		const candidates = [...await _Retry(async function _List() { return await options.kubernetes.listGenericPods(profile); })].sort(function _ByName(left, right) { return left.podName.localeCompare(right.podName); });
		for (const candidate of candidates)
		{
			const command = { workloadProfile: profileName, deploymentName: profile.deploymentName, deploymentUid: candidate.deploymentUid, podName: candidate.podName, podUid: candidate.podUid, podResourceVersion: candidate.resourceVersion, genericProfile: profile.genericProfile, claimedProfile: profile.claimedProfile, serviceAccountName: profile.serviceAccountName };
			const outcome = await _Retry(async function _ReserveCandidate() { return await options.authority.reserveWarmPod(input, context.task, command); });
			if (outcome !== "conflict")
			{
				return candidate;
			}
		}
		await _Wait(context, options.pollIntervalMilliseconds);
	}
}

/** Activates one database-reserved Pod and saves the exact patch result. */
async function _Activate(options: WarmAgentRunWorkflowHandlerOptions, context: IWorkflowTaskContext, input: AgentRunTaskInput, profile: WarmRuntimePoolProfile, candidate: WarmRuntimePodCandidate)
{
	return await context.checkpoint({ stepName: "activate-warm-profile" }, async function _ActivateCheckpoint()
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
async function _ProveReadiness(options: WarmAgentRunWorkflowHandlerOptions, context: IWorkflowTaskContext, input: AgentRunTaskInput, profile: WarmRuntimePoolProfile, candidate: WarmRuntimePodCandidate, activation: Awaited<ReturnType<typeof _Activate>>): Promise<void>
{
	await context.checkpoint({ stepName: "prove-warm-readiness" }, async function _Readiness(): Promise<void>
	{
		const evidence = await _Retry(async function _Probe() { return await options.kubernetes.proveReadiness(candidate, activation, profile); });
		const outcome = await _Retry(async function _Record() { return await options.authority.recordWarmReadiness(input, context.task, evidence); });
		if (outcome === "conflict")
		{
			throw new WorkflowTaskTerminalError("warm AgentRun readiness lost its reservation");
		}
	});
}

/** Waits for the server-owned AgentRun state to become terminal. */
async function _WaitForTerminal(options: WarmAgentRunWorkflowHandlerOptions, context: IWorkflowTaskContext, input: AgentRunTaskInput): Promise<AgentRunTaskResult>
{
	while (true)
	{
		const observation = await _Retry(async function _Observe() { return await options.authority.observe(input, context.task); });
		const terminal = _Terminal(input, observation);
		if (terminal !== null)
		{
			return terminal;
		}
		await _Wait(context, options.pollIntervalMilliseconds);
	}
}

/** Deletes the exact used Pod after saving one-way deletion intent. */
async function _Delete(options: WarmAgentRunWorkflowHandlerOptions, context: IWorkflowTaskContext, input: AgentRunTaskInput, profile: WarmRuntimePoolProfile, candidate: WarmRuntimePodCandidate, activated: boolean): Promise<void>
{
	const command: AgentRunWarmRuntimeDeletionCommand = { podName: candidate.podName, podUid: candidate.podUid, deploymentUid: candidate.deploymentUid, profile: activated ? profile.claimedProfile : profile.genericProfile };
	const requested = await _Retry(async function _Request() { return await options.authority.requestWarmPodDeletion(input, context.task, command); });
	if (requested === "conflict")
	{
		throw new WorkflowTaskTerminalError("warm AgentRun deletion lost its saved Pod identity");
	}
	await context.checkpoint({ stepName: "delete-used-warm-pod" }, async function _DeleteCheckpoint(): Promise<void>
	{
		await _Retry(async function _DeletePod() { await options.kubernetes.deletePod({ namespace: profile.namespace, podName: candidate.podName, podUid: candidate.podUid, deploymentUid: candidate.deploymentUid, profile: command.profile }, profile); });
		const recorded = await _Retry(async function _Record() { return await options.authority.recordWarmPodDeleted(input, context.task, command); });
		if (recorded === "conflict")
		{
			throw new WorkflowTaskTerminalError("warm AgentRun deletion could not be recorded");
		}
	});
}

/** Runs one complete warm claim and never returns its Pod to the generic pool. */
async function _Run(options: WarmAgentRunWorkflowHandlerOptions, context: IWorkflowTaskContext, input: AgentRunTaskInput): Promise<AgentRunTaskResult>
{
	const record = await _Retry(async function _Load() { return await options.authority.loadForTask(input, context.task); });
	if (record === null)
	{
		await options.authority.terminalizeFailedTask(input, context.task);
		return { runId: input.runId, attempt: input.attempt, terminalState: AgentRunTaskTerminalStates.Cancelled };
	}
	const profile = options.profiles[record.workloadProfile];
	if (profile === undefined || profile.namespace !== record.namespace)
	{
		throw new WorkflowTaskTerminalError("warm AgentRun has no matching deployment-owned pool profile");
	}
	const candidate = await context.checkpoint({ stepName: "reserve-generic-warm-pod" }, async function _ReserveCheckpoint() { return await _Reserve(options, context, input, record.workloadProfile, profile); });
	let activated = false;
	try
	{
		const activation = await _Activate(options, context, input, profile, candidate);
		activated = true;
		await _ProveReadiness(options, context, input, profile, candidate, activation);
		return await _WaitForTerminal(options, context, input);
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
		await _Delete(options, context, input, profile, candidate, activated);
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
