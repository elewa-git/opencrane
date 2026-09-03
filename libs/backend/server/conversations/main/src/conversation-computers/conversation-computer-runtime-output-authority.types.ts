import type { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";

import type { ConversationHistoryReader } from "../conversation-history-reader";
import type { ConversationComputerHistory } from "./conversation-computer-history";
import type { ConversationComputerRuntimeOutputClaim, ConversationComputerRuntimeOutputClaimCommand } from "./conversation-computer-runtime-command-authority.types";

/**
 * Carries text from the authenticated runtime for one server-issued command.
 *
 * The runtime echoes the execution and lease coordinates; it never supplies the agent author or a
 * conversation position. {@link ConversationComputerRuntimeOutputAuthority} reloads those values
 * before writing, so a response from a retired execution is rejected instead of becoming a message.
 */
export interface ConversationComputerRuntimeOutputCommand extends ConversationComputerRuntimeOutputClaimCommand
{
	/** Names the profile revision derived from the active computer. */
	readonly profileRevisionId: string;
	/** Carries bounded text that storage encrypts before history append. */
	readonly text: string;
}

/** Supplies the server-owned time stamped on an accepted runtime output entry. */
export interface ConversationComputerRuntimeOutputClock
{
	/** Returns the current server time after every output authority condition is checked. */
	now(): Date;
}

/**
 * Supplies the small set of reads and writes that make a runtime output one atomic operation.
 *
 * Implementations must preserve the command claim and conversation append in the same
 * {@link HistoryStore.appendAtomic} call. A separate append would let completion win between the
 * claim check and the visible message write.
 */
export interface ConversationComputerRuntimeOutputAuthorityDependencies
{
	/** Atomically appends the command terminal transition and participant-visible entry. */
	readonly history: Pick<HistoryStore, "appendAtomic">;
	/** Rechecks the computer's active execution before storing or publishing output. */
	readonly computers: Pick<ConversationComputerHistory, "loadActiveExecutionForRuntime">;
	/** Resolves the active agent identity and its history conditions for author stamping. */
	readonly identities: Pick<AgentIdentityHistory, "loadActiveAuthorization">;
	/** Replays the transcript to replay exact retries and fence the next entry position. */
	readonly conversations: Pick<ConversationHistoryReader, "readCurrent">;
	/** Prepares the command-stream terminal append that must share this transaction. */
	readonly claims: ConversationComputerRuntimeOutputClaimAuthority;
	/** Encrypts output before only opaque coordinates reach conversation history. */
	readonly payloads: ConversationComputerRuntimeOutputPayloadStore;
	/** Supplies the authoritative time stamped on a first durable output. */
	readonly clock: ConversationComputerRuntimeOutputClock;
}

/**
 * Prepares the command-stream transition for an accepted runtime output.
 *
 * The returned head and append describe the same pending command. Its caller must append them with
 * the conversation entry so output and terminal completion contend on that head rather than both
 * being accepted.
 */
export interface ConversationComputerRuntimeOutputClaimAuthority
{
	/** Returns the exact command head and event that records the output claim. */
	prepareOutputClaim(command: ConversationComputerRuntimeOutputClaimCommand): Promise<ConversationComputerRuntimeOutputClaim>;
}

/**
 * Stores a command-owned text body and returns the opaque coordinates safe for conversation history.
 *
 * Repeating the same idempotency key must return the same stored body or reject a changed retry;
 * the output authority compares those coordinates before treating a previously written message as
 * the retry winner.
 */
export interface ConversationComputerRuntimeOutputPayloadStore
{
	/** Encrypts the first exact body for the output command. */
	storeText(command: { readonly siloId: string; readonly conversationId: string; readonly idempotencyKey: string; readonly text: string }): Promise<{ readonly payloadRef: `payload://${string}`; readonly ciphertextDigest: `sha256:${string}` }>;
}

/**
 * Returns the message receipt for an accepted runtime command.
 *
 * The identifier is also returned when a lost response retries an already-recorded matching output,
 * so callers can acknowledge the durable result without a second history append.
 */
export interface ConversationComputerRuntimeOutputResult
{
	/** Identifies the first durable conversation append for the command. */
	readonly messageId: string;
}
