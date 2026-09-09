import type { A2UIEntry, ConversationEntryVisibility, LogEntry, MessageEntry } from "@opencrane/contracts";

/**
 * Describes the one server-minted stream and execution scope a writer may use.
 *
 * The binding joins the computer, current lease generation, agent identity, run, and expected stream
 * revision. The writer copies these coordinates into the append rather than trusting a computer
 * process to select them.
 */
export interface BoundConversationWriterBinding
{
	/** Identifies the silo that admitted this writer. */
	readonly siloId: string;
	/** Identifies the one conversation whose stream this writer may append. */
	readonly conversationId: string;
	/** Identifies the logical computer that owns this writer. */
	readonly computerId: string;
	/** Fences the writer to one active computer lease generation. */
	readonly leaseGeneration: number;
	/** Identifies the agent identity that the writer represents. */
	readonly agentIdentityId: string;
	/** Identifies the agent service represented by the writer. */
	readonly agentServiceId: string;
	/** Captures the historical agent name stamped on each entry. */
	readonly agentName: string;
	/** Captures the optional immutable avatar revision stamped on each entry. */
	readonly agentAvatarArtifactRevisionId: string | null;
	/** Identifies the fenced run that owns this short-lived writer. */
	readonly runId: string;
	/** States the exact conversation stream revision the writer must prove. */
	readonly expectedRevision: bigint;
	/** Limits the serialized entry size before it reaches KurrentDB. */
	readonly maximumEntryBytes: number;
}

/**
 * Lists fields that the bound writer stamps instead of accepting from a computer process.
 *
 * Removing these fields from the draft prevents a caller from selecting another conversation,
 * author, stream position, timestamp, or service attestation.
 */
export type ComputerStampedConversationEntryFields = "schemaVersion" | "id" | "conversationId" | "position" | "author" | "provenance" | "runId" | "idempotencyKey" | "occurredAt" | "attestation";

type _ComputerConversationEntryDraft<T> = T extends unknown ? Omit<T, ComputerStampedConversationEntryFields> : never;

/** Carries the message fields a computer may request for one bound append. */
export type ComputerMessageEntryDraft = _ComputerConversationEntryDraft<MessageEntry>;

/** Carries the log fields a computer may request for one bound append. */
export type ComputerLogEntryDraft = _ComputerConversationEntryDraft<LogEntry>;

/** Carries the A2UI fields a computer may request for one bound append. */
export type ComputerA2UIEntryDraft = _ComputerConversationEntryDraft<A2UIEntry>;

/**
 * Lists participant-visible entry variants a computer may ask its bound writer to create.
 *
 * These drafts omit server-stamped coordinates, but they still require structural validation and
 * current visibility authorization before an append.
 */
export type ComputerConversationEntryDraft = ComputerMessageEntryDraft | ComputerLogEntryDraft | ComputerA2UIEntryDraft;

/**
 * Requests one idempotent entry append through a short-lived bound writer.
 *
 * The source command identifier becomes the KurrentDB event identifier and the entry idempotency
 * key. Retrying after an uncertain response must use the same identifier.
 */
export interface BoundConversationWriterAppend
{
	/** Supplies a UUID source command identifier used as the KurrentDB event identifier. */
	readonly sourceCommandId: string;
	/** Supplies the entry fields that are safe for the computer to request. */
	readonly entry: ComputerConversationEntryDraft;
}

/**
 * Limits how frequently one active writer may append its first entry.
 *
 * The writer checks this port before it stamps the entry. A response-lost retry reuses that entry
 * rather than consuming a second rate-budget decision.
 */
export interface BoundConversationWriterRateLimiter
{
	/** Refuses an append that exceeds the binding's current write budget. */
	assertMayAppend(binding: BoundConversationWriterBinding): Promise<void>;
}

/**
 * Checks whether the bound run may use a requested participant-visible audience.
 *
 * The policy runs before the entry is stamped so a computer cannot widen an audience through an
 * unchecked draft.
 */
export interface BoundConversationWriterVisibilityPolicy
{
	/** Refuses a visibility policy that the bound computer cannot currently use. */
	assertMayUseVisibility(binding: BoundConversationWriterBinding, visibility: ConversationEntryVisibility): Promise<void>;
}

/**
 * Fences each physical append to the binding's still-active computer lease and represented identity.
 *
 * The writer calls this port after it has saved the retry data and immediately before every checked
 * append, including a response-lost retry.
 */
export interface BoundConversationWriterLeaseFence
{
	/** Refuses an append when the bound computer, lease generation, identity, or run is no longer active. */
	assertMayAppend(binding: BoundConversationWriterBinding): Promise<void>;
}

/**
 * Supplies the authoritative append time for entries stamped by the writer boundary.
 *
 * The writer reads this clock only while it creates the first entry, keeping a response-lost retry
 * byte-stable even when it reaches KurrentDB later.
 */
export interface BoundConversationWriterClock
{
	/** Returns the current server time. */
	now(): Date;
}
