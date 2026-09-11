import express from "express";
import { describe, expect, it, vi } from "vitest";

import { ConversationComputerRealizationKinds, type AgentSandboxConversationComputerRealization, type HostDevelopmentConversationComputerRealization } from "@opencrane/contracts";

import { HostDevelopmentConversationComputerRealizer } from "../conversation-computer-host-realizer";
import { HostDevelopmentConversationComputerSupervisor } from "../conversation-computer-host-supervisor";

/** Keeps focused leases live without overflowing Node's timer range. */
const _EXPIRES_AT = new Date(Date.now() + 600_000).toISOString();

/** Exact child command supplied by the app bridge during focused tests. */
const _LAUNCH = { executable: "test-python", arguments: ["-m", "test.entrypoint"], workingDirectory: "/workspace/test-app" };

/** Refuses child creation in tests that exercise only realization mapping. */
const _UNUSED_SPAWN = function _UnusedSpawn(): never { throw new Error("unexpected process start"); };

/** Returns the activation command shared by host bridge tests. */
function _ClaimCommand(generation = 3)
{
	return { siloId: "silo-1", computerId: "computer-1", leaseId: `lease-${generation}`, generation, expiresAt: _EXPIRES_AT, reason: "activation_requested" as const };
}

describe("Tier 2 host conversation-computer domain bridge", function _Suite(): void
{
	it("maps stable host coordinates to the domain realization", function _Prepares(): void
	{
		const realizer = new HostDevelopmentConversationComputerRealizer({ internalEndpoint: "http://127.0.0.1:8081", launch: _LAUNCH, spawnProcess: _UNUSED_SPAWN });
		const first = realizer.prepare(_ClaimCommand(3)) as HostDevelopmentConversationComputerRealization;
		const retry = realizer.prepare(_ClaimCommand(3));
		const replacement = realizer.prepare(_ClaimCommand(4)) as HostDevelopmentConversationComputerRealization;
		expect(first).toEqual(retry);
		expect(first.processId).not.toBe(replacement.processId);
		expect(first).toEqual({ kind: ConversationComputerRealizationKinds.HostDevelopmentProcess, processId: expect.stringMatching(/^local-computer-[a-f0-9]{32}$/u), endpoint: "http://127.0.0.1:8081" });
	});

	it("refuses production realizations at the host-process bridge", async function _RejectsProduction(): Promise<void>
	{
		const realizer = new HostDevelopmentConversationComputerRealizer({ internalEndpoint: "http://127.0.0.1:8081", launch: _LAUNCH, spawnProcess: _UNUSED_SPAWN });
		const realization: AgentSandboxConversationComputerRealization = { kind: ConversationComputerRealizationKinds.AgentSandbox, claimId: "claim-1", sandboxId: "sandbox-1", serviceFQDN: "sandbox-1.computers.svc.cluster.local" };
		await expect(realizer.claim({ ..._ClaimCommand(), realization })).rejects.toThrow("requires a workstation realization");
	});

	it("closes the private listener and its process owner once", async function _StopsSupervisor(): Promise<void>
	{
		const close = vi.fn().mockResolvedValue(undefined);
		const supervisor = new HostDevelopmentConversationComputerSupervisor({ app: express(), port: 0, processes: { close } });
		const handle = await supervisor.start();
		await Promise.all([handle.stop(), handle.stop()]);
		expect(close).toHaveBeenCalledOnce();
	});

	it("closes the private listener and reports process-owner cleanup failure", async function _ReportsSupervisorCleanupFailure(): Promise<void>
	{
		const close = vi.fn().mockRejectedValue(new Error("child cleanup failed"));
		const supervisor = new HostDevelopmentConversationComputerSupervisor({ app: express(), port: 0, processes: { close } });
		const handle = await supervisor.start();

		await expect(handle.stop()).rejects.toThrow("Host conversation-computer supervisor cleanup failed");
		expect(close).toHaveBeenCalledOnce();
	});
});
