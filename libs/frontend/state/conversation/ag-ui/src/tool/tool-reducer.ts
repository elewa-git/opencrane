import type { AgUiStreamState } from "../ag-ui-stream.types.js";
import { AgUiRunStatuses } from "../run/run.types.js";
import { AgUiToolStatuses } from "./tool.types.js";
import { _IsToolFailure, _IsToolRecoveryRequired } from "./tool.validator.js";

/** Create a new requested tool call from its start frame. */
export function _StartTool(state: AgUiStreamState, toolCallId: string, name: string): AgUiStreamState
{
	return { ...state, tools: { ...state.tools, [toolCallId]: { id: toolCallId, name, arguments: "", status: AgUiToolStatuses.Requested, result: null, failureCode: null, failures: [], recovery: null } } };
}

/** Append tool arguments only after the matching start frame. */
export function _AppendToolArguments(state: AgUiStreamState, toolCallId: string, delta: string): AgUiStreamState
{
	const tool = state.tools[toolCallId];
	if (tool === undefined || tool.status !== AgUiToolStatuses.Requested) throw new Error("AG-UI tool arguments have no active tool call");
	return { ...state, tools: { ...state.tools, [toolCallId]: { ...tool, arguments: tool.arguments + delta } } };
}

/** Mark a known tool call complete, or Recovered if it failed earlier; leave it alone if recovery is still open. */
export function _CompleteTool(state: AgUiStreamState, toolCallId: string): AgUiStreamState
{
	const tool = state.tools[toolCallId];
	if (tool === undefined) throw new Error("AG-UI tool end has no active tool call");
	if (tool.status === AgUiToolStatuses.NeedsRecovery || tool.recovery !== null) return state;
	const status = tool.failures.length === 0 && tool.recovery === null ? AgUiToolStatuses.Completed : AgUiToolStatuses.Recovered;
	return { ...state, tools: { ...state.tools, [toolCallId]: { ...tool, status } } };
}

/** Attach the result to a known tool call, unless it is still waiting on recovery. */
export function _ResultTool(state: AgUiStreamState, toolCallId: string, content: string): AgUiStreamState
{
	const tool = state.tools[toolCallId];
	if (tool === undefined) throw new Error("AG-UI tool result has no known tool call");
	if (tool.status === AgUiToolStatuses.NeedsRecovery || tool.recovery !== null) return state;
	const status = tool.failures.length === 0 && tool.recovery === null ? AgUiToolStatuses.Completed : AgUiToolStatuses.Recovered;
	return { ...state, tools: { ...state.tools, [toolCallId]: { ...tool, status, result: content } } };
}

/** Mark a known tool call failed, keeping only the failure code the server chose. */
export function _ToolFailure(state: AgUiStreamState, value: unknown, name: string): AgUiStreamState
{
	if (!_IsToolFailure(value)) throw new Error("AG-UI tool failure is invalid");
	const tool = state.tools[value.toolCallId];
	if (tool === undefined) throw new Error("AG-UI tool failure has no known tool call");
	const failureCode = value.failureCode ?? null;
	const failed = { ...tool, status: AgUiToolStatuses.Failed, failureCode, failures: [...tool.failures, { code: failureCode, retrying: value.retrying, technicalDetails: value.technicalDetails }] };
	return { ...state, tools: { ...state.tools, [value.toolCallId]: failed }, customEvents: [...state.customEvents, name] };
}

/** Stop the run and mark it NeedsRecovery, so an unclear provider outcome is shown as neither a failure nor a request for input. */
export function _ToolRecoveryRequired(state: AgUiStreamState, value: unknown, name: string): AgUiStreamState
{
	if (!_IsToolRecoveryRequired(value)) throw new Error("AG-UI tool recovery requirement is invalid");
	if (state.runId === null || value.runId !== state.runId) throw new Error("AG-UI tool recovery requirement does not match the active run");
	if (state.runStatus !== AgUiRunStatuses.Running && state.runStatus !== AgUiRunStatuses.Interrupted) throw new Error("AG-UI tool recovery requirement has no recoverable active run");
	const tool = state.tools[value.toolCallId];
	if (tool === undefined) throw new Error("AG-UI tool recovery requirement has no known tool call");
	const recoveryTool = { ...tool, status: AgUiToolStatuses.NeedsRecovery, recovery: value };
	return { ...state, runStatus: AgUiRunStatuses.NeedsRecovery, runFailure: null, runRecovery: value, interrupts: [], tools: { ...state.tools, [value.toolCallId]: recoveryTool }, customEvents: [...state.customEvents, name] };
}
