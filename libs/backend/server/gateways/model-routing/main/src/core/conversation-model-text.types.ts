import type { CompiledRunInput } from "@opencrane/contracts";

/** Supplies an admitted, frozen prompt and server-held transport coordinates for one model call. */
export interface ConversationModelTextRequest
{
	/** Contains the instructions, message history, model and ceilings frozen by the compiler. */
	readonly compiledInput: CompiledRunInput;
	/** Supplies the server-configured HTTP(S) origin; no prompt or Pod input may select it. */
	readonly endpoint: string;
	/** Carries the attempt credential in memory; it is sent only in the Authorization header. */
	readonly key: string;
	/** Must match the compiled model and the model allowed by the attempt credential. */
	readonly modelAlias: string;
	/** Supplies the already reserved completion allowance; it cannot enlarge a compiled ceiling. */
	readonly maxCompletionTokens: number;
	/** Ends this call's admitted authority, including time spent receiving its response. */
	readonly notAfterEpochMs: number;
}

/** Returns a completed assistant answer without provider metadata or unsupported tool requests. */
export interface ConversationModelTextResult
{
	/** Preserves the accepted answer exactly, including its surrounding whitespace. */
	readonly text: string;
}

/**
 * Classifies transport failures without carrying prompts, credentials or remote error text.
 * These closed values cross the in-process error contract, not HTTP or this adapter's storage;
 * changing a value changes that package contract. Each ends this exchange without deciding run state.
 * Every failure after dispatch may have consumed a paid request; none authorizes an automatic retry.
 */
export enum ConversationModelTextFailureCodes
{
	/** The request failed local validation and no model request was sent. */
	InvalidRequest = "invalid_request",
	/** The request body exceeded the adapter's byte ceiling before dispatch. */
	RequestTooLarge = "request_too_large",
	/** The deadline elapsed; a dispatched request may already have reached the provider. */
	DeadlineExceeded = "deadline_exceeded",
	/** The exchange failed without a usable HTTP response; its provider outcome is unknown. */
	TransportFailed = "transport_failed",
	/** The endpoint returned a non-success status or a response marked as redirected. */
	HttpRejected = "http_rejected",
	/** The response exceeded the byte ceiling and was not accepted as an answer. */
	ResponseTooLarge = "response_too_large",
	/** The response did not contain one complete assistant text answer. */
	UnsupportedResponse = "unsupported_response",
}

/** Reports a fixed failure category, never the original fetch, decoder or provider exception. */
export class ConversationModelTextError extends Error
{
	/** Allows the caller to record the category without storing remote content. */
	readonly code: ConversationModelTextFailureCodes;

	/** Builds an error whose message and stack contain no caller-supplied text. */
	constructor(code: ConversationModelTextFailureCodes)
	{
		super(`Conversation model request failed: ${code}`);
		this.name = "ConversationModelTextError";
		this.code = code;
	}
}

/** Detaches the request from caller-owned data before any asynchronous work starts. */
export interface PreparedConversationModelTextRequest
{
	/** Selects the fixed chat-completions route on the configured origin. */
	readonly url: URL;
	/** Holds the credential-bearing header only for this exchange. */
	readonly authorization: string;
	/** Holds the serialized, byte-checked prompt without any credential fields. */
	readonly body: string;
	/** Ends both sending and response acceptance, without renewal. */
	readonly deadlineEpochMs: number;
}
