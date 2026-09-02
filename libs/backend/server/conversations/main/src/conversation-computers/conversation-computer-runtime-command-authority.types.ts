import type { ConversationComputerRuntimeCommandEnvelope, ConversationComputerRuntimePrivatePayloadReference, ConversationComputerRuntimeTerminalReport } from "@opencrane/contracts";
import type { HistoryAppend, HistoryExpectedHead, HistoryStore } from "@opencrane/backend/server/infra/history-store";

import type { ConversationComputerHistory } from "./conversation-computer-history";

/** Supplies the server-owned clock used to timestamp target runtime commands. */
export interface ConversationComputerRuntimeCommandClock
{
	/** Returns the current server time without letting a runtime choose a command issuance timestamp. */
	now(): Date;
}

/** Binds the authority to checked computer history and the command-only KurrentDB stream. */
export interface ConversationComputerRuntimeCommandAuthorityDependencies
{
	/** Reads and atomically appends only the computer and per-execution command streams. */
	readonly history: Pick<HistoryStore, "appendAtomic" | "readHead" | "readStream">;
	/** Derives the active execution from trusted computer history before every command operation. */
	readonly computers: Pick<ConversationComputerHistory, "loadActiveExecutionForServer">;
	/** Supplies the server time that timestamps command issue independently from the Sandbox. */
	readonly clock: ConversationComputerRuntimeCommandClock;
}

/** Identifies a server-selected active execution without accepting its identity, profile, or lease. */
export interface ConversationComputerRuntimeCommandCurrentCommand
{
	/** Names the configured silo that owns the computer stream. */
	readonly siloId: string;
	/** Names the logical computer that owns its per-execution command stream. */
	readonly computerId: string;
	/** Names the computer's durable conversation whose input caused the command. */
	readonly conversationId: string;
}

/** Requests the next target turn from one server-admitted participant input entry. */
export interface ConversationComputerRuntimeStartTurnIssueCommand extends ConversationComputerRuntimeCommandCurrentCommand
{
	/** Supplies the UUID conversation entry identifier that makes this command retry idempotent. */
	readonly inputEntryId: string;
	/** References the protected input without storing its plaintext in the command stream. */
	readonly inputPayloadRef: ConversationComputerRuntimePrivatePayloadReference;
	/** Binds the protected input reference to its canonical content digest. */
	readonly inputPayloadDigest: `sha256:${string}`;
}

/** Carries one retained input candidate in transcript order for a single queue-advance attempt. */
export interface ConversationComputerRuntimeStartTurnCandidate
{
	/** Supplies the UUID conversation entry identifier that makes this candidate idempotent. */
	readonly inputEntryId: string;
	/** References the protected input without storing plaintext in the command stream. */
	readonly inputPayloadRef: ConversationComputerRuntimePrivatePayloadReference;
	/** Binds the protected input reference to its canonical ciphertext digest. */
	readonly inputPayloadDigest: `sha256:${string}`;
}

/** Requests the first unissued retained input only when the current execution queue is idle. */
export interface ConversationComputerRuntimeNextStartTurnIssueCommand extends ConversationComputerRuntimeCommandCurrentCommand
{
	/** Lists validated participant inputs in immutable conversation transcript order. */
	readonly candidates: readonly ConversationComputerRuntimeStartTurnCandidate[];
}

/** Asks for the oldest uncompleted command on the exact current computer execution. */
export type ConversationComputerRuntimeCommandPollCommand = ConversationComputerRuntimeCommandCurrentCommand;

/**
 * Selects the server-issued active command that may record one output message.
 *
 * The command, execution, and lease coordinates make this different from a general completion
 * request: output must reserve the command-stream head that terminal completion also changes. A
 * caller with a changed execution or lease receives no claim to append.
 */
export interface ConversationComputerRuntimeOutputClaimCommand extends ConversationComputerRuntimeCommandCurrentCommand
{
	/** Names the command whose output claim must conflict with terminal completion. */
	readonly commandId: string;
	/** Names the active execution echoed by the Sandbox command envelope. */
	readonly executionId: string;
	/** Fences the claim to the command's active lease generation. */
	readonly leaseGeneration: number;
}

/**
 * Carries the command-stream head condition and append for one output claim.
 *
 * Consumers append both values alongside the conversation message. Keeping the condition with its
 * event ensures competing completion and output writes cannot both pass the command head check.
 */
export interface ConversationComputerRuntimeOutputClaim
{
	/** Preserves the command-stream head that completion must also change. */
	readonly expectedHead: HistoryExpectedHead;
	/** Records one output claim in the per-execution command stream. */
	readonly append: HistoryAppend;
}

/** Records one bounded terminal result after the runtime has processed its oldest command. */
export interface ConversationComputerRuntimeCommandCompleteCommand extends ConversationComputerRuntimeCommandCurrentCommand
{
	/** Carries the fully fenced report whose coordinates must match the current execution and queued command. */
	readonly report: ConversationComputerRuntimeTerminalReport;
}

/** Returns the sole durable command issued for a server-admitted input entry. */
export interface ConversationComputerRuntimeCommandIssueResult
{
	/** Carries the exact queued command, including its server-generated sequence and expiry. */
	readonly command: ConversationComputerRuntimeCommandEnvelope;
}

/** Reports the one retained input that advanced an idle command queue, if any. */
export interface ConversationComputerRuntimeCommandNextIssueResult
{
	/** Carries one newly issued command, or null when input is exhausted or a command remains pending. */
	readonly command: ConversationComputerRuntimeCommandEnvelope | null;
}

/** Returns the oldest pending command, or null when the active execution has no runnable work. */
export interface ConversationComputerRuntimeCommandPollResult
{
	/** Carries the only command the runtime may process next, or null when no command is pending. */
	readonly command: ConversationComputerRuntimeCommandEnvelope | null;
}
