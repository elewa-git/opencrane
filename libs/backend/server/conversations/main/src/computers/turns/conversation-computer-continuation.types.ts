import type { ConversationModelToolCall } from "@opencrane/contracts";
import type { RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";
import type { ToolResultDeliveryPayload } from "@opencrane/backend/server/iam/authorization";

import type { ConversationGeneratedFileContinuation } from "../tools/results/conversation-generated-file-result.types";
import type { ConversationComputerPrivateModelReference } from "./conversation-computer-turn-protocol.types";
import type { FrozenConversationComputerTurn } from "./conversation-computer-turn.types";

/**
 * Retains an accepted tool declaration in encrypted storage before selection or admission.
 * Recovery may use its original acceptance time after the request deadline has elapsed. That proves
 * when the response was accepted; the caller must still check current authority before continuing.
 */
export interface ConversationComputerToolDeclaration
{
	/** Names the frozen conversation turn that owns this private content. */
	readonly bootstrapId: string;
	/** Names the admitted run whose model produced this content. */
	readonly runId: string;
	/** Preserves the admitted run attempt across recovery. */
	readonly attempt: number;
	/** Binds the content to the original compiled input. */
	readonly compiledInputDigest: string;
	/** Identifies the ordered model step that produced the declaration. */
	readonly ordinal: number;
	/** Names the model reservation that accepted the response. */
	readonly modelInvocationFence: string;
	/** Records when the live handler accepted the response within its request deadline. */
	readonly acceptedAtEpochMs: number;
	/** Preserves the response deadline checked before this model request. */
	readonly requestNotAfterEpochMs: number;
	/** Requires continuation to reuse the key that produced this declaration. */
	readonly credentialDigest: string;
	/** Preserves that key's actual expiry; recovery cannot renew it. */
	readonly credentialExpiresAt: string;
	/** Keeps the original provider call id and argument text for the later assistant/tool pair. */
	readonly call: ConversationModelToolCall;
}

/** Saves one assistant/tool pair privately so ordered model history remains exact. */
export interface ConversationComputerToolExchange
{
	/** Names the frozen conversation turn that owns this private content. */
	readonly bootstrapId: string;
	/** Names the admitted run whose model produced this content. */
	readonly runId: string;
	/** Preserves the admitted run attempt across recovery. */
	readonly attempt: number;
	/** Binds the content to the original compiled input. */
	readonly compiledInputDigest: string;
	/** Identifies the ordered model step that produced the assistant declaration. */
	readonly ordinal: number;
	/** Binds the exchange to the model reservation that produced its declaration. */
	readonly modelInvocationFence: string;
	/** Points to the encrypted declaration saved for this step. */
	readonly declaration: ConversationComputerPrivateModelReference;
	/** Names the proposal admitted for this model step. */
	readonly proposalId: string;
	/** Names the exact invocation that supplied the result. */
	readonly toolInvocationId: string;
	/** Binds the pair to the immutable tool delivery payload. */
	readonly resultDigest: string;
	/** Preserves the provider call ID, tool name, arguments and assistant content. */
	readonly call: ConversationModelToolCall;
	/** Carries the private result and any final file-publication outcome to the next model. */
	readonly resultContent: string;
}

/**
 * Retains encrypted content under references derived from its ordered model reservation.
 * Writes must recover identical content and refuse replacements. Declaration reads can recover
 * after custody committed but before selection was recorded; neither read grants current authority.
 */
export interface ConversationComputerModelCustody
{
	/** Commit the accepted declaration before recording its tool selection. */
	storeDeclaration(turn: FrozenConversationComputerTurn, declaration: ConversationComputerToolDeclaration): Promise<ConversationComputerPrivateModelReference>;
	/** Return the current step's declaration, or the requested historical ordinal for credential reuse; malformed or altered content must throw. */
	loadDeclaration(turn: FrozenConversationComputerTurn, ordinal?: number): Promise<{ readonly declaration: ConversationComputerToolDeclaration; readonly reference: ConversationComputerPrivateModelReference } | null>;
	/** Commit the assistant/tool pair before reserving the next model request. */
	storeExchange(turn: FrozenConversationComputerTurn, exchange: ConversationComputerToolExchange): Promise<ConversationComputerPrivateModelReference>;
	/** Require the saved ciphertext reference; missing or mismatched content must throw. */
	loadExchange(turn: FrozenConversationComputerTurn, reference: ConversationComputerPrivateModelReference): Promise<ConversationComputerToolExchange>;
}

/**
 * Tells the conversation loop whether the current tool result can support its next bounded request.
 * These closed in-process outcomes are not persisted run states or Pod responses. Available still
 * requires a fresh model reservation; Pending and Unavailable never authorise model dispatch.
 */
export enum ConversationComputerToolResultOutcomes
{
	/** The original invocation has no usable terminal result yet. */
	Pending = "pending",
	/** Captured file bytes must finish promotion and scanning before this result can support continuation. */
	GeneratedFilePending = "generated_file_pending",
	/** Exact terminal content and current authority permit a bounded continuation. */
	Available = "available",
	/** Current authority or result integrity refuses further model work. */
	Unavailable = "unavailable",
}

/** Supplies only validated result content after the same transaction checks current authority. */
export type ConversationComputerToolResult =
	| { readonly outcome: ConversationComputerToolResultOutcomes.Pending | ConversationComputerToolResultOutcomes.Unavailable; readonly waitFor?: "approval" | "result"; readonly waitUntilEpochMs?: number }
	| { readonly outcome: ConversationComputerToolResultOutcomes.GeneratedFilePending; readonly operationId: string; readonly notAfterEpochMs: number }
	| { readonly outcome: ConversationComputerToolResultOutcomes.Available; readonly payload: ToolResultDeliveryPayload; readonly payloadDigest: string; readonly toolRevisionId: string; readonly occurredAt: string; readonly notAfterEpochMs: number; readonly generatedFile?: ConversationGeneratedFileContinuation };

/**
 * Reads the selected invocation under current authority without consuming its delivery.
 * Acknowledgement requires the saved next-model reservation and matching result digest, so a
 * restart cannot consume a result before it has retained the content needed for continuation.
 */
export interface ConversationComputerToolResults
{
	/** Return current permission and validated terminal content without acknowledging delivery. */
	read(turn: FrozenConversationComputerTurn, workload: RuntimeWorkloadIdentity): Promise<ConversationComputerToolResult>;
	/** Acknowledge only the result bound to the saved ordered step, with fresh authority checks. */
	consume(turn: FrozenConversationComputerTurn, workload: RuntimeWorkloadIdentity): Promise<ConversationComputerToolResult>;
}
