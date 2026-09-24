import type { ConversationComputerCredentialIssueCommand, ConversationComputerRawCredentialAuthority } from "../conversation-computer-turn.types";
import type { ConversationComputerCredentialCustody } from "../db/conversation-computer-credential-persistence.types";
import { ConversationComputerCredentialReceiptCodec, _HasEncryptedCredentialCustody } from "./conversation-computer-credential-receipt";
import type { ConversationComputerCredentialTransactions } from "./conversation-computer-credential.types";

/** Revokes the original provider key while keeping enough saved state to retry failed cleanup. */
export class ConversationComputerCredentialCleanup
{
	/** Receives separate persistence and provider owners so provider calls cannot inherit a transaction. */
	public constructor(private readonly transactions: ConversationComputerCredentialTransactions, private readonly raw: ConversationComputerRawCredentialAuthority, private readonly receipts: ConversationComputerCredentialReceiptCodec) {}

	/** Claims cleanup, then revokes the original key or alias outside that transaction. */
	public async revoke(bootstrapId: string): Promise<void>
	{
		const custody = await this.transactions.run(function _ClaimRevocation(repository) { return repository.claimRevocation(bootstrapId); });
		if (custody !== null)
			await this._revokeCustody(custody);
	}

	/**
	 * Promotes custody before disclosure. If promotion fails, cleanup may also fail; retain its
	 * encrypted row for a later retry and report the original promotion error to the caller.
	 */
	public async finalizeOrRetain(input: ConversationComputerCredentialIssueCommand, custody: ConversationComputerCredentialCustody): Promise<void>
	{
		try
		{
			await this.transactions.run(function _FinalizeCredential(repository) { return repository.finalize(input, custody.claimFence); });
		}
		catch (finalizeError)
		{
			try
			{
				await this.revoke(custody.bootstrapId);
			}
			catch
			{
				// Committed ciphertext keeps the original key available for a later cleanup retry.
			}
			throw finalizeError;
		}
	}

	/** Attempts raw-key cleanup after failed encryption or persistence without replacing the original error. */
	public async retainAliasCleanup(bootstrapId: string, fence: string, keyAlias: string, key: string): Promise<void>
	{
		let cleanup: ConversationComputerCredentialCustody | null = null;
		try
		{
			cleanup = await this.transactions.run(function _MarkAliasCleanup(repository) { return repository.markAliasCleanup(bootstrapId, fence); });
		}
		catch
		{
			// The returned provider key can still be revoked when saving the cleanup state fails.
		}
		try
		{
			await this.raw.revoke({ keyAlias, key });
			if (cleanup !== null)
			{
				const cleanupFence = cleanup.claimFence;
				await this.transactions.run(function _FinishAliasCleanup(repository) { return repository.finishRevocation(bootstrapId, cleanupFence); });
			}
		}
		catch
		{
			// The saved alias or expired Pending claim lets a later retry clean up without the raw key.
		}
	}

	/** Clears saved secrets only after the provider confirms key or alias revocation. */
	private async _revokeCustody(custody: ConversationComputerCredentialCustody): Promise<void>
	{
		if (_HasEncryptedCredentialCustody(custody))
			await this.raw.revoke({ keyAlias: custody.keyAlias, key: this.receipts.open(custody).key });
		else
			await this.raw.revokeByAlias({ keyAlias: custody.keyAlias });
		await this.transactions.run(function _FinishRevocation(repository) { return repository.finishRevocation(custody.bootstrapId, custody.claimFence); });
	}
}
