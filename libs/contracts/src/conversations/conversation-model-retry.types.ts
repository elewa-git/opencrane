/**
 * Identifies the closed proxy receipt protocol shared by the model adapter and saved conversation
 * workflow. These strings cross HTTP and enter saved events; changing one changes that protocol.
 * Unknown versions never authorize another request.
 */
export enum ConversationModelPreForwardContracts
{
	/** The qualified proxy rejected this request in its local limiter before provider dispatch. */
	V1 = "opencrane.preforward-rate-limit.v1",
}

/**
 * Explains a verified pre-provider rejection. This closed value is sent over HTTP and saved by the
 * conversation owner. Provider status codes, usage figures and error text cannot supply a reason.
 */
export enum ConversationModelPreForwardReasons
{
	/** The proxy's local limit was exceeded; a saved retry must wait for the recorded reset time. */
	LocalRateLimit = "local-rate-limit",
}

/**
 * Carries non-secret proof fields after transport authentication. A parsed shape alone is not proof:
 * the model adapter must authenticate the receipt for the configured proxy, request and credential.
 * The workflow must save it and win a new dispatch claim before sending again.
 */
export interface ConversationModelPreForwardReceipt
{
	/** Identifies the qualified producer and verification rules. */
	readonly version: ConversationModelPreForwardContracts.V1;
	/** Identifies the particular physical request that did not reach a provider. */
	readonly physicalNonce: string;
	/** Binds this request to the existing logical model reservation. */
	readonly logicalFence: string;
	/** Binds the serialized request bytes, including all earlier tool results. */
	readonly requestBodySha256: string;
	/** Preserves the deadline sent with the original request; retries may not extend it. */
	readonly deadlineEpochMs: number;
	/** Records when the exceeded local rate-limit window resets. */
	readonly retryAtEpochMs: number;
	/** States why the qualified proxy can prove there was no provider dispatch. */
	readonly reason: ConversationModelPreForwardReasons.LocalRateLimit;
}

/** Wraps the closed HTTP response body; provider extensions are not accepted here. */
export interface ConversationModelPreForwardEnvelope
{
	/** Contains fields covered by the response authentication code. */
	readonly receipt: ConversationModelPreForwardReceipt;
}

/** Supplies saved dispatch coordinates without changing model input or credential authority. */
export interface ConversationModelDelivery
{
	/** Identifies this physical send; a retry must first save a new nonce in its dispatch claim. */
	readonly physicalNonce: string;
	/** Binds all physical sends to the same logical reservation. */
	readonly logicalFence: string;
	/** On retry, requires the serialized request to match the preceding verified rejection. */
	readonly expectedRequestBodySha256?: string;
}
