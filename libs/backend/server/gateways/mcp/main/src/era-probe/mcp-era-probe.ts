import { createHash } from "node:crypto";
import { z } from "zod";

import { DurableTaskRetryableError, DurableTaskTerminalError } from "@opencrane/backend/server/infra/workflows/contract";
import type { DurableExecutionTransaction, DurableTaskContext } from "@opencrane/backend/server/infra/workflows/contract";

import type { McpEraProbeTargetRecord, McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";
import { McpEraProbeTaskNames } from "./mcp-era-probe.types";
import type { McpEraProbeAdmission, McpEraProbeObservation, McpEraProbeTaskInput, McpEraProbeTaskResult, McpEraProbeWorkflow, McpEraProbeWorkflowOptions } from "./mcp-era-probe.types";
import { McpEraProbeFailure, McpEraProbeFailureCodes } from "./mcp-era-probe-failure";
import { __McpEraProbeObservationResult, __McpEraProbeReplayResult, __McpEraProbeTerminalResult, __McpEraProbeTransition, McpEraProbeActions, McpEraProbeEvents, McpEraProbeStates } from "./mcp-era-probe-state";

/** Check task input before it can select a catalogue row. */
const _TASK_INPUT_SCHEMA: z.ZodType<McpEraProbeTaskInput> = z.object({
	siloId: z.string().trim().min(1).max(128),
	serverId: z.string().trim().min(1).max(128),
	registrationDigest: z.string().trim().min(1).max(128),
}).strict();

/** Check the small discovery result that may be saved in task and product state. */
const _OBSERVATION_SCHEMA = z.object({
	protocolVersion: z.string().trim().min(1).max(64),
	evidenceDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u).transform(function _EvidenceDigest(value): `sha256:${string}` { return value as `sha256:${string}`; }),
}).strict();

/** Reject malformed task input without echoing its fields into worker diagnostics. */
function _AssertTaskInput(input: McpEraProbeTaskInput): void
{
	if (!_TASK_INPUT_SCHEMA.safeParse(input).success)
	{
		throw new DurableTaskTerminalError("MCP era-probe task input is invalid.");
	}
}

/** Reject malformed remote evidence before it reaches a checkpoint or catalogue row. */
function _Observation(value: McpEraProbeObservation): McpEraProbeObservation
{
	const parsed = _OBSERVATION_SCHEMA.safeParse(value);
	if (!parsed.success)
	{
		throw new DurableTaskTerminalError("MCP era-probe response is invalid.");
	}
	return parsed.data;
}

/** Load the product-owned endpoint and reject a task whose registration was replaced. */
async function _LoadTarget(unitOfWork: McpOperatorUnitOfWork, input: McpEraProbeTaskInput): Promise<McpEraProbeTargetRecord>
{
	return await unitOfWork.execute(async function _Load(transaction): Promise<McpEraProbeTargetRecord>
	{
		const target = await transaction.mcp.loadEraProbeTarget(input.siloId, input.serverId);
		if (!target || target.registrationDigest !== input.registrationDigest)
		{
			throw new DurableTaskTerminalError("MCP era-probe registration is unavailable.");
		}
		return target;
	});
}

/** Store one result and verify that an earlier retry did not record different evidence. */
async function _RecordResult(unitOfWork: McpOperatorUnitOfWork, input: McpEraProbeTaskInput, result: McpEraProbeTaskResult): Promise<McpEraProbeTaskResult>
{
	return await unitOfWork.execute(async function _Record(transaction): Promise<McpEraProbeTaskResult>
	{
		const write = await transaction.mcp.recordEraProbeResult(input.siloId, input.serverId, input.registrationDigest, result);
		if (!write)
		{
			throw new DurableTaskTerminalError("MCP era-probe registration is unavailable.");
		}
		let winner: McpEraProbeTaskResult | null;
		try
		{
			winner = __McpEraProbeReplayResult({ endpoint: write.server.endpoint, registrationDigest: write.server.registrationDigest ?? "", eraProbeStatus: write.server.eraProbeStatus, eraProtocolVersion: write.server.eraProtocolVersion, eraProbeEvidenceDigest: write.server.eraProbeEvidenceDigest, eraProbeFailureCode: write.server.eraProbeFailureCode });
		}
		catch { throw new DurableTaskTerminalError("MCP era-probe stored winner is invalid."); }
		if (!winner) throw new DurableTaskTerminalError("MCP era-probe stored winner is unavailable.");
		if (write.changed)
		{
			await transaction.mcp.appendAudit("Updated", `McpServer/${input.serverId}`, `MCP server era probe ${result.decision}`);
		}
		return winner;
	});
}

/** Run one remote check and record its product decision through replay-safe checkpoints. */
async function _Run(context: DurableTaskContext, options: McpEraProbeWorkflowOptions, input: McpEraProbeTaskInput): Promise<McpEraProbeTaskResult>
{
	const target = await _LoadTarget(options.unitOfWork, input);
	let completed: McpEraProbeTaskResult | null;
	try { completed = __McpEraProbeReplayResult(target); }
	catch { throw new DurableTaskTerminalError("MCP era-probe stored result is invalid."); }
	if (completed) return completed;

	const result = await context.checkpoint({ stepName: "discover-server" }, async function _Discover(): Promise<McpEraProbeTaskResult>
	{
		try
		{
			return __McpEraProbeObservationResult(_Observation(await options.probe.probe({ endpoint: target.endpoint })));
		}
		catch (error)
		{
			if (!(error instanceof McpEraProbeFailure)) throw error;
			if (error.code === McpEraProbeFailureCodes.RetryableUnavailable)
			{
				const action = __McpEraProbeTransition(McpEraProbeStates.Pending, McpEraProbeEvents.RetryableFailure);
				if (action !== McpEraProbeActions.Retry) throw new DurableTaskTerminalError("MCP era-probe retry policy is invalid.");
				throw new DurableTaskRetryableError("MCP server protocol check is temporarily unavailable.");
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
	_AssertTaskInput(input);
	const digest = createHash("sha256").update(JSON.stringify([input.siloId, input.serverId, input.registrationDigest])).digest("hex");
	return `workflows:mcp-era-probe:${digest}`;
}

/** Register the MCP era-probe task and return its transaction-bound admission API. */
export function __CreateMcpEraProbeWorkflow(options: McpEraProbeWorkflowOptions): McpEraProbeWorkflow
{
	options.execution.register({
		taskName: McpEraProbeTaskNames.Probe,
		async run(context: DurableTaskContext, input: McpEraProbeTaskInput): Promise<McpEraProbeTaskResult>
		{
			_AssertTaskInput(input);
			return await _Run(context, options, input);
		},
	});

	return {
		async admit(transaction: DurableExecutionTransaction, input: McpEraProbeTaskInput): Promise<McpEraProbeAdmission>
		{
			const taskKey = __McpEraProbeTaskKey(input);
			const receipt = await options.execution.spawn(transaction, { taskName: McpEraProbeTaskNames.Probe, idempotencyKey: taskKey, input });
			return { taskKey, receipt };
		},
	};
}
