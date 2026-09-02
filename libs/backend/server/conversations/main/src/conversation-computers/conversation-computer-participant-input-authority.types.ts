import type { ConversationEntry } from "@opencrane/contracts";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";

import type { ConversationHistoryReader } from "../conversation-history-reader";

/** Describes the authenticated participant whose input the server already authorized. */
export interface ConversationComputerParticipantInputAuthor
{
	/** Identifies the current product principal that submitted the input. */
	readonly principalId: string;
	/** Identifies the current conversation participant represented by that principal. */
	readonly participantId: string;
	/** Captures the participant name that history readers show for this immutable entry. */
	readonly name: string;
	/** Captures the optional immutable avatar revision visible when the entry was accepted. */
	readonly avatarArtifactRevisionId: string | null;
}

/** Carries the server-approved text that begins or resumes a ConversationComputer turn. */
export interface ConversationComputerParticipantInputCommand
{
	/** Names the silo that owns the conversation and protected input payload. */
	readonly siloId: string;
	/** Names the agent conversation whose history receives this entry. */
	readonly conversationId: string;
	/** Names the computer derived from the immutable agent conversation binding. */
	readonly computerId: string;
	/** Supplies the UUID request key that is also the immutable input entry identifier. */
	readonly inputId: string;
	/** Carries the browser text after the public transport has enforced its input bounds. */
	readonly text: string;
	/** Carries the participant coordinates selected by the authorization boundary. */
	readonly author: ConversationComputerParticipantInputAuthor;
}

/** Supplies the server-owned clock used to timestamp accepted participant input. */
export interface ConversationComputerParticipantInputClock
{
	/** Returns the current server time after the participant and history checks have completed. */
	now(): Date;
}

/** Stores participant input as ciphertext before its opaque reference reaches KurrentDB history. */
export interface ConversationComputerParticipantInputPayloadStore
{
	/** Stores an input body, or returns the same coordinates for an exact retry. */
	storeText(command: { readonly siloId: string; readonly conversationId: string; readonly idempotencyKey: string; readonly text: string }): Promise<{ readonly payloadRef: `payload://${string}`; readonly ciphertextDigest: `sha256:${string}` }>;
}

/** Connects input admission to immutable history and the private payload boundary. */
export interface ConversationComputerParticipantInputAuthorityDependencies
{
	/** Appends the participant entry under the conversation stream head that admission checked. */
	readonly history: Pick<HistoryStore, "appendAtomic">;
	/** Reads the immutable agent binding and the current transcript before each append. */
	readonly conversations: Pick<ConversationHistoryReader, "readCreation" | "readCurrent">;
	/** Encrypts the participant text before history receives a reference and digest. */
	readonly payloads: ConversationComputerParticipantInputPayloadStore;
	/** Supplies the server time stamped on a first accepted input entry. */
	readonly clock: ConversationComputerParticipantInputClock;
}

/** Returns the durable participant entry identifier for a new input or an exact retry. */
export interface ConversationComputerParticipantInputResult
{
	/** Identifies the immutable participant input entry that a command worker will later consume. */
	readonly inputEntryId: string;
}

/** Narrows entries while exact retry validation checks their human-authored input shape. */
export type ConversationComputerParticipantInputEntry = Extract<ConversationEntry, { readonly kind: "message" }>;
