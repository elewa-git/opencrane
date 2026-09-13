import type { ConversationModelRequest, ConversationModelResponse, ConversationModelToolModes } from "@opencrane/contracts";
import type { ConversationComputerToolResultOutcomes } from "./conversation-computer-continuation.types";

/**
 * Decisions returned by server model progression to its saved workflow.
 * Their string values are the workflow's serialized outcomes; none permits a replacement request.
 */
export enum ConversationComputerModelProgressOutcomes
{
	/** The assistant output and run completion are saved. */
	Completed = "completed",
	/** A saved request has no recoverable response and the run must retain that uncertainty. */
	ResponseUnavailable = "response_unavailable",
	/** The turn no longer has authority to advance. */
	AuthorityEnded = "authority_ended",
	/** The workflow may reload progress without replacing an admitted model request. */
	Retry = "retry",
	/** A reserved model request has not reached its fixed deadline. */
	ModelPending = "model_pending",
	/** The saved tool proposal still needs a decision or result. */
	ToolPending = "tool_pending",
}

/** Server workflow outcome after one evidence-driven progression pass. */
export type ConversationComputerModelProgress =
	| { readonly outcome: `${ConversationComputerModelProgressOutcomes.Completed | ConversationComputerModelProgressOutcomes.ResponseUnavailable | ConversationComputerModelProgressOutcomes.AuthorityEnded | ConversationComputerModelProgressOutcomes.Retry}` }
	| { readonly outcome: `${ConversationComputerModelProgressOutcomes.ModelPending}`; readonly notBeforeEpochMs: number; readonly ordinal: 1 | 2 }
	| { readonly outcome: ConversationComputerToolResultOutcomes.GeneratedFilePending; readonly operationId: string; readonly notAfterEpochMs: number }
	| { readonly outcome: `${ConversationComputerModelProgressOutcomes.ToolPending}`; readonly toolInvocationId: string; readonly waitFor?: "approval" | "result"; readonly waitUntilEpochMs?: number };

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
