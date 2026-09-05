import type { ConversationComputer, ConversationEntry } from "@opencrane/contracts";

import type { ConversationPrivatePayloadCipher } from "./conversation-private-payload.types";
import type { ConversationCaller } from "./types/conversation-caller.types";

/**
 * Reports whether participant message admission created history or recognized the same command.
 *
 * The HTTP boundary returns both outcomes as success. `Idempotent` means the existing immutable
 * position is the result of this retry; it does not authorize a new activation or append.
 */
export enum ConversationMessageAdmissionOutcomes
{
	/** A new encrypted payload and immutable history entry were accepted. */
	Accepted = "accepted",
	/** The exact prior command was found without appending another entry. */
	Idempotent = "idempotent",
}

/**
 * Selects the agent-work transition committed with one participant text message.
 *
 * The server validates these closed wire values before admission. `Start` requests work after the
 * message commits, while `Interrupt` first requests that current work stop; neither value grants
 * permission without the participant and computer checks in the authority.
 */
export enum ConversationMessageActivations
{
	/** Records a message without requesting agent work. */
	None = "none",
	/** Requests fresh agent work after the message is committed. */
	Start = "start",
	/** Requests interruption of current work before fresh agent work. */
	Interrupt = "interrupt",
}

/** Validated participant text-message command. */
export interface ConversationMessageCommand
{
	/** Selects whether this message requests agent work. */
	readonly activation: ConversationMessageActivations;
	/** UUID that deduplicates the browser command and KurrentDB event. */
	readonly idempotencyKey: string;
	/** Plaintext accepted only at the encryption boundary. */
	readonly text: string;
}

/** Safe participant response for a committed or exactly repeated message. */
export interface ConversationMessageAdmissionResult
{
	/** States whether this call appended or found the immutable entry. */
	readonly outcome: ConversationMessageAdmissionOutcomes;
	/** Identifies the immutable conversation stream position. */
	readonly position: string;
}

/** Participant-visible Kurrent history plus separately decrypted private payloads. */
export interface SelfConversationHistoryResult
{
	/** Current logical computer for an agent session, or null for direct and group conversations. */
	readonly computer: ConversationComputer | null;
	/** Immutable KurrentDB entries whose opaque payload references remain unchanged. */
	readonly entries: readonly ConversationEntry[];
	/** Last returned position, the supplied cursor, or zero for an empty initial stream. */
	readonly nextPosition: string;
	/** Separately authorized plaintext indexed by the opaque payload reference. */
	readonly payloads: Readonly<Record<string, string>>;
}

/** Resolves an authenticated browser request without accepting identity from its payload. */
export type ConversationCallerResolver = (request: import("express").Request) => ConversationCaller | null;

/** Loads the current checked logical computer from its KurrentDB stream. */
export interface ConversationComputerReader
{
	/** Loads an exact computer projection coordinate tuple or returns null for a missing stream. */
	load(command: { readonly siloId: string; readonly computerId: string; readonly conversationId: string; readonly agentIdentityId: string; readonly profileRevisionId: string }): Promise<{ readonly computer: ConversationComputer; readonly lease: import("@opencrane/contracts").ComputerLease | null } | null>;
}

/** Dependencies owned by the participant conversation HTTP adapter. */
export interface SelfConversationHistoryRouterDependencies
{
	/** Applies participant authorization, payload persistence, and KurrentDB history operations. */
	readonly authority: SelfConversationHistoryAuthority;
	/** Resolves trusted identity from the authenticated server request. */
	readonly resolveCaller: ConversationCallerResolver;
}

/** Participant-facing history authority kept independent of Express. */
export interface SelfConversationHistoryAuthority
{
	/** Reads one exclusive-cursor page after current access is rechecked. */
	read(caller: ConversationCaller, conversationId: string, afterPosition?: bigint): Promise<SelfConversationHistoryResult | null>;
	/** Encrypts and appends one participant text message after current access is rechecked. */
	postMessage(caller: ConversationCaller, conversationId: string, command: ConversationMessageCommand): Promise<ConversationMessageAdmissionResult | null>;
}

/** Complete dependencies for the production Prisma and Kurrent-backed authority. */
export interface PrismaSelfConversationHistoryDependencies
{
	/** Decrypts and encrypts payloads only after the unit of work checks access. */
	readonly cipher: ConversationPrivatePayloadCipher;
	/** Resolves current computer state from KurrentDB using projection coordinates. */
	readonly computerReader: ConversationComputerReader;
}
