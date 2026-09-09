import type { EncryptedConversationPrivatePayload } from "../conversation-private-payload.types";
import type { ConversationComputerCredentialIssueCommand, ConversationComputerCredentialReuseCommand } from "../conversation-computer-turn.types";

/**
 * Tracks issuance and cleanup in ConversationComputerAttemptCredential.state.
 * The issuer branches on this closed set; unknown stored values refuse work. Values are persisted,
 * so renaming one changes the custody protocol. Revoked retains the spent attempt after secrets clear.
 */
export enum ConversationComputerCredentialStates
{
	/** A caller owns a mint claim; its provider outcome may still be unknown. */
	Pending = "pending",
	/** The encrypted key committed but current-lease promotion is still owed. */
	Custodied = "custodied",
	/** The committed key may be reused while its expiry and current authority remain valid. */
	Ready = "ready",
	/** Issuance failed before usable custody; the provider alias still needs cleanup. */
	AliasCleanup = "alias_cleanup",
	/** Cleanup owns this row; no caller may use or replace its key. */
	Revoking = "revoking",
	/** Provider cleanup completed and secrets were cleared; this attempt cannot mint again. */
	Revoked = "revoked",
}

/**
 * Selects the next issuance step after reading or claiming a credential. These values remain within
 * this package and are not persisted. Cleanup outcomes never authorize another provider issue.
 */
export enum ConversationComputerCredentialPreparationOutcomes
{
	/** A newly inserted Pending row grants this caller its first provider issue. */
	Claim = "claim",
	/** The provider outcome is uncertain; cleanup must precede refusal of another issue. */
	AliasCleanup = "alias_cleanup",
	/** The first encrypted key exists and still needs current-lease promotion. */
	Custody = "custody",
	/** The first key is ready and may be returned within its checked authority. */
	Ready = "ready",
	/** The key is expired or being revoked; cleanup must precede refusal of replacement. */
	Expired = "expired",
}

/**
 * A fresh claim must have its insert fence, while every recovery outcome must have the stored row.
 * The union prevents a recovery result from accidentally authorizing a provider mint.
 */
export type ConversationComputerCredentialPreparation =
	| { readonly outcome: ConversationComputerCredentialPreparationOutcomes.Claim; readonly fence: string }
	| { readonly outcome: Exclude<ConversationComputerCredentialPreparationOutcomes, ConversationComputerCredentialPreparationOutcomes.Claim>; readonly row: ConversationComputerCredentialCustody };

/** Encrypted attempt-key custody retained independently of provider cleanup availability. */
export interface ConversationComputerCredentialCustody
{
	/** Identifies the spent-or-recoverable attempt independently of key cleanup. */
	readonly bootstrapId: string;
	/** Binds custody to the configured silo. */
	readonly siloId: string;
	/** Binds custody to its conversation. */
	readonly conversationId: string;
	/** Identifies the provider key even when its raw bytes were never saved. */
	readonly keyAlias: string;
	/** Retains the model selected when the attempt was admitted. */
	readonly modelAlias: string;
	/** Selects issuance, reuse and cleanup behavior from the persisted state table. */
	readonly state: ConversationComputerCredentialStates;
	/** Prevents a caller that lost ownership from promoting or clearing custody. */
	readonly claimFence: string;
	/** Bounds how long Pending may block cleanup of an uncertain provider issue. */
	readonly claimExpiresAt: Date;
	/** Records the actual provider-key expiry; reuse cannot renew it. */
	readonly expiresAt: Date;
	/** Selects the encryption key, or is null before custody and after completed cleanup. */
	readonly keyId: string | null;
	/** Stores the encryption nonce while key custody exists. */
	readonly nonce: Uint8Array | null;
	/** Authenticates the encrypted key and its bound conversation coordinates. */
	readonly authTag: Uint8Array | null;
	/** Stores the encrypted provider key until cleanup succeeds. */
	readonly ciphertext: Uint8Array | null;
	/** Detects changes to the encrypted bytes. */
	readonly ciphertextDigest: string | null;
	/** Binds future reuse to the original decrypted key. */
	readonly credentialDigest: string | null;
}

/** Transaction-bound operations used by the two-phase credential unit of work. */
export interface ConversationComputerCredentialPersistenceRepository
{
	/** Claims a missing attempt or returns the saved state without authorizing a replacement key. */
	prepare(input: ConversationComputerCredentialIssueCommand): Promise<ConversationComputerCredentialPreparation>;
	/** Read the original ready custody under the current lease without claiming or creating a key. */
	reuseExact(input: ConversationComputerCredentialReuseCommand): Promise<ConversationComputerCredentialCustody>;
	/** Saves encrypted custody only while the original Pending fence still holds. */
	storeCustody(input: ConversationComputerCredentialIssueCommand, fence: string, encrypted: EncryptedConversationPrivatePayload, credentialDigest: string, expiresAt: string): Promise<void>;
	/** Promotes the committed key after rechecking its active lease, expiry and claim fence. */
	finalize(input: ConversationComputerCredentialIssueCommand, fence: string): Promise<void>;
	/** Retains an uncertain provider alias after a pre-custody failure; null means the claim was lost. */
	markAliasCleanup(bootstrapId: string, fence: string): Promise<ConversationComputerCredentialCustody | null>;
	/** Clear secrets after revocation while preserving the marker that prevents another mint. */
	finishRevocation(bootstrapId: string, fence: string): Promise<void>;
	/** Claims cleanup without racing live issuance; null means no work or a competing cleanup claim. */
	claimRevocation(bootstrapId: string): Promise<ConversationComputerCredentialCustody | null>;
}
