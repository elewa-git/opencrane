import { ComputerLeaseStates, ConversationComputerStates, type ComputerLease, type ConversationComputer, type ConversationComputerExecution } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { ConversationComputerExecutionAuthority } from "../conversation-computer-execution-authority";
import type { ConversationComputerAppendCommand } from "../conversation-computer-history.types";
import { ConversationComputerExecutionStartOutcomes, type ConversationComputerExecutionStartCommand } from "../conversation-computer-execution-authority.types";

/** Fixes the server time used to check one lease throughout these execution-start cases. */
const _NOW = new Date("2026-09-01T00:10:00.000Z");

/** Builds the durable activation locator that never carries a profile, identity, or lease. */
function _Command(overrides: Partial<ConversationComputerExecutionStartCommand> = {}): ConversationComputerExecutionStartCommand
{
	return { siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", ...overrides };
}

/** Builds a complete active lease held by the default warm computer. */
function _Lease(overrides: Partial<ComputerLease> = {}): ComputerLease
{
	return {
		schemaVersion: 1,
		id: "lease-1",
		computerId: "computer-1",
		generation: 1,
		sandboxClaimId: "claim-1",
		sandboxId: "sandbox-1",
		runtimePod: { namespace: "sandbox", serviceAccountName: "agent-sandbox-runtime", podUid: "pod-uid-1" },
		state: ComputerLeaseStates.Active,
		claimedAt: "2026-09-01T00:00:00.000Z",
		expiresAt: "2026-09-01T00:20:00.000Z",
		releasedAt: null,
		...overrides,
	};
}

/** Builds a logical warm computer without an execution so the authority may start one. */
function _Computer(overrides: Partial<ConversationComputer> = {}): ConversationComputer
{
	return {
		schemaVersion: 1,
		id: "computer-1",
		siloId: "silo-1",
		conversationId: "conversation-1",
		agentIdentityId: "identity-1",
		profileRevisionId: "profile-1",
		state: ConversationComputerStates.Warm,
		leaseGeneration: 1,
		workspaceCheckpoint: null,
		activeExecution: null,
		createdAt: "2026-09-01T00:00:00.000Z",
		updatedAt: "2026-09-01T00:00:00.000Z",
		...overrides,
	};
}

/** Builds an open execution that is bound to the default lease. */
function _Execution(overrides: Partial<ConversationComputerExecution> = {}): ConversationComputerExecution
{
	return { id: "execution-1", leaseId: "lease-1", leaseGeneration: 1, startedAt: "2026-09-01T00:01:00.000Z", endedAt: null, ...overrides };
}

/** Builds the checked history snapshot that a start may use as an append fence. */
function _Current(overrides: { readonly computer?: ConversationComputer; readonly lease?: ComputerLease | null; readonly revision?: bigint } = {})
{
	const computer = overrides.computer ?? _Computer();
	return { streamName: "computer-computer-1", revision: overrides.revision ?? 3n, computer, lease: overrides.lease === undefined ? _Lease() : overrides.lease };
}

/** Builds the authority with independently controlled history reads and writes. */
function _Subject(overrides: { readonly current?: ReturnType<typeof _Current> | null; readonly reloaded?: ReturnType<typeof _Current> | null; readonly appendError?: Error; readonly afterFirstLoadClock?: Date; readonly beforeAppendClock?: Date } = {})
{
	const current = overrides.current === undefined ? _Current() : overrides.current;
	const reloaded = overrides.reloaded === undefined ? current : overrides.reloaded;
	let now = _NOW;
	const loadForActivation = vi.fn().mockImplementationOnce(async function _LoadCurrent()
	{
		if (overrides.afterFirstLoadClock !== undefined)
			now = overrides.afterFirstLoadClock;
		return current;
	}).mockResolvedValue(reloaded);
	const append = vi.fn().mockImplementation(async function _Append(command: ConversationComputerAppendCommand): Promise<void>
	{
		if (current === null)
			throw new Error("test append requires a current computer");
		if (overrides.beforeAppendClock !== undefined)
			now = overrides.beforeAppendClock;
		command.assertCurrent?.(current);
		if (overrides.appendError !== undefined)
			throw overrides.appendError;
	});
	const authority = new ConversationComputerExecutionAuthority({ loadForActivation, append } as never, { now: function _Now(): Date { return now; } });
	return { authority, loadForActivation, append };
}

describe("ConversationComputerExecutionAuthority", function _DescribeConversationComputerExecutionAuthority()
{
	it("appends one server-generated execution under the checked warm lease revision", async function _StartsExecution()
	{
		const subject = _Subject();

		const result = await subject.authority.start(_Command());

		expect(result).toEqual({ outcome: ConversationComputerExecutionStartOutcomes.Started, execution: expect.objectContaining({ leaseId: "lease-1", leaseGeneration: 1, startedAt: _NOW.toISOString(), endedAt: null, id: expect.stringMatching(/^[0-9a-f-]{36}$/iu) }) });
		expect(subject.append).toHaveBeenCalledWith(expect.objectContaining({
			expectedRevision: 3n,
			computer: expect.objectContaining({ activeExecution: result.execution, updatedAt: _NOW.toISOString() }),
			lease: _Lease(),
		}));
	});

	it("returns an existing open execution without writing another history snapshot", async function _ReusesExistingExecution()
	{
		const execution = _Execution();
		const subject = _Subject({ current: _Current({ computer: _Computer({ activeExecution: execution }) }) });

		await expect(subject.authority.start(_Command())).resolves.toEqual({ outcome: ConversationComputerExecutionStartOutcomes.AlreadyActive, execution });
		expect(subject.append).not.toHaveBeenCalled();
	});

	it("returns the durable concurrent winner after an append revision race", async function _RecoversConcurrentStart()
	{
		const winner = _Execution({ id: "execution-winner" });
		const subject = _Subject({ reloaded: _Current({ revision: 4n, computer: _Computer({ activeExecution: winner }) }), appendError: new Error("expected revision changed") });

		await expect(subject.authority.start(_Command())).resolves.toEqual({ outcome: ConversationComputerExecutionStartOutcomes.AlreadyActive, execution: winner });
		expect(subject.loadForActivation).toHaveBeenCalledTimes(2);
	});

	it("refuses expired, terminal, and replaced lease states before any append", async function _RejectsUnavailableState()
	{
		const expired = _Subject({ current: _Current({ lease: _Lease({ expiresAt: "2026-09-01T00:09:59.999Z" }) }) });
		const terminal = _Subject({ current: _Current({ computer: _Computer({ activeExecution: _Execution({ endedAt: "2026-09-01T00:05:00.000Z" }) }) }) });
		const cooling = _Subject({ current: _Current({ computer: _Computer({ state: ConversationComputerStates.Cooling }) }) });

		await expect(expired.authority.start(_Command())).resolves.toEqual({ outcome: ConversationComputerExecutionStartOutcomes.Unavailable, execution: null });
		await expect(terminal.authority.start(_Command())).resolves.toEqual({ outcome: ConversationComputerExecutionStartOutcomes.Unavailable, execution: null });
		await expect(cooling.authority.start(_Command())).resolves.toEqual({ outcome: ConversationComputerExecutionStartOutcomes.Unavailable, execution: null });
		expect(expired.append).not.toHaveBeenCalled();
		expect(terminal.append).not.toHaveBeenCalled();
		expect(cooling.append).not.toHaveBeenCalled();
	});

	it("rechecks server time after history I/O before it appends an execution", async function _RejectsLeaseThatExpiresDuringLoad()
	{
		const subject = _Subject({ afterFirstLoadClock: new Date("2026-09-01T00:20:00.000Z") });

		await expect(subject.authority.start(_Command())).resolves.toEqual({ outcome: ConversationComputerExecutionStartOutcomes.Unavailable, execution: null });
		expect(subject.append).not.toHaveBeenCalled();
	});

	it("rechecks the history-owned append head before a lease can cross expiry", async function _RejectsLeaseThatExpiresDuringAppend()
	{
		const subject = _Subject({ beforeAppendClock: new Date("2026-09-01T00:20:00.000Z") });

		await expect(subject.authority.start(_Command())).rejects.toThrow("changed or expired before its history append");
		expect(subject.append).toHaveBeenCalledTimes(1);
	});

	it("propagates an append failure when a reload has no active concurrent winner", async function _PropagatesFailedStart()
	{
		const appendError = new Error("expected revision changed");
		const subject = _Subject({ reloaded: _Current({ revision: 4n }), appendError });

		await expect(subject.authority.start(_Command())).rejects.toThrow(appendError);
	});
});
