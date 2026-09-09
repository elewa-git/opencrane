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

/** Encrypted attempt-key custody retained independently of provider cleanup availability. */
export interface ConversationComputerCredentialCustody
{
	readonly bootstrapId: string;
	readonly siloId: string;
	readonly conversationId: string;
	readonly keyAlias: string;
	readonly modelAlias: string;
	readonly state: ConversationComputerCredentialStates;
	readonly claimFence: string;
	readonly claimExpiresAt: Date;
	readonly expiresAt: Date;
	readonly keyId: string | null;
	readonly nonce: Uint8Array | null;
	readonly authTag: Uint8Array | null;
	readonly ciphertext: Uint8Array | null;
	readonly ciphertextDigest: string | null;
	readonly credentialDigest: string | null;
}

/** Transaction-bound operations used by the two-phase credential unit of work. */
export interface ConversationComputerCredentialPersistenceRepository
{
	prepare(input: ConversationComputerCredentialIssueCommand): Promise<{ readonly outcome: "claim"; readonly fence: string } | { readonly outcome: "alias_cleanup" | "custody" | "ready" | "expired"; readonly row: ConversationComputerCredentialCustody }>;
	/** Read the original ready custody under the current lease without claiming or creating a key. */
	reuseExact(input: ConversationComputerCredentialReuseCommand): Promise<ConversationComputerCredentialCustody>;
	storeCustody(input: ConversationComputerCredentialIssueCommand, fence: string, encrypted: { readonly keyId: string; readonly nonce: Uint8Array; readonly authTag: Uint8Array; readonly ciphertext: Uint8Array; readonly ciphertextDigest: string }, credentialDigest: string, expiresAt: string): Promise<void>;
	finalize(input: ConversationComputerCredentialIssueCommand, fence: string): Promise<void>;
	markAliasCleanup(bootstrapId: string, fence: string): Promise<ConversationComputerCredentialCustody | null>;
	/** Clear secrets after revocation while preserving the marker that prevents another mint. */
	finishRevocation(bootstrapId: string, fence: string): Promise<void>;
	claimRevocation(bootstrapId: string): Promise<ConversationComputerCredentialCustody | null>;
}
