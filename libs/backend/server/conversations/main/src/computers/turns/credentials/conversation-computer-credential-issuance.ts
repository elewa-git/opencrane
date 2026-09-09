import type { ConversationComputerCredentialIssueCommand, ConversationComputerCredentialReceipt, ConversationComputerCredentialReuseCommand, ConversationComputerRawCredentialAuthority } from "../../../conversation-computer-turn.types";
import { ConversationComputerCredentialPreparationOutcomes } from "../../../db/conversation-computer-credential-persistence.types";
import { ConversationComputerCredentialCleanup } from "./conversation-computer-credential-cleanup";
import { _AssertCredentialIssueExpiry, _BoundCredentialIssue } from "./conversation-computer-credential-expiry";
import { ConversationComputerCredentialReceiptCodec } from "./conversation-computer-credential-receipt";
import type { ConversationComputerCredentialTransactions, EncryptedConversationComputerCredentialCustody } from "./conversation-computer-credential.types";

/** Issues or recovers the first provider key without resetting its request budget or authority window. */
export class ConversationComputerCredentialIssuance
{
	/** Keeps provider calls separate from transaction callbacks and authenticated receipt encoding. */
	public constructor(private readonly transactions: ConversationComputerCredentialTransactions, private readonly raw: ConversationComputerRawCredentialAuthority, private readonly receipts: ConversationComputerCredentialReceiptCodec, private readonly cleanup: ConversationComputerCredentialCleanup) {}

	/**
	 * Returns a key only after its encrypted custody commits and current-lease promotion succeeds.
	 * Every retained failure state refuses another mint, so retrying cannot renew the attempt budget.
	 */
	public async issueOnce(command: ConversationComputerCredentialIssueCommand): Promise<ConversationComputerCredentialReceipt>
	{
		// 1. Claim or read custody under the current lease before making any provider request.
		const input = _BoundCredentialIssue(command);
		const prepared = await this.transactions.run(function _PrepareCredential(repository) { return repository.prepare(input); });
		if (prepared.outcome === ConversationComputerCredentialPreparationOutcomes.Ready)
			return this.receipts.open(prepared.row);
		if (prepared.outcome === ConversationComputerCredentialPreparationOutcomes.Expired)
		{
			await this.cleanup.revoke(input.bootstrapId);
			throw new Error("Conversation computer credential cannot replace expired or revoking custody");
		}
		if (prepared.outcome === ConversationComputerCredentialPreparationOutcomes.AliasCleanup)
		{
			await this.cleanup.revoke(input.bootstrapId);
			throw new Error("Conversation computer credential cannot replace uncertain issuance");
		}
		if (prepared.outcome === ConversationComputerCredentialPreparationOutcomes.Custody)
		{
			await this.cleanup.finalizeOrRetain(input, prepared.row);
			return this.receipts.open(prepared.row);
		}
		if (prepared.outcome !== ConversationComputerCredentialPreparationOutcomes.Claim)
			throw new Error("Conversation computer credential preparation returned an invalid outcome");

		// 2. Shorten authority after the transaction; a lost provider response leaves Pending.
		const minted = await this.raw.issue(_BoundCredentialIssue(input));
		let custody: EncryptedConversationComputerCredentialCustody;
		try
		{
			_AssertCredentialIssueExpiry(minted.expiresAt, input);
			custody = this.receipts.seal(input, prepared.fence, minted);
		}
		catch (error)
		{
			await this.cleanup.retainAliasCleanup(input.bootstrapId, prepared.fence, input.keyAlias, minted.key);
			throw error;
		}

		// 3. Commit encrypted custody before promotion so failed disclosure still permits cleanup.
		try
		{
			await this.transactions.run(function _StoreCustody(repository) { return repository.storeCustody(input, prepared.fence, custody, custody.credentialDigest, minted.expiresAt); });
		}
		catch (error)
		{
			await this.cleanup.retainAliasCleanup(input.bootstrapId, prepared.fence, input.keyAlias, minted.key);
			throw error;
		}
		await this.cleanup.finalizeOrRetain(input, custody);
		return { key: minted.key, credentialDigest: custody.credentialDigest, expiresAt: custody.expiresAt.toISOString() };
	}

	/** Returns the saved key after current-authority and receipt checks without issuing or promoting. */
	public async reuseExact(input: ConversationComputerCredentialReuseCommand): Promise<ConversationComputerCredentialReceipt>
	{
		if (!Number.isFinite(Date.parse(input.notAfter)) || Date.parse(input.notAfter) <= Date.now())
			throw new Error("Conversation computer credential reuse requires unexpired authority");
		const row = await this.transactions.run(function _ReuseCredential(repository) { return repository.reuseExact(input); });
		return this.receipts.open(row);
	}
}
