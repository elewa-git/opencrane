import { ___DoWithTrace, ___DoWithoutTrace } from "@opencrane/backend/observability";
import { ___ParseAndValidateJson } from "@opencrane/util";

import { ConversationModelTextError, ConversationModelTextFailureCodes, type ConversationModelTextRequest, type ConversationModelTextResult, type PreparedConversationModelTextRequest } from "./conversation-model-text.types";
import { _CONVERSATION_MODEL_MAX_BYTES, _PrepareConversationModelTextRequest, _ValidateConversationModelTextResponse } from "./conversation-model-text.validator";

/** Cancels an unused response without exposing a remote stream's error or waiting for its cleanup. */
function _discardBody(response: Response): void
{
	void response.body?.cancel().catch(function _ignoreCancellationFailure() { /* The exchange already has its failure category. */ });
}

/** Reads bytes incrementally so a misleading Content-Length cannot bypass the response ceiling. */
async function _readResponse(response: Response, signal: AbortSignal): Promise<string>
{
	const declaredLength = response.headers.get("content-length");
	if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > _CONVERSATION_MODEL_MAX_BYTES))
	{
		_discardBody(response);
		throw new ConversationModelTextError(ConversationModelTextFailureCodes.ResponseTooLarge);
	}
	if (response.body === null)
		throw new ConversationModelTextError(ConversationModelTextFailureCodes.UnsupportedResponse);
	const reader = response.body.getReader();
	/** Stops reading even when a stream has stalled after its headers arrived. */
	function _cancelResponse(): void
	{
		void reader.cancel().catch(function _ignoreCancellationFailure() { /* No remote error may replace the selected outcome. */ });
	}
	signal.addEventListener("abort", _cancelResponse, { once: true });
	const chunks: Uint8Array[] = [];
	let length = 0;
	try
	{
		while (true)
		{
			if (signal.aborted)
				throw new ConversationModelTextError(ConversationModelTextFailureCodes.DeadlineExceeded);
			const chunk = await reader.read();
			if (chunk.done)
			{
				try
				{
					return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, length));
				}
				catch
				{
					throw new ConversationModelTextError(ConversationModelTextFailureCodes.UnsupportedResponse);
				}
			}
			length += chunk.value.byteLength;
			if (length > _CONVERSATION_MODEL_MAX_BYTES)
				throw new ConversationModelTextError(ConversationModelTextFailureCodes.ResponseTooLarge);
			chunks.push(chunk.value);
		}
	}
	finally
	{
		signal.removeEventListener("abort", _cancelResponse);
		_cancelResponse();
		reader.releaseLock();
	}
}

/** Sends the prepared text request once and validates its complete response before returning. */
async function _exchange(prepared: PreparedConversationModelTextRequest, signal: AbortSignal): Promise<ConversationModelTextResult>
{
	const response = await ___DoWithoutTrace(function _sendSensitiveRequest()
	{
		return fetch(prepared.url, {
			method: "POST", redirect: "error", signal,
			headers: { authorization: prepared.authorization, "content-type": "application/json", accept: "application/json" },
			body: prepared.body,
		});
	});
	if (!response.ok || response.redirected)
	{
		_discardBody(response);
		throw new ConversationModelTextError(ConversationModelTextFailureCodes.HttpRejected);
	}
	if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json")
	{
		_discardBody(response);
		throw new ConversationModelTextError(ConversationModelTextFailureCodes.UnsupportedResponse);
	}
	const text = await _readResponse(response, signal);
	let result: ConversationModelTextResult;
	try
	{
		result = ___ParseAndValidateJson(text, "Conversation model response", _ValidateConversationModelTextResponse);
	}
	catch
	{
		throw new ConversationModelTextError(ConversationModelTextFailureCodes.UnsupportedResponse);
	}
	if (signal.aborted || Date.now() >= prepared.deadlineEpochMs)
		throw new ConversationModelTextError(ConversationModelTextFailureCodes.DeadlineExceeded);
	return result;
}

/**
 * Sends one admitted gateway request for text and never retries an uncertain paid operation.
 * The caller must reserve dispatch durably before calling and retain the result before acknowledging
 * it. A transport failure does not prove that the provider rejected or did not charge the request.
 * The deadline covers headers and the entire response; automatic HTTP tracing is suppressed so the
 * server credential, destination and prompt cannot appear in child spans. This operation's span
 * contains no request fields, and failures carry a fixed category without the original exception.
 * @returns A completed assistant answer; no tool request or provider metadata crosses this boundary.
 * @throws ConversationModelTextError for invalid inputs, expired authority or an unusable exchange.
 */
export async function __RequestConversationModelText(input: ConversationModelTextRequest): Promise<ConversationModelTextResult>
{
	return ___DoWithTrace("conversation.model.text", {}, async function _requestText()
	{
		const prepared = _PrepareConversationModelTextRequest(input);
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const deadline = new Promise<never>(function _expireRequest(_resolve, reject)
		{
			timer = setTimeout(function _abortRequest()
			{
				controller.abort();
				reject(new ConversationModelTextError(ConversationModelTextFailureCodes.DeadlineExceeded));
			}, Math.max(0, prepared.deadlineEpochMs - Date.now()));
		});
		try
		{
			if (Date.now() >= prepared.deadlineEpochMs)
				throw new ConversationModelTextError(ConversationModelTextFailureCodes.DeadlineExceeded);
			return await Promise.race([_exchange(prepared, controller.signal), deadline]);
		}
		catch (error)
		{
			if (controller.signal.aborted || Date.now() >= prepared.deadlineEpochMs)
				throw new ConversationModelTextError(ConversationModelTextFailureCodes.DeadlineExceeded);
			if (error instanceof ConversationModelTextError)
				throw error;
			throw new ConversationModelTextError(ConversationModelTextFailureCodes.TransportFailed);
		}
		finally
		{
			clearTimeout(timer);
			controller.abort();
		}
	});
}
