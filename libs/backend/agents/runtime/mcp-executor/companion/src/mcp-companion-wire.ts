import { McpCompanionCommandKinds, McpCompanionFailureCodes } from "./mcp-companion.types";
import type { McpCompanionClaimRequest, McpCompanionClaimResponse, McpCompanionCompletionRequest, McpCompanionDiscoveryResult, McpCompanionFailureRequest, McpCompanionInvocationResult, McpCompanionTerminalRequest } from "./mcp-companion-wire.types";
import { __ParseMcpExecutorDiscoveredTools, __ParseMcpExecutorToolCallResult } from "@opencrane/backend/agents/runtime/mcp-executor/protocol";

/** Parse the exact workload identity accepted by `POST /claim`. */
export function __ParseMcpCompanionClaimRequest(value: unknown): McpCompanionClaimRequest
{
	if (!_Record(value) || !_ExactKeys(value, ["executionReference", "podUid"]) || !_Coordinate(value["executionReference"], 256) || !_Coordinate(value["podUid"], 128))
		throw new Error("MCP companion claim request had an invalid shape");
	return { executionReference: value["executionReference"], podUid: value["podUid"] };
}

/** Parse one current, strictly shaped discovery or invocation claim response. */
export function __ParseMcpCompanionClaimResponse(value: unknown, now: Date = new Date()): McpCompanionClaimResponse
{
	if (!_Record(value))
		throw new Error("MCP companion claim response had an invalid shape");
	const lease = _Lease(value, now);
	if (value["kind"] === McpCompanionCommandKinds.Discovery && _ExactKeys(value, ["kind", "executionId", "claimFence", "expiresAt"]))
		return { kind: McpCompanionCommandKinds.Discovery, ...lease };
	if (value["kind"] === McpCompanionCommandKinds.Invocation && _ExactKeys(value, ["kind", "executionId", "claimFence", "expiresAt", "invocationId", "toolName", "arguments"]) && _Coordinate(value["invocationId"], 256) && _Coordinate(value["toolName"], 128) && _JsonValue(value["arguments"]))
		return { kind: McpCompanionCommandKinds.Invocation, ...lease, invocationId: value["invocationId"], toolName: value["toolName"], arguments: value["arguments"] };
	throw new Error("MCP companion claim response had an invalid shape");
}

/** Parse the exact checked completion accepted by `POST /complete`. */
export function __ParseMcpCompanionCompletionRequest(value: unknown): McpCompanionCompletionRequest
{
	if (!_Record(value) || !_ExactKeys(value, ["executionReference", "podUid", "executionId", "claimFence", "completion"]))
		throw new Error("MCP companion completion request had an invalid shape");
	const terminal = _Terminal(value);
	const completion = _Completion(value["completion"]);
	return { ...terminal, completion };
}

/** Parse the exact stable failure accepted by `POST /fail`. */
export function __ParseMcpCompanionFailureRequest(value: unknown): McpCompanionFailureRequest
{
	if (!_Record(value) || !_ExactKeys(value, ["executionReference", "podUid", "executionId", "claimFence", "failureCode"]))
		throw new Error("MCP companion failure request had an invalid shape");
	const terminal = _Terminal(value);
	const failureCode = value["failureCode"];
	if (!Object.values(McpCompanionFailureCodes).includes(failureCode as McpCompanionFailureCodes))
		throw new Error("MCP companion failure request had an invalid shape");
	return { ...terminal, failureCode: failureCode as McpCompanionFailureCodes };
}

/** Parse current lease fields shared by both claim variants. */
function _Lease(value: Record<string, unknown>, now: Date): { readonly executionId: string; readonly claimFence: string; readonly expiresAt: string }
{
	if (!_Coordinate(value["executionId"], 256) || !_Coordinate(value["claimFence"], 256) || typeof value["expiresAt"] !== "string")
		throw new Error("MCP companion claim lease had an invalid shape");
	const expiresAt = Date.parse(value["expiresAt"]);
	if (Number.isNaN(now.getTime()) || !Number.isFinite(expiresAt) || expiresAt <= now.getTime())
		throw new Error("MCP companion claim lease was expired");
	return { executionId: value["executionId"], claimFence: value["claimFence"], expiresAt: value["expiresAt"] };
}

/** Parse coordinates shared by completion and failure requests. */
function _Terminal(value: Record<string, unknown>): McpCompanionTerminalRequest
{
	if (!_Coordinate(value["executionReference"], 256) || !_Coordinate(value["podUid"], 128) || !_Coordinate(value["executionId"], 256) || !_Coordinate(value["claimFence"], 256))
		throw new Error("MCP companion terminal request had an invalid shape");
	return { executionReference: value["executionReference"], podUid: value["podUid"], executionId: value["executionId"], claimFence: value["claimFence"] };
}

/** Parse checked discovery or invocation completion data. */
function _Completion(value: unknown): McpCompanionDiscoveryResult | McpCompanionInvocationResult
{
	if (!_Record(value))
		throw new Error("MCP companion completion data had an invalid shape");
	try
	{
		if (value["kind"] === McpCompanionCommandKinds.Discovery && _ExactKeys(value, ["kind", "tools"]))
			return { kind: McpCompanionCommandKinds.Discovery, tools: __ParseMcpExecutorDiscoveredTools(value["tools"]) };
		if (value["kind"] === McpCompanionCommandKinds.Invocation && _ExactKeys(value, ["kind", "result"]))
			return { kind: McpCompanionCommandKinds.Invocation, result: __ParseMcpExecutorToolCallResult(value["result"]) };
	}
	catch {}
	throw new Error("MCP companion completion data had an invalid shape");
}

/** Accept one non-array JSON object. */
function _Record(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Require an object to contain exactly the named properties. */
function _ExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean
{
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every(function _Matches(key, index) { return key === expected[index]; });
}


/** Accept one bounded non-empty coordinate without control characters. */
function _Coordinate(value: unknown, maximumLength: number): value is string
{
	return typeof value === "string" && value.length > 0 && value.length <= maximumLength && !/[\u0000-\u001f\u007f]/u.test(value);
}

/** Validate JSON iteratively with explicit depth and node ceilings. */
function _JsonValue(value: unknown): value is import("@opencrane/util").JsonValue
{
	const pending: { readonly value: unknown; readonly depth: number }[] = [{ value, depth: 0 }];
	let nodes = 0;
	while (pending.length > 0)
	{
		const current = pending.pop();
		if (current === undefined)
			break;
		nodes += 1;
		if (nodes > 100_000 || current.depth > 64)
			return false;
		if (current.value === null || typeof current.value === "string" || typeof current.value === "boolean")
			continue;
		if (typeof current.value === "number")
		{
			if (!Number.isFinite(current.value))
				return false;
			continue;
		}
		if (Array.isArray(current.value))
		{
			for (const child of current.value)
				pending.push({ value: child, depth: current.depth + 1 });
			continue;
		}
		if (_Record(current.value))
		{
			for (const child of Object.values(current.value))
				pending.push({ value: child, depth: current.depth + 1 });
			continue;
		}
		return false;
	}
	return true;
}
