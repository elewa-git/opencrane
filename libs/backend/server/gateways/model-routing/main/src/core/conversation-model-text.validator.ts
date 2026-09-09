import { ___CanonicalizeJson } from "@opencrane/util";

import { ConversationModelTextError, ConversationModelTextFailureCodes, type ConversationModelTextRequest, type ConversationModelTextResult, type PreparedConversationModelTextRequest } from "./conversation-model-text.types";

/** Limits serialized request and response bodies independently to one mebibyte. */
export const _CONVERSATION_MODEL_MAX_BYTES = 1024 * 1024;

/** Checks a positive integer ceiling without coercing absent or malformed configuration. */
function _isPositiveInteger(value: unknown): value is number
{
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Serializes the compiler's text inputs and applies the smallest admitted output and time ceilings.
 * Credential coordinates come from server composition; compiled messages cannot alter transport.
 * @throws ConversationModelTextError before dispatch when inputs or bounds are unusable.
 */
export function _PrepareConversationModelTextRequest(input: ConversationModelTextRequest): PreparedConversationModelTextRequest
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
			|| typeof compiled.instructions !== "string" || !Array.isArray(compiled.messages))
			throw new ConversationModelTextError(ConversationModelTextFailureCodes.InvalidRequest);

		let textBytes = Buffer.byteLength(compiled.instructions) + Buffer.byteLength(input.modelAlias);
		const messages = [{ role: "system", content: compiled.instructions }];
		for (const message of compiled.messages)
		{
			if (!message || !["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string")
				throw new ConversationModelTextError(ConversationModelTextFailureCodes.InvalidRequest);
			textBytes += Buffer.byteLength(message.content) + 32;
			if (textBytes > _CONVERSATION_MODEL_MAX_BYTES)
				throw new ConversationModelTextError(ConversationModelTextFailureCodes.RequestTooLarge);
			messages.push({ role: message.role, content: message.content });
		}
		if (textBytes > _CONVERSATION_MODEL_MAX_BYTES)
			throw new ConversationModelTextError(ConversationModelTextFailureCodes.RequestTooLarge);
		const maxTokens = Math.min(input.maxCompletionTokens, ...ceilings.filter(_isPositiveInteger));
		const body = ___CanonicalizeJson({ model: input.modelAlias, messages, max_tokens: maxTokens, n: 1, stream: false });
		if (Buffer.byteLength(body) > _CONVERSATION_MODEL_MAX_BYTES)
			throw new ConversationModelTextError(ConversationModelTextFailureCodes.RequestTooLarge);
		url.pathname = "/v1/chat/completions";
		const deadlineEpochMs = Math.min(input.notAfterEpochMs, compiled.budget.wallClockDeadlineEpochMs ?? input.notAfterEpochMs, Date.now() + 25_000);
		if (deadlineEpochMs <= Date.now())
			throw new ConversationModelTextError(ConversationModelTextFailureCodes.DeadlineExceeded);
		return { url, authorization: `Bearer ${input.key}`, body, deadlineEpochMs };
	}
	catch (error)
	{
		if (error instanceof ConversationModelTextError)
			throw error;
		throw new ConversationModelTextError(ConversationModelTextFailureCodes.InvalidRequest);
	}
}

/** Identifies a JSON object without treating arrays as named protocol fields. */
function _isRecord(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Accepts one finished assistant text choice; tools, refusals and partial answers remain unsupported.
 * Extra top-level usage fields carry no answer authority and are discarded.
 * @throws ConversationModelTextError when the upstream body cannot be used as a completed answer.
 */
export function _ValidateConversationModelTextResponse(candidate: unknown): ConversationModelTextResult
{
	if (!_isRecord(candidate) || candidate["error"] != null || !Array.isArray(candidate["choices"]) || candidate["choices"].length !== 1)
		throw new ConversationModelTextError(ConversationModelTextFailureCodes.UnsupportedResponse);
	const choice: unknown = candidate["choices"][0];
	if (!_isRecord(choice) || choice["index"] !== 0 || choice["finish_reason"] !== "stop" || !_isRecord(choice["message"]))
		throw new ConversationModelTextError(ConversationModelTextFailureCodes.UnsupportedResponse);
	const message = choice["message"];
	const text = message["content"];
	const supportedFields = ["role", "content", "tool_calls", "function_call", "refusal", "audio", "reasoning_content"];
	if (message["role"] !== "assistant" || typeof text !== "string" || text.trim().length === 0 || Buffer.byteLength(text) > 65_536
		|| Object.keys(message).some(key => !supportedFields.includes(key))
		|| supportedFields.slice(2).some(key => message[key] != null))
		throw new ConversationModelTextError(ConversationModelTextFailureCodes.UnsupportedResponse);
	try
	{
		___CanonicalizeJson(text);
	}
	catch
	{
		throw new ConversationModelTextError(ConversationModelTextFailureCodes.UnsupportedResponse);
	}
	return { text };
}
