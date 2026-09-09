/**
 * Classifies transport failures without carrying prompts, credentials or remote error text.
 * These closed values cross the in-process error contract, not HTTP or this adapter's storage;
 * changing a value changes that package contract. Each ends this exchange without deciding run state.
 * Every failure after dispatch may have consumed a paid request; none authorizes an automatic retry.
 */
export enum ConversationModelFailureCodes
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
	/** The response did not contain a supported text answer or offered tool declaration. */
	UnsupportedResponse = "unsupported_response",
}

/** Reports a fixed failure category, never the original fetch, decoder or provider exception. */
export class ConversationModelError extends Error
{
	/** Allows the caller to record the category without storing remote content. */
	readonly code: ConversationModelFailureCodes;

	/** Builds an error whose message and stack contain no caller-supplied text. */
	constructor(code: ConversationModelFailureCodes)
	{
		super(`Conversation model request failed: ${code}`);
		this.name = "ConversationModelError";
		this.code = code;
	}
}

/** Detaches the request from caller-owned data before any asynchronous work starts. */
export interface PreparedConversationModelRequest
{
	/** Selects the fixed chat-completions route on the configured origin. */
	readonly url: URL;
	/** Holds the credential-bearing header only for this exchange. */
	readonly authorization: string;
	/** Holds the serialized, byte-checked prompt without any credential fields. */
	readonly body: string;
	/** Ends both sending and response acceptance, without renewal. */
	readonly deadlineEpochMs: number;
	/** Lists the offered names captured before dispatch; an empty list forbids tool responses. */
	readonly offeredToolNames: readonly string[];
}
