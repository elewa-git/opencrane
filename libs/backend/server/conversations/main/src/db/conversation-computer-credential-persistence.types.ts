import type { ConversationComputerCredentialIssueCommand } from "../conversation-computer-turn.types";

/** Encrypted attempt-key custody retained independently of provider cleanup availability. */
export interface ConversationComputerCredentialCustody
{
	readonly bootstrapId: string;
	readonly siloId: string;
	readonly conversationId: string;
	readonly keyAlias: string;
	readonly modelAlias: string;
	readonly state: string;
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
	storeCustody(input: ConversationComputerCredentialIssueCommand, fence: string, encrypted: { readonly keyId: string; readonly nonce: Uint8Array; readonly authTag: Uint8Array; readonly ciphertext: Uint8Array; readonly ciphertextDigest: string }, credentialDigest: string, expiresAt: string): Promise<void>;
	finalize(input: ConversationComputerCredentialIssueCommand, fence: string): Promise<void>;
	markAliasCleanup(bootstrapId: string, fence: string): Promise<ConversationComputerCredentialCustody | null>;
	forget(bootstrapId: string, fence: string): Promise<void>;
	claimRevocation(bootstrapId: string): Promise<ConversationComputerCredentialCustody | null>;
}
