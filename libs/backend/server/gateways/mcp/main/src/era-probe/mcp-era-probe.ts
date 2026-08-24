import { createHash } from "node:crypto";

import { WorkflowTaskRetryableError, WorkflowTaskRetryBackoffKinds, WorkflowTaskTerminalError } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowTransaction, IWorkflowTaskContext } from "@opencrane/backend/server/infra/workflows/contract";

import type { McpEraProbeTargetRecord, McpOperatorServerRecord, McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";
import { McpEraProbeTaskNames } from "./mcp-era-probe.types";
import type { McpEraProbeAdmission, McpEraProbeObservation, McpEraProbeTaskInput, McpEraProbeTaskResult, McpEraProbeWorkflow, McpEraProbeWorkflowOptions } from "./mcp-era-probe.types";
import { McpEraProbeFailure, McpEraProbeFailureCodes } from "./mcp-era-probe-failure";
import { __McpEraProbeObservationResult, __McpEraProbeReplayResult, __McpEraProbeTerminalResult, __McpEraProbeTransition, McpEraProbeActions, McpEraProbeEvents, McpEraProbeStates } from "./mcp-era-probe-state";
import { __AssertMcpEraProbeTaskInput, __ParseMcpEraProbeObservation } from "./mcp-era-probe.validator";

/** Total external checks allowed before the catalogue records a final unavailable result. */
const MCP_ERA_PROBE_MAXIMUM_ATTEMPTS = 5;

/** Load the product-owned endpoint and reject a task whose registration was replaced. */
async function _LoadTarget(unitOfWork: McpOperatorUnitOfWork, input: McpEraProbeTaskInput): Promise<McpEraProbeTargetRecord>
{
	return await unitOfWork.execute(async function _Load(transaction): Promise<McpEraProbeTargetRecord>
	{
		const target = await transaction.mcp.loadEraProbeTarget(input.siloId, input.serverId);
		if (!target || target.registrationDigest !== input.registrationDigest)
		{
			throw new WorkflowTaskTerminalError("MCP era-probe registration is unavailable.");
		}
		return target;
	});
}

/** Map a complete server row back to the fields interpreted by the protocol-check state owner. */
function _TargetFromServer(server: McpOperatorServerRecord): McpEraProbeTargetRecord
{
	return { endpoint: server.endpoint, registrationDigest: server.registrationDigest ?? "", eraProbeStatus: server.eraProbeStatus, eraProtocolVersion: server.eraProtocolVersion, eraProbeEvidenceDigest: server.eraProbeEvidenceDigest, eraProbeFailureCode: server.eraProbeFailureCode, eraProbeAttempts: server.eraProbeAttempts };
}

/** Store one result and verify that an earlier retry did not record different evidence. */
async function _RecordResult(unitOfWork: McpOperatorUnitOfWork, input: McpEraProbeTaskInput, result: McpEraProbeTaskResult): Promise<McpEraProbeTaskResult>
{
	return await unitOfWork.execute(async function _Record(transaction): Promise<McpEraProbeTaskResult>
	{
		const write = await transaction.mcp.recordEraProbeResult(input.siloId, input.serverId, input.registrationDigest, result);
		if (!write)
		{
			throw new WorkflowTaskTerminalError("MCP era-probe registration is unavailable.");
		}
		let winner: McpEraProbeTaskResult | null;
		try
		{
			winner = __McpEraProbeReplayResult(_TargetFromServer(write.server));
		}
		catch { throw new WorkflowTaskTerminalError("MCP era-probe stored winner is invalid."); }
		if (!winner)
			throw new WorkflowTaskTerminalError("MCP era-probe stored winner is unavailable.");
		if (write.changed)
		{
			await transaction.mcp.appendAudit("Updated", `McpServer/${input.serverId}`, `MCP server era probe ${result.decision}`);
		}
		return winner;
	});
}

/** Record a temporary failure and return the final result when the retry budget is exhausted. */
async function _RecordRetry(unitOfWork: McpOperatorUnitOfWork, input: McpEraProbeTaskInput, attempt: number): Promise<McpEraProbeTaskResult | null>
{
	const exhaustedResult = __McpEraProbeTerminalResult(McpEraProbeFailureCodes.RetryExhausted);
	return await unitOfWork.execute(async function _WriteRetry(transaction): Promise<McpEraProbeTaskResult | null>
	{
		const retry = await transaction.mcp.recordEraProbeRetry(input.siloId, input.serverId, input.registrationDigest, attempt, MCP_ERA_PROBE_MAXIMUM_ATTEMPTS, exhaustedResult);
		if (!retry)
			throw new WorkflowTaskTerminalError("MCP era-probe registration is unavailable.");
		let stored: McpEraProbeTaskResult | null;
		try { stored = __McpEraProbeReplayResult(_TargetFromServer(retry.server)); }
		catch { throw new WorkflowTaskTerminalError("MCP era-probe stored retry state is invalid."); }
		if (retry.exhausted && !stored)
			throw new WorkflowTaskTerminalError("MCP era-probe exhausted result is unavailable.");
		if (retry.exhausted && retry.changed)
			await transaction.mcp.appendAudit("Updated", `McpServer/${input.serverId}`, "MCP server era probe retry limit exhausted");
		return stored;
	});
}

/** Run one remote check and record its product decision through replay-safe checkpoints. */
async function _Run(context: IWorkflowTaskContext, options: McpEraProbeWorkflowOptions, input: McpEraProbeTaskInput): Promise<McpEraProbeTaskResult>
{
	const target = await _LoadTarget(options.unitOfWork, input);
	let completed: McpEraProbeTaskResult | null;
	try { completed = __McpEraProbeReplayResult(target); }
	catch { throw new WorkflowTaskTerminalError("MCP era-probe stored result is invalid."); }
	if (completed)
		return completed;

	const result = await context.checkpoint({ stepName: "discover-server" }, async function _Discover(): Promise<McpEraProbeTaskResult>
	{
		try
		{
			return __McpEraProbeObservationResult(__ParseMcpEraProbeObservation(await options.probe.probe({ endpoint: target.endpoint })));
		}
		catch (error)
		{
			if (!(error instanceof McpEraProbeFailure))
				throw error;
			if (error.code === McpEraProbeFailureCodes.RetryableUnavailable)
			{
				const action = __McpEraProbeTransition(McpEraProbeStates.Pending, McpEraProbeEvents.RetryableFailure);
				if (action !== McpEraProbeActions.Retry)
					throw new WorkflowTaskTerminalError("MCP era-probe retry policy is invalid.");
				const exhausted = await _RecordRetry(options.unitOfWork, input, context.attempt);
				if (exhausted)
					return exhausted;
				throw new WorkflowTaskRetryableError("MCP server protocol check is temporarily unavailable.");
			}
			return __McpEraProbeTerminalResult(error.code);
		}
	});
	return await context.checkpoint({ stepName: "record-decision" }, async function _Record(): Promise<McpEraProbeTaskResult>
	{
		return await _RecordResult(options.unitOfWork, input, result);
	});
}

/** Derive a stable task key without exposing silo or server identifiers in engine diagnostics. */
export function __McpEraProbeTaskKey(input: McpEraProbeTaskInput): string
{
	__AssertMcpEraProbeTaskInput(input);
	const digest = createHash("sha256").update(JSON.stringify([input.siloId, input.serverId, input.registrationDigest])).digest("hex");
	return `workflows:mcp-era-probe:${digest}`;
}

/** Register the MCP era-probe task and return its transaction-bound admission API. */
export function __CreateMcpEraProbeWorkflow(options: McpEraProbeWorkflowOptions): McpEraProbeWorkflow
{
	options.execution.register({
		taskName: McpEraProbeTaskNames.Probe,
		retryPolicy: { maximumAttempts: MCP_ERA_PROBE_MAXIMUM_ATTEMPTS, backoff: { kind: WorkflowTaskRetryBackoffKinds.Exponential, initialDelaySeconds: 30, multiplier: 2, maximumDelaySeconds: 300 } },
		async run(context: IWorkflowTaskContext, input: McpEraProbeTaskInput): Promise<McpEraProbeTaskResult>
		{
			__AssertMcpEraProbeTaskInput(input);
			return await _Run(context, options, input);
		},
	});

	return {
		async admit(transaction: IWorkflowTransaction, input: McpEraProbeTaskInput): Promise<McpEraProbeAdmission>
		{
			const taskKey = __McpEraProbeTaskKey(input);
			const receipt = await options.execution.spawn(transaction, { taskName: McpEraProbeTaskNames.Probe, idempotencyKey: taskKey, input });
			return { taskKey, receipt };
		},
	};
}
