import type { ConversationModelToolCall } from "@opencrane/contracts";
import type { RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";
import type { ToolResultDeliveryPayload } from "@opencrane/backend/server/iam/authorization";

import type { ConversationComputerModelReservation } from "./conversation-computer-model.types";
import type { FrozenConversationComputerTurn } from "./conversation-computer-turn.types";

/**
 * Retains the first accepted tool declaration in encrypted storage before selection or admission.
 * Recovery may use its original acceptance time after the request deadline has elapsed. That proves
 * when the response was accepted; the caller must still check current authority before continuing.
 */
export interface ConversationComputerToolDeclaration
{
	readonly bootstrapId: string;
	readonly runId: string;
	readonly attempt: number;
	readonly compiledInputDigest: string;
	readonly modelInvocationFence: string;
	/** Records when the live handler accepted the response within its request deadline. */
	readonly acceptedAtEpochMs: number;
	/** Preserves any shorter deadline observed immediately before the first dispatch. */
	readonly requestNotAfterEpochMs: number;
	/** Requires continuation to reuse the key that produced this declaration. */
	readonly credentialDigest: string;
	/** Preserves that key's actual expiry; recovery cannot renew it. */
	readonly credentialExpiresAt: string;
	/** Keeps the original provider call id and argument text for the later assistant/tool pair. */
	readonly call: ConversationModelToolCall;
}

/** Refers to encrypted content without placing arguments, results or credentials in KurrentDB. */
export interface ConversationComputerPrivateModelReference
{
	readonly payloadRef: string;
	readonly ciphertextDigest: string;
}

/** Selects the sole tool slot after the first model declaration has entered encrypted custody. */
export interface ConversationComputerToolSelection extends ConversationComputerPrivateModelReference
{
	readonly proposalId: string;
	readonly requestFingerprint: string;
}

/** Saves the assistant/tool pair privately so continuation does not alter the compiled conversation head. */
export interface ConversationComputerToolContinuation
{
	readonly bootstrapId: string;
	readonly runId: string;
	readonly attempt: number;
	readonly compiledInputDigest: string;
	readonly declaration: ConversationComputerPrivateModelReference;
	readonly proposalId: string;
	readonly resultDigest: string;
	readonly call: ConversationModelToolCall;
	readonly resultContent: string;
}

/**
 * Consumes the final request allowance at turn revision 3, before result delivery is acknowledged.
 * The first token reservation remains spent. Reading this record after restart cannot reacquire
 * dispatch, even if acknowledgement or the model response was lost.
 */
export interface ConversationComputerContinuationReservation extends Omit<ConversationComputerModelReservation, "ordinal">
{
	readonly ordinal: 2;
	readonly continuation: ConversationComputerPrivateModelReference;
	readonly proposalId: string;
	readonly resultDigest: string;
}

/**
 * Retains encrypted content under references derived from the original first reservation.
 * Writes must recover identical content and refuse replacements. Declaration reads can recover
 * after custody committed but before selection was recorded; neither read grants current authority.
 */
export interface ConversationComputerModelCustody
{
	/** Commit the accepted declaration before recording its tool selection. */
	storeDeclaration(turn: FrozenConversationComputerTurn, declaration: ConversationComputerToolDeclaration): Promise<ConversationComputerPrivateModelReference>;
	/** Return absent custody as null; malformed or altered saved content must throw. */
	loadDeclaration(turn: FrozenConversationComputerTurn): Promise<{ readonly declaration: ConversationComputerToolDeclaration; readonly reference: ConversationComputerPrivateModelReference } | null>;
	/** Commit the assistant/tool pair before reserving the final request. */
	storeContinuation(turn: FrozenConversationComputerTurn, continuation: ConversationComputerToolContinuation): Promise<ConversationComputerPrivateModelReference>;
	/** Require the saved ciphertext reference; missing or mismatched content must throw. */
	loadContinuation(turn: FrozenConversationComputerTurn, reference: ConversationComputerPrivateModelReference): Promise<ConversationComputerToolContinuation>;
}

/**
 * Tells the conversation loop whether the original tool result can support continuation now.
 * These closed in-process outcomes are not persisted run states or Pod responses. Available still
 * requires a fresh model reservation; Pending and Unavailable never authorise model dispatch.
 */
export enum ConversationComputerToolResultOutcomes
{
	/** The original invocation has no usable terminal result yet. */
	Pending = "pending",
	/** Exact terminal content and current authority permit a bounded continuation. */
	Available = "available",
	/** Current authority or result integrity refuses further model work. */
	Unavailable = "unavailable",
}

/** Supplies only validated result content after the same transaction checks current authority. */
export type ConversationComputerToolResult =
	| { readonly outcome: ConversationComputerToolResultOutcomes.Pending | ConversationComputerToolResultOutcomes.Unavailable; readonly waitFor?: "approval" | "result"; readonly waitUntilEpochMs?: number }
	| { readonly outcome: ConversationComputerToolResultOutcomes.Available; readonly payload: ToolResultDeliveryPayload; readonly payloadDigest: string; readonly notAfterEpochMs: number };

/**
 * Reads the original invocation under current authority without consuming its delivery.
 * Acknowledgement requires the saved final-request reservation and matching result digest, so a
 * restart cannot consume a result before it has retained the content needed for continuation.
 */
export interface ConversationComputerToolResults
{
	/** Return current permission and validated terminal content without acknowledging delivery. */
	read(turn: FrozenConversationComputerTurn, workload: RuntimeWorkloadIdentity): Promise<ConversationComputerToolResult>;
	/** Acknowledge only the result bound to the saved continuation, with fresh authority checks. */
	consume(turn: FrozenConversationComputerTurn, workload: RuntimeWorkloadIdentity): Promise<ConversationComputerToolResult>;
}
