import { describe, expect, it, vi } from "vitest";
import { ComputerLeaseStates, ConversationComputerRealizationKinds, ConversationComputerStates } from "@opencrane/contracts";

import { ActiveConversationComputerTurnCandidateResolver } from "../conversation-computer-turn-candidate-resolver";

const _REALIZATION = { kind: ConversationComputerRealizationKinds.AgentSandbox, claimId: "computer-1-g1", sandboxId: "sandbox-1", serviceFQDN: "sandbox-1.computers.svc.cluster.local" } as const;
const _PROCESS = { kind: ConversationComputerRealizationKinds.AgentSandbox, workload: { subject: "system:serviceaccount:opencrane-testv5:computer", namespace: "opencrane-testv5", serviceAccountName: "computer", podUid: "pod-1" } } as const;
const _COMMAND = { computerId: "computer-1", lease: { leaseId: "lease-1", leaseGeneration: 1 }, process: _PROCESS };

describe("ActiveConversationComputerTurnCandidateResolver", function _ActiveConversationComputerTurnCandidateResolverSuite()
{
	it("rejects an expired durable lease before Pod verification or compilation", async function _ExpiredLease()
	{
		const pods = { bind: vi.fn() };
		const compiler = { compile: vi.fn() };
		const computers = { load: vi.fn().mockResolvedValue({ computer: { state: ConversationComputerStates.Warm, leaseGeneration: 1 }, lease: { id: "lease-1", generation: 1, realization: _REALIZATION, state: ComputerLeaseStates.Active, expiresAt: "2020-01-01T00:00:00.000Z" } }) };
		const resolver = new ActiveConversationComputerTurnCandidateResolver("silo-1", { resolve: vi.fn().mockResolvedValue({ conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1" }) }, computers as never, pods, compiler);
		await expect(resolver.resolve(_COMMAND)).rejects.toThrow("current active lease generation");
		expect(pods.bind).not.toHaveBeenCalled();
		expect(compiler.compile).not.toHaveBeenCalled();
	});

	it("admits a bound Pod without compiling and rejects an unbound one", async function _Admit()
	{
		vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-05T00:00:00.000Z"));
		const computers = { load: vi.fn().mockResolvedValue({ computer: { state: ConversationComputerStates.Warm, leaseGeneration: 1 }, lease: { id: "lease-1", generation: 1, realization: _REALIZATION, state: ComputerLeaseStates.Active, expiresAt: "2026-09-05T00:10:00.000Z" } }) };
		const projections = { resolve: vi.fn().mockResolvedValue({ conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1" }) };
		const pods = { bind: vi.fn().mockResolvedValue(true) };
		const compiler = { compile: vi.fn() };
		const resolver = new ActiveConversationComputerTurnCandidateResolver("silo-1", projections, computers as never, pods, compiler);
		await expect(resolver.admit(_COMMAND)).resolves.toBeUndefined();
		expect(pods.bind).toHaveBeenCalledWith({ computerId: "computer-1", lease: { leaseId: "lease-1", leaseGeneration: 1, realization: _REALIZATION }, process: _PROCESS });
		expect(compiler.compile).not.toHaveBeenCalled();
		pods.bind.mockResolvedValue(false);
		await expect(resolver.admit(_COMMAND)).rejects.toThrow("not bound to the active realization");
	});

	it("bounds the credential lifetime to the remaining lease", async function _BoundCredentialLifetime()
	{
		vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-05T00:00:00.000Z"));
		const candidate = { binding: {}, compiledInput: {}, latestPendingEntryId: "entry-1", modelAlias: "model-1", maximumBudgetUsd: 0.1, credentialLifetimeSeconds: 300, credentialExpiresAt: "2026-09-05T00:05:00.000Z", lease: { leaseId: "lease-1", leaseGeneration: 1, realization: _REALIZATION } };
		const computers = { load: vi.fn().mockResolvedValue({ computer: { state: ConversationComputerStates.Warm, leaseGeneration: 1 }, lease: { id: "lease-1", generation: 1, realization: _REALIZATION, state: ComputerLeaseStates.Active, expiresAt: "2026-09-05T00:00:45.000Z" } }) };
		const projections = { resolve: vi.fn().mockResolvedValue({ conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1" }) };
		const compiler = { compile: vi.fn().mockResolvedValue(candidate) };
		const resolver = new ActiveConversationComputerTurnCandidateResolver("silo-1", projections, computers as never, { bind: vi.fn().mockResolvedValue(true) }, compiler as never);
		expect(await resolver.resolve(_COMMAND)).toMatchObject({ credentialLifetimeSeconds: 45, credentialExpiresAt: "2026-09-05T00:00:45.000Z" });
		expect(projections.resolve).toHaveBeenCalledWith("silo-1", "computer-1");
		expect(computers.load).toHaveBeenCalledWith({ computer: { siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", agentIdentityId: "identity-1" }, profileRevisionId: "profile-1" });
		expect(compiler.compile).toHaveBeenCalledWith({ computer: { siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", agentIdentityId: "identity-1" }, profileRevisionId: "profile-1", lease: { leaseId: "lease-1", leaseGeneration: 1, realization: _REALIZATION } });
	});
});
