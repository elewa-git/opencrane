import type { ConversationModelRequest, ConversationModelResponse, ConversationModelToolModes } from "@opencrane/contracts";
import type { ConversationComputerProcessIdentity } from "./conversation-computer-realization.types";

/**
 * Tells the realized process whether a model step completed or must wait for recovery.
 * These closed values cross the private HTTP API and are checked by the Python worker; changing a
 * wire value breaks that contract. They are derived from saved turn progress, not stored as run state.
 */
export enum ConversationComputerModelStepOutcomes
{
	/** The saved answer, run completion and cleanup have finished; the turn is complete. */
	Completed = "completed",
	/** Reserved model or tool work has not completed; poll without redispatching a reserved request. */
	Pending = "pending",
	/** Completion is unconfirmed after the deadline; saved content may recover, but this reservation cannot dispatch again. */
	ResponseUnavailable = "response_unavailable",
	/** The turn is missing or authority has ended; stop this request without treating the run as completed. */
	AuthorityEnded = "authority_ended",
}

/** Advances the saved turn without accepting prompts, credentials, ordinals, or limits from the realized process. */
export interface ConversationComputerModelStepCommand
{
	/** Identifies the saved turn whose reserved work may advance. */
	readonly bootstrapId: string;
	/** Carries the independently authenticated process identity checked against the active lease. */
	readonly process: ConversationComputerProcessIdentity;
}

/** Reports progress without exposing a model credential or provider response. */
export interface ConversationComputerModelStepResult
{
	/** Tells the process whether the saved step completed, remains pending, or cannot continue. */
	readonly outcome: ConversationComputerModelStepOutcomes;
}

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
