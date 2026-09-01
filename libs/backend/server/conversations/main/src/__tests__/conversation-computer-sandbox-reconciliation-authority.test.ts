import { describe, expect, it, vi } from "vitest";

import { ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";
import { AgentSandboxClaimObservationStates } from "@opencrane/backend/server/infra/agent-sandbox-claims";

import { ConversationComputerSandboxReconciliationOutcomes } from "../conversation-computer-sandbox-reconciliation-authority.types";
import { ConversationComputerSandboxReconciliationAuthority } from "../conversation-computer-sandbox-reconciliation-authority";

function _Current(overrides: Record<string, unknown> = {})
{
	return {
		streamName: "conversation-computer-computer-1",
		revision: 4n,
		computer: { schemaVersion: 1, id: "computer-1", siloId: "testv5", conversationId: "conversation-1", agentIdentityId: "agent-1", profileRevisionId: "profile-1", state: ConversationComputerStates.ClaimDispatched, leaseGeneration: 2, workspaceCheckpoint: null, activeExecution: null, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:01:00.000Z" },
		lease: { schemaVersion: 1, id: "lease-1", computerId: "computer-1", generation: 2, sandboxClaimId: "computer-1-g2", sandboxId: null, runtimePod: null, state: ComputerLeaseStates.Claimed, claimedAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-09-01T00:20:00.000Z", releasedAt: null },
		...overrides,
	};
}

function _Authority(current = _Current(), now = new Date("2026-09-01T00:10:00.000Z"))
{
	const history = { loadForActivation: vi.fn().mockResolvedValue(current), append: vi.fn().mockResolvedValue(undefined) };
	const profiles = { resolve: vi.fn().mockResolvedValue({ namespace: "testv5", serviceAccountName: "agent-sandbox-runtime", sandboxProfile: "developer", warmPoolName: "developer-pool", podLabels: { applicationName: "opencrane", releaseName: "opencrane-testv5" } }) };
	const observations = { observe: vi.fn().mockResolvedValue({ state: AgentSandboxClaimObservationStates.Ready, sandboxId: "sandbox-1" }) };
	const runtimePods = { read: vi.fn().mockResolvedValue({ namespace: "testv5", serviceAccountName: "agent-sandbox-runtime", podUid: "pod-uid-1" }) };
	return { authority: new ConversationComputerSandboxReconciliationAuthority({ history, profiles, observations, runtimePods, clock: { now: vi.fn().mockReturnValue(now) } }), history, profiles, observations, runtimePods };
}

const _Command = { siloId: "testv5", computerId: "computer-1", conversationId: "conversation-1", generation: 2 };

describe("ConversationComputerSandboxReconciliationAuthority", function _ReconciliationAuthoritySuite()
{
	it("revision-fences one exact ready claim into the computer's active lease", async function _WarmsReadyClaim()
	{
		const fixture = _Authority();

		await expect(fixture.authority.reconcile(_Command)).resolves.toBe(ConversationComputerSandboxReconciliationOutcomes.Warmed);
		expect(fixture.observations.observe).toHaveBeenCalledWith(expect.objectContaining({ namespace: "testv5", computerId: "computer-1", generation: 2, profile: "developer", warmPoolName: "developer-pool" }));
		expect(fixture.runtimePods.read).toHaveBeenCalledWith({ namespace: "testv5", sandboxId: "sandbox-1", serviceAccountName: "agent-sandbox-runtime" });
		expect(fixture.history.append).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 4n, computer: expect.objectContaining({ state: ConversationComputerStates.Warm }), lease: expect.objectContaining({ state: ComputerLeaseStates.Active, sandboxId: "sandbox-1", runtimePod: { namespace: "testv5", serviceAccountName: "agent-sandbox-runtime", podUid: "pod-uid-1" } }) }));
	});

	it("keeps unready status pending and never turns a false condition into a terminal lease", async function _KeepsPending()
	{
		const fixture = _Authority();
		fixture.observations.observe.mockResolvedValue({ state: AgentSandboxClaimObservationStates.Pending });

		await expect(fixture.authority.reconcile(_Command)).resolves.toBe(ConversationComputerSandboxReconciliationOutcomes.Pending);
		expect(fixture.history.append).not.toHaveBeenCalled();
	});

	it("keeps a ready claim pending until its assigned Sandbox has one exact backing Pod", async function _WaitsForBackingPod()
	{
		const fixture = _Authority();
		fixture.runtimePods.read.mockResolvedValue(null);

		await expect(fixture.authority.reconcile(_Command)).resolves.toBe(ConversationComputerSandboxReconciliationOutcomes.Pending);
		expect(fixture.history.append).not.toHaveBeenCalled();
	});

	it("retains its durable locator while activation has not yet written the dispatch fence", async function _WaitsForDispatch()
	{
		const fixture = _Authority(_Current({ computer: { ..._Current().computer, state: ConversationComputerStates.ClaimPending } }));

		await expect(fixture.authority.reconcile(_Command)).resolves.toBe(ConversationComputerSandboxReconciliationOutcomes.Pending);
		expect(fixture.observations.observe).not.toHaveBeenCalled();
		expect(fixture.history.append).not.toHaveBeenCalled();
	});

	it("drops an expired or unadmitted pending activation that can never reach the dispatch fence", async function _DropsTerminalPending()
	{
		const unadmitted = _Authority(_Current({ computer: { ..._Current().computer, state: ConversationComputerStates.ClaimPending } }));
		unadmitted.profiles.resolve.mockResolvedValue(null);
		const expired = _Authority(_Current({ computer: { ..._Current().computer, state: ConversationComputerStates.ClaimPending } }), new Date("2026-09-01T00:21:00.000Z"));

		await expect(unadmitted.authority.reconcile(_Command)).resolves.toBe(ConversationComputerSandboxReconciliationOutcomes.Blocked);
		await expect(expired.authority.reconcile(_Command)).resolves.toBe(ConversationComputerSandboxReconciliationOutcomes.Ignored);
		expect(expired.profiles.resolve).not.toHaveBeenCalled();
	});

	it("compensates an expired dispatch before it trusts a late ready status", async function _CompensatesExpiredClaim()
	{
		const fixture = _Authority(_Current(), new Date("2026-09-01T00:21:00.000Z"));

		await expect(fixture.authority.reconcile(_Command)).resolves.toBe(ConversationComputerSandboxReconciliationOutcomes.Compensated);
		expect(fixture.observations.observe).not.toHaveBeenCalled();
		expect(fixture.history.append).toHaveBeenCalledWith(expect.objectContaining({ computer: expect.objectContaining({ state: ConversationComputerStates.RecoveryRequired }), lease: expect.objectContaining({ state: ComputerLeaseStates.Lost, sandboxId: null, releasedAt: "2026-09-01T00:21:00.000Z" }) }));
	});

	it("compensates when a slow ready read crosses the durable lease expiry", async function _CompensatesLateReady()
	{
		const fixture = _Authority(_Current(), new Date("2026-09-01T00:19:59.000Z"));
		fixture.authority = new ConversationComputerSandboxReconciliationAuthority({
			history: fixture.history,
			profiles: fixture.profiles,
			observations: fixture.observations,
			runtimePods: fixture.runtimePods,
			clock: { now: vi.fn().mockReturnValueOnce(new Date("2026-09-01T00:19:59.000Z")).mockReturnValueOnce(new Date("2026-09-01T00:20:00.000Z")) },
		});

		await expect(fixture.authority.reconcile(_Command)).resolves.toBe(ConversationComputerSandboxReconciliationOutcomes.Compensated);
		expect(fixture.history.append).toHaveBeenCalledWith(expect.objectContaining({ computer: expect.objectContaining({ state: ConversationComputerStates.RecoveryRequired }), lease: expect.objectContaining({ state: ComputerLeaseStates.Lost }) }));
	});

	it("retains one current warm generation for restart-safe execution admission", async function _RetainsWarmGeneration()
	{
		const fixture = _Authority(_Current({ computer: { ..._Current().computer, state: ConversationComputerStates.Warm }, lease: { ..._Current().lease, state: ComputerLeaseStates.Active, sandboxId: "sandbox-1", runtimePod: { namespace: "testv5", serviceAccountName: "agent-sandbox-runtime", podUid: "pod-uid-1" } } }));

		await expect(fixture.authority.reconcile(_Command)).resolves.toBe(ConversationComputerSandboxReconciliationOutcomes.ExecutionPending);
		expect(fixture.observations.observe).not.toHaveBeenCalled();
	});

	it("ignores a stale or terminal activation locator", async function _IgnoresStaleLocator()
	{
		const fixture = _Authority(_Current({ computer: { ..._Current().computer, state: ConversationComputerStates.Warm }, lease: { ..._Current().lease, state: ComputerLeaseStates.Active, sandboxId: "sandbox-1", runtimePod: { namespace: "testv5", serviceAccountName: "agent-sandbox-runtime", podUid: "pod-uid-1" }, expiresAt: "2026-09-01T00:09:00.000Z" } }));

		await expect(fixture.authority.reconcile(_Command)).resolves.toBe(ConversationComputerSandboxReconciliationOutcomes.Ignored);
		expect(fixture.observations.observe).not.toHaveBeenCalled();
	});
});
