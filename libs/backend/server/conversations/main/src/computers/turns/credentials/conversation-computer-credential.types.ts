import type { ConversationComputerCredentialIssueCommand, ConversationComputerRawCredentialAuthority } from "../../../conversation-computer-turn.types";
import type { ConversationComputerCredentialCustody, ConversationComputerCredentialPersistenceRepository, ConversationComputerCredentialPreparation } from "../../../db/conversation-computer-credential-persistence.types";

/** Preserves the provider's issued key and reported expiry without duplicating its return contract. */
export type IssuedConversationComputerCredential = Awaited<ReturnType<ConversationComputerRawCredentialAuthority["issue"]>>;

/** Complete encrypted fields required to return or revoke the original provider key. */
export type EncryptedConversationComputerCredentialCustody = ConversationComputerCredentialCustody &
{
	/** Selects the mounted encryption key. */
	readonly keyId: string;
	/** Stores the original encryption nonce. */
	readonly nonce: Uint8Array;
	/** Authenticates the encrypted key and its conversation coordinates. */
	readonly authTag: Uint8Array;
	/** Stores the encrypted provider key. */
	readonly ciphertext: Uint8Array;
	/** Detects changes to the encrypted bytes. */
	readonly ciphertextDigest: string;
	/** Binds the saved receipt to the decrypted provider key. */
	readonly credentialDigest: string;
};

/**
 * Runs each persistence operation in its own transaction. The operation must never call a provider;
 * issuance and revocation run after this promise settles and releases the transaction.
 */
export interface ConversationComputerCredentialTransactions
{
	/** Commits one repository operation or propagates its error after rollback. */
	run<TResult>(operation: (repository: ConversationComputerCredentialPersistenceRepository) => Promise<TResult>): Promise<TResult>;
}

/** Defines issuance, reuse and cleanup behavior for one persisted credential state. */
export interface ConversationComputerCredentialStatePolicy
{
	/** Chooses how issuance must continue from the existing row; never grants a new mint. */
	prepare(row: ConversationComputerCredentialCustody, input: ConversationComputerCredentialIssueCommand): ConversationComputerCredentialPreparation;
	/** Allows reuse only when the existing state is Ready; receipt checks still apply. */
	readonly reusable: boolean;
	/** Returns whether cleanup must claim the row, or throws while issuance still owns a live claim. */
	requiresRevocation(row: ConversationComputerCredentialCustody): boolean;
}
