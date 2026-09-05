import type { ConversationMode } from "@prisma/client";

import type { ConversationPrivatePayloadCoordinates, EncryptedConversationPrivatePayload } from "../conversation-private-payload.types";
import type { ConversationCaller } from "../types/conversation-caller.types";

/** Current authorized projection coordinates required around one KurrentDB history operation. */
export interface AuthorizedConversationProjection
{
	/** Current peer-visible participant name stamped into a new immutable entry. */
	readonly authorName: string;
	/** KurrentDB computer identity coordinate, or null outside an agent session. */
	readonly computerAgentIdentityId: string | null;
	/** KurrentDB computer stream coordinate, or null outside an agent session. */
	readonly computerId: string | null;
	/** KurrentDB profile coordinate, or null outside an agent session. */
	readonly computerProfileRevisionId: string | null;
	/** Immutable conversation mode used to validate computer and activation shape. */
	readonly mode: ConversationMode;
}

/** Encrypted row shape returned without ever materializing plaintext in Prisma data. */
export interface StoredConversationPrivatePayload extends EncryptedConversationPrivatePayload
{
	/** Immutable coordinates authenticated into the stored ciphertext. */
	readonly coordinates: ConversationPrivatePayloadCoordinates;
	/** Browser retry key used to find the winning encrypted payload. */
	readonly idempotencyKey: string;
}

/** Transaction-scoped projection and encrypted-payload persistence boundary. */
export interface ConversationHistoryRepository
{
	/** Rechecks membership, participation, lifecycle, and product authorization for a read. */
	authorizeRead(caller: ConversationCaller, conversationId: string): Promise<AuthorizedConversationProjection | null>;
	/** Rechecks write access and returns current immutable-mode projection facts. */
	authorizeWrite(caller: ConversationCaller, conversationId: string): Promise<AuthorizedConversationProjection | null>;
	/** Creates an encrypted payload or returns the exact winning retry row. */
	createOrReadPayload(caller: ConversationCaller, conversationId: string, idempotencyKey: string, payloadRef: string, payload: EncryptedConversationPrivatePayload): Promise<{ readonly created: boolean; readonly payload: StoredConversationPrivatePayload }>;
	/** Loads only encrypted payloads owned by one currently authorized conversation. */
	readPayloads(caller: ConversationCaller, conversationId: string, payloadRefs: readonly string[]): Promise<readonly StoredConversationPrivatePayload[]>;
}
