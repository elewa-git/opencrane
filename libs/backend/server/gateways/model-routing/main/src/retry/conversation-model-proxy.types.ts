import type { ConversationModelPreForwardContracts, ConversationModelRequest, ConversationModelResponse } from "@opencrane/contracts";

/** Records the managed origin qualified by deployment composition, never by a response header. */
export interface ConversationModelProxyQualification
{
	/** Selects the same release-owned Service as the configured model endpoint. */
	readonly origin: string;
	/** Requires the producer rules verified by the derived image's contract tests. */
	readonly contract: ConversationModelPreForwardContracts.V1;
}

/** Exposes the configured single-send adapter without exposing its qualification to callers. */
export interface ConversationModelTransport
{
	/** Sends a reserved request once; the caller owns persistence and any later retry claim. */
	request(input: ConversationModelRequest): Promise<ConversationModelResponse>;
}
