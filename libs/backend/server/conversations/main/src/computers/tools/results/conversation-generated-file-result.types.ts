import type { ArtifactMessageContentBlock } from "@opencrane/contracts";
import type { ToolInvocationRecord, ToolResultDeliveryPayload } from "@opencrane/backend/server/iam/authorization";

import type { FrozenConversationComputerTurn } from "../../turns/conversation-computer-turn.types";
import type { ConversationToolDispatchAdmission } from "../dispatch/conversation-tool-dispatch.types";

/**
 * Selects whether a saved tool result can enter the final model call.
 * These in-process values are not saved on the invocation. Pending waits for the existing file
 * workflow; Ready requires a clean published revision and current read access. Unknown or
 * conflicting evidence is Unavailable and must never be treated as an ordinary tool result.
 */
export enum ConversationGeneratedFileResultStates
{
	/** No generated-file operation or generated metadata belongs to this invocation. */
	NotGenerated = "not_generated",
	/** Captured bytes still await promotion or a scanner outcome; no continuation may start. */
	Pending = "pending",
	/** The saved revision is Ready and current access permits its attachment. */
	Ready = "ready",
	/** The file reached a saved failure; a continuation may explain that failure without an attachment. */
	Failed = "failed",
	/** Current access or conflicting metadata refuses all further use of this result. */
	Unavailable = "unavailable",
}

/** Carries a saved file outcome alongside the original, unchanged tool-result digest. */
export type ConversationGeneratedFileContinuation =
	| { readonly state: ConversationGeneratedFileResultStates.Ready; readonly operationId: string; readonly artifact: ArtifactMessageContentBlock }
	| { readonly state: ConversationGeneratedFileResultStates.Failed; readonly operationId: string; readonly failureCode: string };

/** Returns only server-read file coordinates; this projection never contains file bytes. */
export type ConversationGeneratedFileResult =
	| { readonly state: ConversationGeneratedFileResultStates.NotGenerated }
	| { readonly state: ConversationGeneratedFileResultStates.Unavailable }
	| { readonly state: ConversationGeneratedFileResultStates.Pending; readonly operationId: string; readonly notAfterEpochMs: number }
	| ConversationGeneratedFileContinuation;

/** Binds the file lookup to the same invocation and current conversation decision as the result read. */
export interface ConversationGeneratedFileResultCommand
{
	/** The immutable admitted turn read from the turn store. */
	readonly turn: FrozenConversationComputerTurn;
	/** The invocation validated by IAM's result reader in this transaction. */
	readonly invocation: ToolInvocationRecord;
	/** The original result whose digest the continuation must preserve. */
	readonly payload: ToolResultDeliveryPayload;
	/** Current requester, conversation and execution evidence checked in this transaction. */
	readonly admission: ConversationToolDispatchAdmission;
}

/** Lets the file owner check its saved outcome without moving file persistence into conversations. */
export interface ConversationGeneratedFileResultRepository
{
	/** Refuse substituted metadata and return Pending until the saved file has a terminal outcome. */
	read(command: ConversationGeneratedFileResultCommand): Promise<ConversationGeneratedFileResult>;
}

/** Binds the file reader to the transaction that checks and consumes the original tool result. */
export interface ConversationGeneratedFileResultRepositoryFactory
{
	/** Use the supplied transaction for every file and current-access read. */
	(transaction: unknown): ConversationGeneratedFileResultRepository;
}
