import { __ParseAgentRunWorkflowBindingOutcome, __ParseAgentRunWorkflowControllerRecord, __ParseAgentRunWorkflowDeletionOutcome, __ParseAgentRunWorkflowObservation, __ParseAgentRunWorkflowReplacementOutcome, __ParseAgentRunWorkflowUnreservedCancellationOutcome, type AgentRunTaskInput, type AgentRunWarmRuntimeActivationCommand, type AgentRunWarmRuntimeControllerAuthority, type AgentRunWarmRuntimeDeletionCommand, type AgentRunWarmRuntimeDeletionOutcome, type AgentRunWarmRuntimeReadinessCommand, type AgentRunWarmRuntimeReplacementOutcome, type AgentRunWarmRuntimeReservationCommand, type AgentRunWarmRuntimeUnreservedCancellationOutcome, type AgentRunWorkflowControllerRecord, type AgentRunWorkflowObservation } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import type { ControllerExchangeOptions } from "@opencrane/backend/agents/runtime/workloads/controller-transport";
import { __CreateControllerExchange } from "@opencrane/backend/agents/runtime/workloads/controller-transport";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

/** Adapt one null-returning contract parser into the throwing validator the transport requires. */
function _Contract<T>(parser: (value: unknown) => T | null): (value: unknown) => T
{
	return function _Parse(value: unknown): T
	{
		const parsed = parser(value);
		if (parsed === null)
		{
			throw new Error("OpenCrane AgentRun workflow response did not match its contract");
		}
		return parsed;
	};
}

/**
 * Creates the controller HTTP adapter for the one-shot warm AgentRun lifecycle.
 *
 * The shared controller transport pins the same-silo Service origin, reads the rotating projected
 * token, and bounds every response; this adapter owns only the AgentRun workflow routes and the
 * contract parsers it shares with the server.
 *
 * Called by: `apps/agent-controller/src/index.ts` when it registers the warm AgentRun handler.
 * @param options - Same-silo origin, projected-token path, timeout, shutdown signal, and test seams.
 * @returns The authority through which the handler reserves, binds, replaces, and deletes warm Pods.
 * @see __CreateControllerExchange for the shared transport boundary.
 */
export function __CreateHttpWarmAgentRunWorkflowControllerAuthority(options: ControllerExchangeOptions): AgentRunWarmRuntimeControllerAuthority
{
	const transport = __CreateControllerExchange("AgentRun workflow", options);

	async function _Binding(path: string, input: AgentRunTaskInput, task: IWorkflowTaskReceipt, command: AgentRunWarmRuntimeReservationCommand | AgentRunWarmRuntimeActivationCommand | AgentRunWarmRuntimeReadinessCommand | AgentRunWarmRuntimeDeletionCommand): Promise<"bound" | "idempotent" | "conflict">
	{
		return await transport.exchange({ path: `/api/internal/agent-controller/agent-run-workflows/${path}`, method: "POST", body: { input, task, command }, conflict: "conflict" as const, failure: "warm AgentRun binding", parse: _Contract(__ParseAgentRunWorkflowBindingOutcome) });
	}

	return {
		async loadForTask(input, task): Promise<AgentRunWorkflowControllerRecord | null>
		{
			return await transport.exchange({ path: "/api/internal/agent-controller/agent-run-workflows/load", method: "POST", body: { input, task }, conflict: null, failure: "warm AgentRun load", parse: _Contract(__ParseAgentRunWorkflowControllerRecord) });
		},
		async reserveWarmPod(input, task, command) { return await _Binding("warm-reservation", input, task, command); },
		async recordWarmProfileActivation(input, task, command) { return await _Binding("warm-activation", input, task, command); },
		async recordWarmReadiness(input, task, command) { return await _Binding("warm-readiness", input, task, command); },
		async requestWarmPodDeletion(input, task, command) { return await _Binding("warm-delete-request", input, task, command); },
		async recordWarmPodDeleted(input, task, command): Promise<AgentRunWarmRuntimeDeletionOutcome>
		{
			return await transport.exchange({ path: "/api/internal/agent-controller/agent-run-workflows/warm-deleted", method: "POST", body: { input, task, command }, conflict: "conflict" as const, failure: "warm AgentRun deletion", parse: _Contract(__ParseAgentRunWorkflowDeletionOutcome) });
		},
		async prepareWarmRuntimeReplacement(input, task, command): Promise<AgentRunWarmRuntimeReplacementOutcome>
		{
			return await transport.exchange({ path: "/api/internal/agent-controller/agent-run-workflows/warm-replacement", method: "POST", body: { input, task, command }, conflict: "conflict" as const, failure: "warm AgentRun replacement", parse: _Contract(__ParseAgentRunWorkflowReplacementOutcome) });
		},
		async finalizeCancellationWithoutWarmReservation(input, task): Promise<AgentRunWarmRuntimeUnreservedCancellationOutcome>
		{
			return await transport.exchange({ path: "/api/internal/agent-controller/agent-run-workflows/warm-unreserved-cancellation", method: "POST", body: { input, task }, conflict: "conflict" as const, failure: "warm AgentRun unreserved cancellation", parse: _Contract(__ParseAgentRunWorkflowUnreservedCancellationOutcome) });
		},
		async terminalizeFailedTask(input, task): Promise<void>
		{
			await transport.exchange<void>({ path: "/api/internal/agent-controller/agent-run-workflows/terminal-failure", method: "POST", body: { input, task }, noContent: undefined, failure: "warm AgentRun terminal failure", parse: function _RejectBody(): void { throw new Error("OpenCrane warm AgentRun terminal failure returned an unexpected body"); } });
		},
		async observe(input, task): Promise<AgentRunWorkflowObservation>
		{
			return await transport.exchange({ path: "/api/internal/agent-controller/agent-run-workflows/observe", method: "POST", body: { input, task }, failure: "warm AgentRun observation", parse: _Contract(__ParseAgentRunWorkflowObservation) });
		},
	};
}
