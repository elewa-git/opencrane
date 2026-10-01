import { ComputerLeaseStates, ConversationComputerRealizationKinds, ConversationComputerStates, type ComputerLease, type ConversationComputer } from "@opencrane/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationComputerLifecycleWorker, HttpConversationComputerCheckpointSandbox } from "../conversation-computer-lifecycle-runtime";

const _COMPUTER: ConversationComputer = { schemaVersion: 1, id: "computer-1", siloId: "silo-1", conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1", state: ConversationComputerStates.Warm, leaseGeneration: 3, workspaceCheckpoint: null, createdAt: "2026-09-06T10:00:00.000Z", updatedAt: "2026-09-06T10:00:00.000Z" } as ConversationComputer;
const _LEASE: ComputerLease = {
	schemaVersion: 1,
	id: "lease-abc",
	computerId: "computer-1",
	generation: 3,
	realization: {
		kind: ConversationComputerRealizationKinds.AgentSandbox,
		claimId: "computer-1-g3",
		sandboxId: "sandbox-1",
		serviceFQDN: "computer-1.sandboxes.svc.cluster.local",
	},
	state: ComputerLeaseStates.Active,
	claimedAt: "2026-09-06T10:00:00.000Z",
	expiresAt: "2026-09-06T11:00:00.000Z",
	releasedAt: null,
};

/** Records the coordinates it was asked for and returns one fixed secret. */
function _Deriver()
{
	const bearer = vi.fn(function _Bearer() { return "derived-review-secret,older-review-secret"; });
	return { bearer, derive: vi.fn() };
}

/** Yields one small chunk the way the checkpoint store streams a revision. */
async function* _Bytes(): AsyncGenerator<Uint8Array>
{
	yield new Uint8Array([9]);
}

describe("HttpConversationComputerCheckpointSandbox", function _Suite()
{
	afterEach(function _Restore()
	{
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("captures with the derived review credential, never the lease id", async function _Capture()
	{
		const fetchMock = vi.fn(async function _Fetch() { return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "application/vnd.opencrane.workspace-tar+gzip" } }); });
		vi.stubGlobal("fetch", fetchMock);
		const deriver = _Deriver();
		const bytes = [] as number[];
		for await (const chunk of await new HttpConversationComputerCheckpointSandbox(deriver).capture(_COMPUTER, _LEASE))
			bytes.push(...chunk);
		expect(bytes).toEqual([1, 2, 3]);
		expect(deriver.bearer).toHaveBeenCalledWith({
			siloId: "silo-1",
			computerId: "computer-1",
			lease: {
				leaseId: "lease-abc",
				leaseGeneration: 3,
				realization: _LEASE.realization,
			},
		});
		const request = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(request[0]).toBe("http://computer-1.sandboxes.svc.cluster.local:8090/v1/checkpoints/capture");
		expect((request[1].headers as Record<string, string>).authorization).toBe("Bearer derived-review-secret,older-review-secret");
		expect(JSON.stringify(request[1].headers)).not.toContain("lease-abc");
	});

	it("restores with the derived review credential and fails closed on a rejected upload", async function _Restore()
	{
		const fetchMock = vi.fn(async function _Fetch() { return new Response(null, { status: 401 }); });
		vi.stubGlobal("fetch", fetchMock);
		const deriver = _Deriver();
		await expect(new HttpConversationComputerCheckpointSandbox(deriver).restore(_COMPUTER, _LEASE, _Bytes())).rejects.toThrow("checkpoint restore failed with 401");
		const request = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect((request[1].headers as Record<string, string>).authorization).toBe("Bearer derived-review-secret,older-review-secret");
	});
});

describe("ConversationComputerLifecycleWorker", function _WorkerSuite()
{
	afterEach(function _RestoreTimers(): void
	{
		vi.useRealTimers();
	});

	it("serializes timer passes and drains the admitted pass during stop", async function _DrainsCurrentPass(): Promise<void>
	{
		vi.useFakeTimers();
		let finishPass = function _MissingPass(): void
		{
			throw new Error("Lifecycle pass did not start");
		};
		const blockedPass = new Promise<[]>(function _BlockPass(resolve): void
		{
			finishPass = function _FinishPass(): void { resolve([]); };
		});
		const reconcileDue = vi.fn().mockReturnValue(blockedPass);
		const logger = { error: vi.fn() };
		const worker = new ConversationComputerLifecycleWorker({ reconcileDue } as never, logger, 1_000);

		await vi.advanceTimersByTimeAsync(1_000);
		expect(reconcileDue).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(4_000);
		expect(reconcileDue).toHaveBeenCalledOnce();

		let stopSettled = false;
		const stopping = worker.stop();
		void stopping.then(function _Stopped(): void { stopSettled = true; });
		await Promise.resolve();
		expect(stopSettled).toBe(false);
		await vi.advanceTimersByTimeAsync(4_000);
		expect(reconcileDue).toHaveBeenCalledOnce();

		finishPass();
		await stopping;
		expect(stopSettled).toBe(true);
		expect(logger.error).not.toHaveBeenCalled();
	});
});
