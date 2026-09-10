import type { ConversationModelRequest, ConversationModelResponse, ConversationModelToolModes } from "@opencrane/contracts";
/** Server workflow outcome after one evidence-driven progression pass. */
export type ConversationComputerModelProgress =
	| { readonly outcome: "completed" | "response_unavailable" | "authority_ended" | "retry" }
	| { readonly outcome: "model_pending"; readonly notBeforeEpochMs: number; readonly ordinal: 1 | 2 }
	| { readonly outcome: "tool_pending"; readonly toolInvocationId: string };

/**
 * Records the consumed request allowance in revision 1 of the turn stream, without prompt or key.
 * The live handler must confirm its fresh fence through reserveModel before dispatch. Reading this
 * record after restart never grants permission to send again, even when no response was saved.
 * @see ConversationComputerTurnStore.reserveModel
 */
export interface ConversationComputerModelReservation
{
	readonly invocationFence: string;
	readonly ordinal: 1;
	readonly tools: ConversationModelToolModes;
	readonly compiledInputDigest: string;
	/** Binds the frozen run, model, ordinal, token ceiling and absolute deadlines. */
	readonly requestDigest: string;
	/** Consumes this completion-token allowance even when the response is lost. */
	readonly maxCompletionTokens: number;
	/** Preserves the original run and lease limit observed before reservation. */
	readonly authorityExpiresAtEpochMs: number;
	/** Ends this request within 25 seconds and never extends during retry. */
	readonly dispatchDeadlineEpochMs: number;
}

/** Reuses the shared server-only request contract at the conversation's transport port. */
export type ConversationComputerModelRequest = ConversationModelRequest;

/** Sends one already reserved request; no failure grants an automatic retry. */
export interface ConversationComputerModelTransport
{
	request(input: ConversationModelRequest): Promise<ConversationModelResponse>;
}
