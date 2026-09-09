import type { CompiledRunInput } from "../inputs/compiled-run-input.types";

/**
 * Selects whether an admitted model request may propose a tool. The conversation owner and model
 * adapter share these closed in-process values; unknown modes fail before dispatch. A mode grants
 * no tool authority and cannot replace the caller's saved budget and permission checks.
 */
export enum ConversationModelToolModes
{
	/** Requests text without sending tool definitions; a returned tool call must be rejected. */
	None = "none",
	/** Offers frozen tools that need no approval; the response may select at most one. */
	Select = "select",
}

/**
 * Distinguishes accepted text from a proposed tool in the server's model-response contract.
 * The caller must retain either result before continuing. A Tool result is a proposal, not
 * permission to execute it. Unknown values are rejected by the shared response validator.
 */
export enum ConversationModelResponseKinds
{
	/** Contains the completed assistant text that the conversation owner may retain. */
	Text = "text",
	/** Contains one assistant declaration that still needs tool admission. */
	Tool = "tool",
}

/** Preserves the assistant declaration required to pair a later tool result with this call. */
export interface ConversationModelToolCall
{
	/** Preserves the provider's call id; it is never an OpenCrane invocation id or authority. */
	readonly id: string;
	/** Selects one unambiguous name from the frozen tools offered to the model. */
	readonly name: string;
	/** Preserves the original JSON object text, including whitespace, for exact continuation. */
	readonly arguments: string;
	/** Preserves any assistant text accompanying the declaration without inventing an answer. */
	readonly content: string | null;
}

/** Carries the saved declaration and its authorized result without altering the compiled history. */
export interface ConversationModelContinuation
{
	/** Supplies the accepted first declaration, including the original provider call id. */
	readonly call: ConversationModelToolCall;
	/** Supplies the caller's serialized, authorized tool result; it is treated as untrusted content. */
	readonly resultContent: string;
}

/** Contains a validated assistant answer or one tool proposal, with no provider usage metadata. */
export type ConversationModelResponse =
	| {
		/** Distinguishes a completed text response from a proposed tool. */
		readonly kind: ConversationModelResponseKinds.Text;
		/** Preserves the accepted answer exactly, including surrounding whitespace. */
		readonly text: string;
	}
	| {
		/** Requires the caller to retain and admit the proposal before executing it. */
		readonly kind: ConversationModelResponseKinds.Tool;
		/** Supplies the declaration needed to pair a later result with this proposal. */
		readonly call: ConversationModelToolCall;
	};

/**
 * Supplies one reserved model exchange. Endpoint and key come from server composition, never a Pod
 * or model response. The caller owns durable dispatch, current authority, aggregate call and token
 * budgets, and credential custody; this request does not grant or replenish any of those limits.
 */
export interface ConversationModelRequest
{
	/** Contains the instructions, message history, model and ceilings frozen by the compiler. */
	readonly compiledInput: CompiledRunInput;
	/** Supplies the server-configured HTTP(S) origin; prompt content cannot select a destination. */
	readonly endpoint: string;
	/** Carries the attempt credential in memory; the adapter sends it only as an HTTP header. */
	readonly key: string;
	/** Must match the compiled model and the model allowed by the attempt credential. */
	readonly modelAlias: string;
	/** Supplies the already reserved completion allowance without enlarging a compiled ceiling. */
	readonly maxCompletionTokens: number;
	/** Ends this call's admitted authority, including time spent receiving the response. */
	readonly notAfterEpochMs: number;
	/** Allows a first proposal or forbids all tool declarations in this exchange. */
	readonly tools: ConversationModelToolModes;
	/** Supplies one saved call/result pair; a continuation must use tools None. */
	readonly continuation: ConversationModelContinuation | null;
}
