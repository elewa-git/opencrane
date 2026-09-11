import { createHash } from "node:crypto";

import { ConversationModelResponseKinds } from "@opencrane/contracts";
import type { ConversationComputerCredentialIssueCommand, ConversationComputerCredentialIssuer, ConversationComputerCredentialReceipt, ConversationComputerCredentialReuseCommand, ConversationComputerModelTransport } from "@opencrane/backend/server/conversations";

/** Fixed answer returned by the credential-free Tier 2 model transport. */
const _SIMULATED_RESPONSE = "This is a deterministic Tier 2 simulated model response.";

/** Keep one simulated receipt without creating provider-side credential state. */
interface _SimulatedCredential
{
	readonly command: ConversationComputerCredentialIssueCommand;
	readonly receipt: ConversationComputerCredentialReceipt;
}

/** Answer every reserved request without reading an endpoint, provider key, or model service. */
export class DeterministicDevelopmentConversationModelTransport implements ConversationComputerModelTransport
{
	public async request(): Promise<{ readonly kind: ConversationModelResponseKinds.Text; readonly text: string }>
	{
		return { kind: ConversationModelResponseKinds.Text, text: _SIMULATED_RESPONSE };
	}
}

/** Hold deterministic, non-provider receipts for the lifetime of one Tier 2 server process. */
export class DevelopmentConversationComputerCredentialIssuer implements ConversationComputerCredentialIssuer
{
	private readonly credentials = new Map<string, _SimulatedCredential>();

	/** Return the same non-provider receipt for an exact retry of one bootstrap. */
	public async issueOnce(command: ConversationComputerCredentialIssueCommand): Promise<ConversationComputerCredentialReceipt>
	{
		const existing = this.credentials.get(command.bootstrapId);
		if (existing !== undefined)
		{
			this._AssertSameCommand(existing.command, command);
			return existing.receipt;
		}
		if (!Number.isFinite(Date.parse(command.notAfter)) || Date.parse(command.notAfter) <= Date.now())
		{
			throw new Error("Simulated model credential requires unexpired authority");
		}
		const key = `simulated-${createHash("sha256").update(command.bootstrapId).digest("hex")}`;
		const receipt = { key, credentialDigest: `sha256:${createHash("sha256").update(key).digest("hex")}`, expiresAt: command.notAfter };
		this.credentials.set(command.bootstrapId, { command: structuredClone(command), receipt });
		return receipt;
	}

	/** Reuse only the exact receipt recorded for the current unexpired bootstrap. */
	public async reuseExact(command: ConversationComputerCredentialReuseCommand): Promise<ConversationComputerCredentialReceipt>
	{
		const existing = this.credentials.get(command.bootstrapId);
		if (existing === undefined)
		{
			throw new Error("Simulated model credential does not exist");
		}
		this._AssertSameCommand(existing.command, command);
		if (existing.receipt.credentialDigest !== command.expectedCredentialDigest || existing.receipt.expiresAt !== command.expectedExpiresAt || Date.parse(existing.receipt.expiresAt) <= Date.now())
		{
			throw new Error("Simulated model credential receipt changed");
		}
		return existing.receipt;
	}

	/** Remove one in-memory receipt after the current attempt settles. */
	public async revoke(bootstrapId: string): Promise<void>
	{
		this.credentials.delete(bootstrapId);
	}

	/** Require every durable issuance coordinate to match the first accepted command. */
	private _AssertSameCommand(expected: ConversationComputerCredentialIssueCommand, actual: ConversationComputerCredentialIssueCommand): void
	{
		if (
			expected.bootstrapId !== actual.bootstrapId
			|| expected.keyAlias !== actual.keyAlias
			|| expected.modelAlias !== actual.modelAlias
			|| expected.maxBudgetUsd !== actual.maxBudgetUsd
			|| expected.expirySeconds !== actual.expirySeconds
			|| expected.notAfter !== actual.notAfter
			|| JSON.stringify(expected.computer) !== JSON.stringify(actual.computer)
			|| JSON.stringify(expected.lease) !== JSON.stringify(actual.lease)
		)
		{
			throw new Error("Simulated model credential coordinates changed");
		}
	}
}
