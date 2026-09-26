import type { ManagedAgentConversationDependencies } from "@opencrane/backend/server/agents/agent-services";
import type { PrepareRoutineOccurrenceCommand, RoutineOccurrencePreparationReceipt, RoutineOccurrencePreparationRepositoryFactory } from "@opencrane/backend/server/agents/scheduling/contract";
import type { ConversationPrivatePayloadCipher, EncryptedConversationPrivatePayload } from "@opencrane/backend/server/conversations/history";

import type { RoutineOccurrenceHistory } from "./routine-occurrence-history";
import type { RoutineOccurrenceHistoryRecord } from "./routine-occurrence-history.types";

/** Supplies existing authorities without giving conversations ownership of routine persistence. */
export interface RoutineOccurrencePreparationDependencies<Transaction>
{
	/** Rechecks the firing and records publication using the caller's transaction. */
	readonly routines: RoutineOccurrencePreparationRepositoryFactory<Transaction>;
	/** Reads existing managed identities and deployment-selected computer profiles. */
	readonly agents: ManagedAgentConversationDependencies;
	/** Encrypts instruction bytes and checks the first stored ciphertext on replay. */
	readonly cipher: ConversationPrivatePayloadCipher;
	/** Establishes or verifies occurrence history outside database transaction retries. */
	readonly history: Pick<RoutineOccurrenceHistory, "establish" | "readRecord">;
}

/** Keeps the initial database result content-free once the encrypted instruction has been saved. */
export interface RoutineOccurrencePreparedProjection
{
	/** Coordinates and encrypted-byte digest that must match immutable history. */
	readonly record: RoutineOccurrenceHistoryRecord;
	/** Existing publication marker, or null before audience publication commits. */
	readonly preparation: RoutineOccurrencePreparationReceipt | null;
}

/** Carries an encrypted candidate and the original text only for checking ciphertext on retries. */
export interface RoutineOccurrenceProjectionStage
{
	/** Frozen firing, audience and instruction supplied by the scheduling workflow. */
	readonly command: PrepareRoutineOccurrenceCommand;
	/** Ciphertext created before entering the database retry callback. */
	readonly payload: EncryptedConversationPrivatePayload;
	/** Prevents final publication and historical replay from recreating missing rows. */
	readonly requireExisting: boolean;
	/** A saved receipt suppresses eligibility resolution and all access restoration on replay. */
	readonly published: boolean;
}

/** Owns hidden conversation and audience writes inside the caller's Serializable transaction. */
export interface RoutineOccurrenceProjectionRepository
{
	/** Returns null for confirmed managed eligibility loss; integrity and transport errors propagate. */
	stage(input: RoutineOccurrenceProjectionStage): Promise<RoutineOccurrenceHistoryRecord | null>;
	/** Publishes the frozen audience once; the caller must commit its firing receipt in this transaction. */
	publish(record: RoutineOccurrenceHistoryRecord): Promise<void>;
}
