import { describe, expect, it } from "vitest";

import { ConversationComputerRealizationKinds, ConversationModelResponseKinds } from "@opencrane/contracts";

import { DeterministicDevelopmentConversationModelTransport, DevelopmentConversationComputerCredentialIssuer } from "../simulated-conversation-model";

/** Return one complete credential command without any provider coordinate. */
function _Command()
{
	return {
		bootstrapId: "bootstrap-1",
		computer: { siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", agentIdentityId: "agent-1" },
		lease: { leaseId: "lease-1", leaseGeneration: 1, realization: { kind: ConversationComputerRealizationKinds.HostDevelopmentProcess, processId: "local-computer-1", endpoint: "http://127.0.0.1:8081" } },
		keyAlias: "attempt-1",
		modelAlias: "simulated/model",
		maxBudgetUsd: 0.1,
		expirySeconds: 300,
		notAfter: new Date(Date.now() + 300_000).toISOString(),
	};
}

describe("Tier 2 simulated model boundary", function _Suite(): void
{
	it("returns the same text without reading model request coordinates", async function _Responds(): Promise<void>
	{
		const transport = new DeterministicDevelopmentConversationModelTransport();
		await expect(transport.request()).resolves.toEqual({ kind: ConversationModelResponseKinds.Text, text: "This is a deterministic Tier 2 simulated model response." });
		await expect(transport.request()).resolves.toEqual({ kind: ConversationModelResponseKinds.Text, text: "This is a deterministic Tier 2 simulated model response." });
	});

	it("reuses only the exact in-memory receipt and revokes it", async function _Credentials(): Promise<void>
	{
		const credentials = new DevelopmentConversationComputerCredentialIssuer();
		const command = _Command();
		const first = await credentials.issueOnce(command);
		await expect(credentials.issueOnce(command)).resolves.toEqual(first);
		await expect(credentials.reuseExact({ ...command, expectedCredentialDigest: first.credentialDigest, expectedExpiresAt: first.expiresAt })).resolves.toEqual(first);
		await expect(credentials.issueOnce({ ...command, modelAlias: "changed/model" })).rejects.toThrow("coordinates changed");
		await credentials.revoke(command.bootstrapId);
		await expect(credentials.reuseExact({ ...command, expectedCredentialDigest: first.credentialDigest, expectedExpiresAt: first.expiresAt })).rejects.toThrow("does not exist");
	});
});
