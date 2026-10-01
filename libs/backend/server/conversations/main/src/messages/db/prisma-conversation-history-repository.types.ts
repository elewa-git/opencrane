import type { ConversationPrivatePayloadCoordinates, EncryptedConversationPrivatePayload } from "@opencrane/backend/server/conversations/history";
import type { ConversationCaller } from "../../authorization/conversation-caller.types";
import type { ConversationMessageCommand } from "../self-conversation-history.types";

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
	readonly mode: "AgentSession" | "Direct" | "Group";
	/** First immutable entry position visible under this participant's current membership. */
	readonly visibleFromPosition: bigint;
}

/** Encrypted row shape returned without ever materializing plaintext in Prisma data. */
export interface StoredConversationPrivatePayload extends EncryptedConversationPrivatePayload
{
	/** Immutable coordinates authenticated into the stored ciphertext. */
	readonly coordinates: ConversationPrivatePayloadCoordinates;
	/** Browser retry key used to find the winning encrypted payload. */
	readonly idempotencyKey: string;
}

/** Encrypted message intent whose retry and activation coordinates are recorded with Use admission. */
export interface ConversationMessagePayloadAdmissionCommand extends Pick<ConversationMessageCommand, "idempotencyKey" | "activation" | "assetIds">
{
	/** Newly generated payload reference, used only if no stored retry row wins. */
	readonly payloadRef: string;
	/** Ciphertext created before the transaction; plaintext must never enter repository arguments. */
	readonly payload: EncryptedConversationPrivatePayload;
}

/** Current projection and winning payload admitted together in the message transaction. */
export interface AdmittedConversationMessagePayload
{
	/** States whether this transaction created the retry row rather than reading its winner. */
	readonly created: boolean;
	/** Participant and computer facts checked in the transaction that records admission. */
	readonly projection: AuthorizedConversationProjection;
	/** Existing retry row or the ciphertext created by this transaction. */
	readonly payload: StoredConversationPrivatePayload;
}

/** Transaction-scoped projection and encrypted-payload persistence boundary. */
export interface ConversationHistoryRepository
{
	/** Rechecks membership, participation, lifecycle, and product authorization for a read. */
	authorizeRead(caller: ConversationCaller, conversationId: string): Promise<AuthorizedConversationProjection | null>;
	/** Rechecks current eligibility without recording a write or effect admission. */
	authorizeWrite(caller: ConversationCaller, conversationId: string): Promise<AuthorizedConversationProjection | null>;
	/** Records Use for the winning payload before creating ciphertext and list ordering in the caller's Serializable transaction. The caller must compare retry plaintext before committing. */
	admitMessagePayload(caller: ConversationCaller, conversationId: string, command: ConversationMessagePayloadAdmissionCommand): Promise<AdmittedConversationMessagePayload | null>;
	/** Creates an encrypted payload or returns the exact winning retry row. */
	createOrReadPayload(caller: ConversationCaller, conversationId: string, idempotencyKey: string, payloadRef: string, payload: EncryptedConversationPrivatePayload): Promise<{ readonly created: boolean; readonly payload: StoredConversationPrivatePayload }>;
	/** Loads only encrypted payloads owned by one currently authorized conversation. */
	readPayloads(caller: ConversationCaller, conversationId: string, payloadRefs: readonly string[]): Promise<readonly StoredConversationPrivatePayload[]>;
}
