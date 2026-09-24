import type { BoundConversationWriterIntent } from "@opencrane/backend/server/conversations/history";
import type { ConversationModelToolModes, RunBudgetPolicy } from "@opencrane/contracts";

/**
 * Names the complete durable state of one conversation-computer turn.
 *
 * The Kurrent store derives this state by replaying the turn's contiguous event stream. Callers use
 * it to choose recovery work, but it grants no model, tool, lease or participant-write authority.
 *
 * Called by: the conversation turn reducer, store, authority, model flow and Stop publisher.
 */
export enum ConversationComputerTurnProtocolStates
{
	/** No model request has been reserved. */
	Open = "open",
	/** One saved model reservation is the only request that may still produce a response. */
	ModelReserved = "model_reserved",
	/** The current model step selected one saved tool invocation whose result is unresolved. */
	ToolPending = "tool_pending",
	/** The current tool result and its private assistant/tool exchange are saved. */
	ResultReady = "result_ready",
	/** The final assistant output is saved and no more turn work may be admitted. */
	OutputRecorded = "output_recorded",
	/** The turn cannot recover a grounded response and may only be explicitly stopped. */
	ResponseUnavailable = "response_unavailable",
	/** Stop won the terminal compare-and-set and no more turn work may be admitted. */
	Cancelled = "cancelled",
}

/**
 * Names every event the pure ordered-turn reducer accepts after the frozen event.
 *
 * These values classify package-internal events. The Kurrent adapter owns their versioned wire names
 * and must reject old fixed-turn versions on this fresh-install protocol.
 *
 * Called by: the conversation turn reducer and Kurrent store.
 */
export enum ConversationComputerTurnProtocolEvents
{
	/** Reserves one paid model request and its completion-token allowance. */
	ModelReserved = "model_reserved",
	/** Reserves one tool-invocation allowance for the current model step. */
	ToolSelected = "tool_selected",
	/** Records a private tool exchange without yet debiting a loop cycle. */
	ToolResultRecorded = "tool_result_recorded",
	/** Records the participant-visible final assistant output. */
	OutputRecorded = "output_recorded",
	/** Ends model, tool and output admission after a bounded failure. */
	ResponseUnavailable = "response_unavailable",
	/** Records that Stop won against every non-output state. */
	Cancelled = "cancelled",
}

/**
 * Explains why an authorized turn entered its durable unavailable state.
 *
 * The reason is stored in KurrentDB and disclosed only as a closed diagnostic. It never includes a
 * provider response, tool result, prompt, credential or exception message.
 *
 * Called by: the conversation turn authority and Kurrent store.
 */
export enum ConversationComputerTurnUnavailableReasons
{
	/** A saved paid model request passed its fixed deadline without a recoverable response. */
	ModelResponseUnavailable = "model_response_unavailable",
	/** The frozen model, token, tool or loop allowance cannot admit the required next step. */
	AllowanceExhausted = "allowance_exhausted",
	/** The selected invocation cannot provide an authorized, integrity-checked terminal result. */
	ToolResultUnavailable = "tool_result_unavailable",
}

/** Refers to encrypted model content without placing arguments or results in KurrentDB. */
export interface ConversationComputerPrivateModelReference
{
	/** Identifies the existing private conversation-payload row. */
	readonly payloadRef: string;
	/** Binds the exact ciphertext stored at that reference. */
	readonly ciphertextDigest: string;
}

/**
 * Consumes one model-call and completion-token reservation before provider dispatch.
 *
 * Recovery may inspect this record but may never dispatch it again. A reservation after a saved
 * result binds the complete ordered private history and consumes exactly one loop cycle.
 *
 * Called by: conversation model progression and the Kurrent turn store.
 */
export interface ConversationComputerTurnModelReservation
{
	/** Monotonic one-based model step reconstructed from durable history. */
	readonly ordinal: number;
	/** Unique fence that identifies this one paid request. */
	readonly invocationFence: string;
	/** Selects whether this request may return one offered tool declaration. */
	readonly tools: ConversationModelToolModes;
	/** Requires the same immutable compiled input on every recovery pass. */
	readonly compiledInputDigest: string;
	/** Binds every earlier saved assistant/tool exchange in ascending model-step order. */
	readonly historyDigest: string;
	/** Binds the full non-secret request reservation and fixed limits. */
	readonly requestDigest: string;
	/** Consumes this completion-token allowance even when the response is lost. */
	readonly maxCompletionTokens: number;
	/** Preserves the original run, lease, credential and accepted-result authority limit. */
	readonly authorityExpiresAtEpochMs: number;
	/** Ends this request without extending on workflow or process retry. */
	readonly dispatchDeadlineEpochMs: number;
}

/** Reserves one exact tool identity after its declaration enters encrypted custody. */
export interface ConversationComputerTurnToolSelection
{
	/** Identifies the model step that produced the declaration. */
	readonly ordinal: number;
	/** Requires the declaration to come from this step's saved model request. */
	readonly modelInvocationFence: string;
	/** References the encrypted declaration accepted from the model. */
	readonly declaration: ConversationComputerPrivateModelReference;
	/** Identifies the stable per-step proposal and SQL candidate. */
	readonly proposalId: string;
	/** Identifies the invocation carried through approval, dispatch and result delivery. */
	readonly toolInvocationId: string;
	/** Detects changed arguments, tool revision or assignment at the same step. */
	readonly requestFingerprint: string;
}

/** Records one terminal result and its encrypted assistant/tool exchange. */
export interface ConversationComputerTurnToolResult
{
	/** Identifies the model step whose selected tool produced this result. */
	readonly ordinal: number;
	/** Requires the result to match the proposal retained by the selection event. */
	readonly proposalId: string;
	/** Requires the result to match the exact admitted invocation. */
	readonly toolInvocationId: string;
	/** Binds the immutable terminal delivery payload. */
	readonly resultDigest: string;
	/** References the encrypted assistant/tool pair used in later model history. */
	readonly exchange: ConversationComputerPrivateModelReference;
	/** Prevents later model work from extending the result's accepted authority. */
	readonly authorityExpiresAtEpochMs: number;
}

/** One ordered model step at its latest replayed stage. */
export type ConversationComputerTurnStep =
	| { readonly state: ConversationComputerTurnProtocolStates.ModelReserved; readonly reservation: ConversationComputerTurnModelReservation; readonly selection: null; readonly result: null }
	| { readonly state: ConversationComputerTurnProtocolStates.ToolPending; readonly reservation: ConversationComputerTurnModelReservation; readonly selection: ConversationComputerTurnToolSelection; readonly result: null }
	| { readonly state: ConversationComputerTurnProtocolStates.ResultReady; readonly reservation: ConversationComputerTurnModelReservation; readonly selection: ConversationComputerTurnToolSelection; readonly result: ConversationComputerTurnToolResult };

/** Aggregate allowances consumed by newly appended ordered-step events. */
export interface ConversationComputerTurnAccounting
{
	/** Number of paid model requests reserved, including a final text request. */
	readonly reservedModelCalls: number;
	/** Sum of the completion-token ceilings reserved across model requests. */
	readonly reservedCompletionTokens: number;
	/** Number of distinct tool selections reserved before SQL admission. */
	readonly reservedToolInvocations: number;
	/** Number of saved results that were bound into a later model request. */
	readonly toolResultCyclesFed: number;
}

/** Keeps the complete server-stamped output intent in the durable turn decision. */
export type ConversationComputerTurnOutputReceipt = BoundConversationWriterIntent;

/** Minimal terminal decision retained when Stop wins against final output. */
export interface ConversationComputerTurnCancellationReceipt
{
	/** Identifies the durable Stop control event. */
	readonly commandId: string;
	/** Binds the SQL-admitted command, target and workflow receipt. */
	readonly commandDigest: string;
	/** Preserves the database-owned admission time across Kurrent retries. */
	readonly occurredAt: string;
}

/** Closed non-secret evidence for an unavailable turn. */
export interface ConversationComputerTurnUnavailableReceipt
{
	/** Identifies the model or tool step that could not continue, or null before any reservation. */
	readonly ordinal: number | null;
	/** Identifies the saved fence, invocation or deterministic allowance decision. */
	readonly sourceCommandId: string;
	/** Gives callers one safe bounded reason without provider content. */
	readonly reason: ConversationComputerTurnUnavailableReasons;
}

/** Derived ordered protocol state reconstructed from the complete turn stream. */
export interface ConversationComputerTurnProtocolProjection
{
	/** Selects the only legal next events. */
	readonly state: ConversationComputerTurnProtocolStates;
	/** Records the latest contiguous turn-stream revision, starting with frozen revision zero. */
	readonly revision: bigint;
	/** Retains model steps in ascending, gap-free ordinal order. */
	readonly steps: readonly ConversationComputerTurnStep[];
	/** Retains replay-derived aggregate consumption without refunding failed effects. */
	readonly accounting: ConversationComputerTurnAccounting;
	/** Retains the winning output and its source fence. */
	readonly output: { readonly sourceCommandId: string; readonly receipt: ConversationComputerTurnOutputReceipt } | null;
	/** Retains a bounded unavailable terminal decision. */
	readonly unavailable: ConversationComputerTurnUnavailableReceipt | null;
	/** Retains the Stop decision that won against non-output progress. */
	readonly cancellation: ConversationComputerTurnCancellationReceipt | null;
}

/** Every event accepted by the exhaustive package-internal protocol reducer. */
export type ConversationComputerTurnProtocolEvent =
	| { readonly kind: ConversationComputerTurnProtocolEvents.ModelReserved; readonly reservation: ConversationComputerTurnModelReservation }
	| { readonly kind: ConversationComputerTurnProtocolEvents.ToolSelected; readonly selection: ConversationComputerTurnToolSelection }
	| { readonly kind: ConversationComputerTurnProtocolEvents.ToolResultRecorded; readonly result: ConversationComputerTurnToolResult }
	| { readonly kind: ConversationComputerTurnProtocolEvents.OutputRecorded; readonly ordinal: number; readonly modelInvocationFence: string; readonly sourceCommandId: string; readonly receipt: ConversationComputerTurnOutputReceipt }
	| { readonly kind: ConversationComputerTurnProtocolEvents.ResponseUnavailable; readonly receipt: ConversationComputerTurnUnavailableReceipt }
	| { readonly kind: ConversationComputerTurnProtocolEvents.Cancelled; readonly receipt: ConversationComputerTurnCancellationReceipt };

/** Immutable allowance copied from the admitted run snapshot and bound into the frozen event. */
export type ConversationComputerTurnBudget = RunBudgetPolicy;
