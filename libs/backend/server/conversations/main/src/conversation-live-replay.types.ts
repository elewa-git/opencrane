import type { AgUiProjectionSourceEvent } from "@opencrane/contracts";
import type { ConversationReplayCursor } from "@opencrane/models/conversations";

import type { ConversationReplayUnitOfWork } from "./replay-reader.types.js";

/** Limits for one bounded live response. Clients reconnect after the duration fence. */
export interface ConversationLiveReplayLimits
{
	readonly pageSize: number;
	readonly pollMilliseconds: number;
	readonly heartbeatMilliseconds: number;
	readonly maximumDurationMilliseconds: number;
}

/** Sink kept independent of Express so snapshot/tail invariants are deterministic in tests. */
export interface ConversationLiveReplaySink
{
	open(): void;
	/** Write one complete SSE frame and report whether the writable buffer remains below its limit. */
	write(value: string): boolean;
	/** Wait until a full writable buffer drains or the request is aborted. */
	drain(signal: AbortSignal): Promise<void>;
}

/** Query for still-actionable approval interrupts. */
export interface ReadOpenConversationInterruptsCommand
{
	readonly conversationId: string;
	readonly siloId: string;
	readonly subjectId: string;
}

/** Optional approval overlay owner. Returned events omit a cursor by contract. */
export interface ConversationOpenInterruptReader
{
	readOpen(command: ReadOpenConversationInterruptsCommand): Promise<readonly AgUiProjectionSourceEvent[]>;
}

/** Injectable time/wait seam for bounded production polling and deterministic tests. */
export interface ConversationLiveReplayClock
{
	now(): number;
	wait(milliseconds: number, signal: AbortSignal): Promise<void>;
}

/** Dependencies for one authorized snapshot-to-tail stream. */
export interface ConversationLiveReplayDependencies
{
	readonly repository: ConversationReplayUnitOfWork;
	readonly interrupts?: ConversationOpenInterruptReader;
	readonly clock: ConversationLiveReplayClock;
	readonly limits: ConversationLiveReplayLimits;
}

/** Coordinates derived from trusted session or consumed channel context. */
export interface StreamConversationLiveReplayCommand
{
	readonly conversationId: string;
	readonly siloId: string;
	readonly subjectId: string;
	readonly cursor: ConversationReplayCursor | null;
	readonly signal: AbortSignal;
}

/** Terminal reason for one bounded response. */
export enum ConversationLiveReplayOutcomes
{
	DurationReached = "duration_reached",
	Disconnected = "disconnected",
	RevokedOrMissing = "revoked_or_missing",
}
