import Ajv from "ajv";

import type { JsonValue } from "@opencrane/util";

import type { McpTaskInputRequest, McpTaskInputResponse } from "./mcp-task.types";

/** Stored task fields required to reconstruct the provider arguments. */
interface McpTaskArgumentSource
{
	/** Original provider arguments saved with the task. */
	readonly arguments: unknown;
	/** Optional input request saved before the task paused. */
	readonly inputRequest: unknown;
	/** Optional response that satisfies the saved request. */
	readonly inputResponse: unknown;
}

/** Parse a stored input request or fail closed when its shape drifted. */
export function _McpTaskInputRequest(value: unknown): McpTaskInputRequest | null
{
	if (value === null)
		return null;
	if (!_JsonObject(value))
		throw new Error("MCP task input request is invalid");
	if (typeof value.requestId !== "string" || typeof value.message !== "string" || typeof value.argumentName !== "string")
		throw new Error("MCP task input request is invalid");
	return { requestId: value.requestId, message: value.message, argumentName: value.argumentName };
}

/** Parse a stored input response or fail closed when its shape drifted. */
export function _McpTaskInputResponse(value: unknown): McpTaskInputResponse | null
{
	if (value === null)
		return null;
	if (!_JsonObject(value) || typeof value.requestId !== "string" || !("value" in value))
		throw new Error("MCP task input response is invalid");
	return { requestId: value.requestId, value: value.value as JsonValue };
}

/** Return true when arguments satisfy the discovered JSON Schema. */
export function _McpTaskArgumentsAreValid(schema: unknown, value: JsonValue): boolean
{
	try
	{
		const ajv = new Ajv({ allErrors: false, strict: true });
		const validator = ajv.compile(schema as object);
		return validator(value);
	}
	catch
	{
		return false;
	}
}

/** Apply the saved top-level response without changing the original arguments. */
export function _McpTaskEffectiveArguments(task: McpTaskArgumentSource): JsonValue | null
{
	const request = _McpTaskInputRequest(task.inputRequest);
	const response = _McpTaskInputResponse(task.inputResponse);
	if (request === null)
		return task.arguments as JsonValue;
	if (response === null || !_JsonObject(task.arguments))
		return null;
	return { ...task.arguments, [request.argumentName]: response.value } as JsonValue;
}

/** Narrow unknown JSON to an object with named fields. */
function _JsonObject(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
