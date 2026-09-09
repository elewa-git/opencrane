import type { CompiledRunInput } from "@opencrane/contracts";
import type { RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";

/**
 * Tells the Pod whether a model step completed or must wait for recovery.
 * These closed values cross the private HTTP API and are checked by the Python worker; changing a
 * wire value breaks that contract. They are derived from saved turn progress, not stored as run state.
 */
export enum ConversationComputerModelStepOutcomes
{
	/** The saved answer, run completion and cleanup have finished; the turn is complete. */
	Completed = "completed",
	/** Reserved model or tool work has not confirmed completion; poll without dispatching again. */
	Pending = "pending",
	/** Completion was not confirmed before the deadline; saved output may still recover, but no new request is allowed. */
	ResponseUnavailable = "response_unavailable",
	/** The turn is missing or authority has ended; stop this request without treating the run as completed. */
	AuthorityEnded = "authority_ended",
}

/** Identifies the sole text-only request without accepting prompts, credentials or limits from a Pod. */
export interface ConversationComputerModelStepCommand
{
	readonly bootstrapId: string;
	readonly ordinal: 1;
	readonly workload: RuntimeWorkloadIdentity;
}

/** Reports progress without exposing a model credential or provider response. */
export interface ConversationComputerModelStepResult
{
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

/** Carries one server-built, bounded request to the existing model-routing transport. */
export interface ConversationComputerModelRequest
{
	readonly compiledInput: CompiledRunInput;
	readonly endpoint: string;
	readonly key: string;
	readonly modelAlias: string;
	readonly maxCompletionTokens: number;
	readonly notAfterEpochMs: number;
}

/**
 * Sends at most one admitted gateway request and returns completed text without tool requests.
 * The caller must reserve first. Any failure leaves that allowance consumed; an implementation must
 * not retry, follow redirects or infer that a missing response means the provider did no paid work.
 */
export interface ConversationComputerModelTransport
{
	request(input: ConversationComputerModelRequest): Promise<{ readonly text: string }>;
}
