import { ___ConversationModelContinuationSchema, ___ConversationModelResponseSchema, ConversationModelResponseKinds, ConversationModelToolModes, type CompiledToolDefinition, type ConversationModelRequest, type ConversationModelResponse } from "@opencrane/contracts";
import { ___CanonicalizeJson, ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { ConversationModelError, ConversationModelFailureCodes, type PreparedConversationModelRequest } from "./conversation-model.types";

/** Limits serialized request and response bodies independently to one mebibyte. */
export const _CONVERSATION_MODEL_MAX_BYTES = 1024 * 1024;

/** Checks a positive integer ceiling without coercing absent or malformed configuration. */
function _isPositiveInteger(value: unknown): value is number
{
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Identifies a JSON object without treating arrays as named protocol fields. */
function _isRecord(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks the frozen offer before either dispatch or continuation. Unique names prevent the model
 * from selecting an ambiguous revision, and the digest prevents a changed schema being offered.
 * These checks do not validate arguments or grant permission to execute a tool.
 */
function _offeredTools(tools: readonly CompiledToolDefinition[]): readonly CompiledToolDefinition[]
{
	if (!Array.isArray(tools) || tools.length > 128)
		throw new ConversationModelError(ConversationModelFailureCodes.InvalidRequest);
	const names = new Set<string>();
	const offered: CompiledToolDefinition[] = [];
	for (const tool of tools)
	{
		if (!tool || typeof tool.name !== "string" || !/^[A-Za-z0-9_-]{1,64}$/u.test(tool.name) || names.has(tool.name) || typeof tool.requiresApproval !== "boolean")
			throw new ConversationModelError(ConversationModelFailureCodes.InvalidRequest);
		names.add(tool.name);
		if (tool.requiresApproval)
			continue;
		if (typeof tool.description !== "string" || !_isRecord(tool.parametersSchema) || ___DigestCanonicalJson(tool.parametersSchema) !== tool.parametersSchemaDigest)
			throw new ConversationModelError(ConversationModelFailureCodes.InvalidRequest);
		offered.push(tool);
	}
	return offered;
}

/**
 * Serializes the frozen prompt plus an optional saved tool/result pair and applies admitted limits.
 * Credential coordinates come from server composition; compiled messages cannot alter transport.
 * @throws ConversationModelError before dispatch when inputs, continuation or bounds are unusable.
 */
export function _PrepareConversationModelRequest(input: ConversationModelRequest): PreparedConversationModelRequest
{
	try
	{
		const url = new URL(input.endpoint);
		const compiled = input.compiledInput;
		const ceilings = [compiled.model.maxOutputTokens, compiled.budget.maxCompletionTokens];
		if (!["http:", "https:"].includes(url.protocol) || url.username !== "" || url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== ""
			|| typeof input.key !== "string" || !/^[\x21-\x7e]{1,8192}$/.test(input.key)
			|| typeof input.modelAlias !== "string" || input.modelAlias.trim().length === 0 || input.modelAlias !== compiled.model.modelAlias
			|| !_isPositiveInteger(input.maxCompletionTokens) || !_isPositiveInteger(input.notAfterEpochMs)
			|| ceilings.some(value => value !== null && !_isPositiveInteger(value)) || ceilings.every(value => value === null)
			|| compiled.budget.maxModelTurns !== null && !_isPositiveInteger(compiled.budget.maxModelTurns)
			|| compiled.budget.wallClockDeadlineEpochMs !== null && !_isPositiveInteger(compiled.budget.wallClockDeadlineEpochMs)
			|| typeof compiled.instructions !== "string" || !Array.isArray(compiled.messages)
			|| input.tools !== ConversationModelToolModes.None && input.tools !== ConversationModelToolModes.Select
			|| input.continuation !== null && input.tools !== ConversationModelToolModes.None)
			throw new ConversationModelError(ConversationModelFailureCodes.InvalidRequest);

		let textBytes = Buffer.byteLength(compiled.instructions) + Buffer.byteLength(input.modelAlias);
		const messages: JsonValue[] = [{ role: "system", content: compiled.instructions }];
		for (const message of compiled.messages)
		{
			if (!message || !["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string")
				throw new ConversationModelError(ConversationModelFailureCodes.InvalidRequest);
			textBytes += Buffer.byteLength(message.content) + 32;
			if (textBytes > _CONVERSATION_MODEL_MAX_BYTES)
				throw new ConversationModelError(ConversationModelFailureCodes.RequestTooLarge);
			messages.push({ role: message.role, content: message.content });
		}
		if (textBytes > _CONVERSATION_MODEL_MAX_BYTES)
			throw new ConversationModelError(ConversationModelFailureCodes.RequestTooLarge);
		const offered = input.tools === ConversationModelToolModes.Select || input.continuation !== null ? _offeredTools(compiled.tools) : [];
		if (input.continuation !== null)
		{
			const continuation = ___ConversationModelContinuationSchema.parse(input.continuation);
			if (!offered.some(tool => tool.name === continuation.call.name))
				throw new ConversationModelError(ConversationModelFailureCodes.InvalidRequest);
			const call = continuation.call;
			messages.push({ role: "assistant", content: call.content, tool_calls: [{ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } }] });
			messages.push({ role: "tool", tool_call_id: call.id, content: continuation.resultContent });
		}
		const maxTokens = Math.min(input.maxCompletionTokens, ...ceilings.filter(_isPositiveInteger));
		const request: Record<string, JsonValue> = { model: input.modelAlias, messages, max_tokens: maxTokens, n: 1, stream: false };
		if (input.tools === ConversationModelToolModes.Select)
		{
			if (offered.length === 0)
				throw new ConversationModelError(ConversationModelFailureCodes.InvalidRequest);
			request["tools"] = offered.map(tool => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parametersSchema } }));
			request["tool_choice"] = "auto";
			request["parallel_tool_calls"] = false;
		}
		const body = ___CanonicalizeJson(request);
		if (Buffer.byteLength(body) > _CONVERSATION_MODEL_MAX_BYTES)
			throw new ConversationModelError(ConversationModelFailureCodes.RequestTooLarge);
		url.pathname = "/v1/chat/completions";
		const deadlineEpochMs = Math.min(input.notAfterEpochMs, compiled.budget.wallClockDeadlineEpochMs ?? input.notAfterEpochMs, Date.now() + 25_000);
		if (deadlineEpochMs <= Date.now())
			throw new ConversationModelError(ConversationModelFailureCodes.DeadlineExceeded);
		return { url, authorization: `Bearer ${input.key}`, body, deadlineEpochMs, offeredToolNames: input.tools === ConversationModelToolModes.Select ? offered.map(tool => tool.name) : [] };
	}
	catch (error)
	{
		if (error instanceof ConversationModelError)
			throw error;
		throw new ConversationModelError(ConversationModelFailureCodes.InvalidRequest);
	}
}

/**
 * Accepts one finished choice and delegates its shared payload to the model-adjacent validator.
 * Offered names were detached before dispatch; later caller changes cannot authorize a response.
 * Extra top-level usage fields carry no authority and are discarded.
 * @throws ConversationModelError when the upstream body cannot be accepted for this request.
 */
export function _ValidateConversationModelResponse(candidate: unknown, offeredToolNames: readonly string[]): ConversationModelResponse
{
	if (!_isRecord(candidate) || candidate["error"] != null || !Array.isArray(candidate["choices"]) || candidate["choices"].length !== 1)
		throw new ConversationModelError(ConversationModelFailureCodes.UnsupportedResponse);
	const choice: unknown = candidate["choices"][0];
	if (!_isRecord(choice) || choice["index"] !== 0 || !_isRecord(choice["message"]))
		throw new ConversationModelError(ConversationModelFailureCodes.UnsupportedResponse);
	const message = choice["message"];
	const supportedFields = ["role", "content", "tool_calls", "function_call", "refusal", "audio", "reasoning_content"];
	if (message["role"] !== "assistant" || Object.keys(message).some(key => !supportedFields.includes(key)) || supportedFields.slice(3).some(key => message[key] != null))
		throw new ConversationModelError(ConversationModelFailureCodes.UnsupportedResponse);
	if (choice["finish_reason"] === "stop" && message["tool_calls"] == null)
		return ___ConversationModelResponseSchema.parse({ kind: ConversationModelResponseKinds.Text, text: message["content"] });
	const calls = message["tool_calls"];
	if (choice["finish_reason"] !== "tool_calls" || !Array.isArray(calls) || calls.length !== 1 || offeredToolNames.length === 0)
		throw new ConversationModelError(ConversationModelFailureCodes.UnsupportedResponse);
	const call: unknown = calls[0];
	if (!_isRecord(call) || call["type"] !== "function" || Object.keys(call).some(key => !["id", "type", "function"].includes(key)) || !_isRecord(call["function"]))
		throw new ConversationModelError(ConversationModelFailureCodes.UnsupportedResponse);
	const tool = call["function"];
	if (typeof tool["name"] !== "string" || !offeredToolNames.includes(tool["name"]) || Object.keys(tool).some(key => !["name", "arguments"].includes(key)))
		throw new ConversationModelError(ConversationModelFailureCodes.UnsupportedResponse);
	return ___ConversationModelResponseSchema.parse({ kind: ConversationModelResponseKinds.Tool, call: { id: call["id"], name: tool["name"], arguments: tool["arguments"], content: message["content"] } });
}
