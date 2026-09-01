import type { ConversationComputerRuntimeCommandEnvelope, ConversationComputerRuntimeTerminalReport } from "@opencrane/contracts";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";

import type { ConversationComputerHistory } from "./conversation-computer-history";

/** Supplies the server-owned clock used to issue and expire target runtime commands. */
export interface ConversationComputerRuntimeCommandClock
{
	/** Returns the current server time without letting a runtime choose a command deadline. */
	now(): Date;
}

/** Binds the authority to checked computer history and the command-only KurrentDB stream. */
export interface ConversationComputerRuntimeCommandAuthorityDependencies
{
	/** Reads and atomically appends only the computer and per-execution command streams. */
	readonly history: Pick<HistoryStore, "appendAtomic" | "readHead" | "readStream">;
	/** Derives the active execution from trusted computer history before every command operation. */
	readonly computers: Pick<ConversationComputerHistory, "loadActiveExecutionForServer">;
	/** Supplies the server time that fences command eligibility and expiry. */
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
	readonly inputPayloadRef: string;
	/** Binds the protected input reference to its canonical content digest. */
	readonly inputPayloadDigest: `sha256:${string}`;
}

/** Asks for the oldest uncompleted command on the exact current computer execution. */
export type ConversationComputerRuntimeCommandPollCommand = ConversationComputerRuntimeCommandCurrentCommand;

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

/** Returns the oldest pending command, or null when the active execution has no runnable work. */
export interface ConversationComputerRuntimeCommandPollResult
{
	/** Carries the only command the runtime may process next, or null when no command is pending. */
	readonly command: ConversationComputerRuntimeCommandEnvelope | null;
}
