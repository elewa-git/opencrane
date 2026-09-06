import { describe, expect, it, vi } from "vitest";
import { ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";

import { ActiveConversationComputerTurnCandidateResolver } from "../conversation-computer-turn-candidate-resolver";

const _COMMAND = { computerId: "computer-1", generation: 1, leaseId: "lease-1", workload: { subject: "system:serviceaccount:opencrane-testv5:computer", namespace: "opencrane-testv5", serviceAccountName: "computer", podUid: "pod-1" } };

describe("ActiveConversationComputerTurnCandidateResolver", function _ActiveConversationComputerTurnCandidateResolverSuite()
{
	it("rejects an expired durable lease before Pod verification or compilation", async function _ExpiredLease()
	{
		const pods = { verify: vi.fn() };
		const compiler = { compile: vi.fn() };
		const computers = { load: vi.fn().mockResolvedValue({ computer: { state: ConversationComputerStates.Warm, leaseGeneration: 1 }, lease: { id: "lease-1", generation: 1, state: ComputerLeaseStates.Active, sandboxId: "sandbox-1", expiresAt: "2020-01-01T00:00:00.000Z" } }) };
		const resolver = new ActiveConversationComputerTurnCandidateResolver("silo-1", { resolve: vi.fn().mockResolvedValue({ conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1" }) }, computers as never, pods, compiler);
		await expect(resolver.resolve(_COMMAND)).rejects.toThrow("current active lease generation");
		expect(pods.verify).not.toHaveBeenCalled();
		expect(compiler.compile).not.toHaveBeenCalled();
	});

	it("bounds the credential lifetime to the remaining lease", async function _BoundCredentialLifetime()
	{
		vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-05T00:00:00.000Z"));
		const candidate = { binding: {}, compiledInput: {}, latestPendingEntryId: "entry-1", modelAlias: "model-1", maximumBudgetUsd: 0.1, credentialLifetimeSeconds: 300, sandboxClaimId: "computer-1-g1" };
		const computers = { load: vi.fn().mockResolvedValue({ computer: { state: ConversationComputerStates.Warm, leaseGeneration: 1 }, lease: { id: "lease-1", generation: 1, state: ComputerLeaseStates.Active, sandboxId: "sandbox-1", expiresAt: "2026-09-05T00:00:45.000Z" } }) };
		const projections = { resolve: vi.fn().mockResolvedValue({ conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1" }) };
		const compiler = { compile: vi.fn().mockResolvedValue(candidate) };
		const resolver = new ActiveConversationComputerTurnCandidateResolver("silo-1", projections, computers as never, { verify: vi.fn().mockResolvedValue(true) }, compiler as never);
		expect((await resolver.resolve(_COMMAND))?.credentialLifetimeSeconds).toBe(45);
		expect(projections.resolve).toHaveBeenCalledWith("silo-1", "computer-1");
		expect(computers.load).toHaveBeenCalledWith(expect.objectContaining({ siloId: "silo-1" }));
		expect(compiler.compile).toHaveBeenCalledWith(expect.objectContaining({ siloId: "silo-1" }));
	});
});
