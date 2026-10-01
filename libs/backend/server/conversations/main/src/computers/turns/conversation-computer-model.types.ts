import type { ConversationModelRequest, ConversationModelResponse } from "@opencrane/contracts";
import type { ConversationComputerToolResultOutcomes } from "./conversation-computer-continuation.types";

/**
 * Decisions returned by server model progression to its saved workflow.
 * Their string values are the workflow's serialized outcomes; none permits a replacement request.
 */
export enum ConversationComputerModelProgressOutcomes
{
	/** The assistant output and run completion are saved. */
	Completed = "completed",
	/** A model/tool result is unavailable or the original allowance has ended; recovery must retain that outcome. */
	ResponseUnavailable = "response_unavailable",
	/** The turn no longer has authority to advance. */
	AuthorityEnded = "authority_ended",
	/** The workflow may reload progress without replacing an admitted model request. */
	Retry = "retry",
	/** A reserved model request has not reached its fixed deadline. */
	ModelPending = "model_pending",
	/** A verified rejection is saved; the workflow must wait before attempting a fresh retry claim. */
	ModelRetryWaiting = "model_retry_waiting",
	/** The saved tool proposal still needs a decision or result. */
	ToolPending = "tool_pending",
}

/** Server workflow outcome after one evidence-driven progression pass. */
export type ConversationComputerModelProgress =
	| { readonly outcome: `${ConversationComputerModelProgressOutcomes.Completed | ConversationComputerModelProgressOutcomes.ResponseUnavailable | ConversationComputerModelProgressOutcomes.AuthorityEnded | ConversationComputerModelProgressOutcomes.Retry}` }
	| { readonly outcome: `${ConversationComputerModelProgressOutcomes.ModelPending}`; readonly notBeforeEpochMs: number; readonly ordinal: number }
	| { readonly outcome: `${ConversationComputerModelProgressOutcomes.ModelRetryWaiting}`; readonly notBeforeEpochMs: number; readonly ordinal: number; readonly retryOrdinal: number }
	| { readonly outcome: ConversationComputerToolResultOutcomes.GeneratedFilePending; readonly operationId: string; readonly notAfterEpochMs: number }
	| { readonly outcome: `${ConversationComputerModelProgressOutcomes.ToolPending}`; readonly toolInvocationId: string; readonly waitFor?: "approval" | "result"; readonly waitUntilEpochMs?: number };

/** Reuses the shared server-only request contract at the conversation's transport port. */
export type ConversationComputerModelRequest = ConversationModelRequest;

/** Sends one already reserved request; no failure grants an automatic retry. */
export interface ConversationComputerModelTransport
{
	/** Send the saved request once, with its original authority and ordered private history. */
	request(input: ConversationModelRequest): Promise<ConversationModelResponse>;
}
