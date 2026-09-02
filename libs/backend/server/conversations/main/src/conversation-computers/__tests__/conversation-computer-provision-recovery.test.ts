import { ConversationComputerStates, type ConversationComputer } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { _ConversationComputerProvisionRecovery } from "../conversation-computer-provision-recovery";
import { _ConversationComputerProvisionRecoveryOutcomes } from "../conversation-computer-provision-recovery.types";

/** Reuses the event identifier that the creation reservation assigns to one computer provision. */
const _EVENT_ID = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";

/** Builds the only cold snapshot that can establish a computer history stream. */
function _ColdComputer(overrides: Partial<ConversationComputer> = {}): ConversationComputer
{
	return {
		schemaVersion: 1,
		id: "computer-1",
		siloId: "silo-1",
		conversationId: "conversation-1",
		agentIdentityId: "identity-1",
		profileRevisionId: "profile-1",
		state: ConversationComputerStates.Cold,
		leaseGeneration: 0,
		workspaceCheckpoint: null,
		activeExecution: null,
		createdAt: "2026-09-02T00:00:00.000Z",
		updatedAt: "2026-09-02T00:00:00.000Z",
		...overrides,
	};
}

/** Builds a revision-zero, lease-free snapshot for cold-provision recovery tests. */
function _Current(computer: ConversationComputer = _ColdComputer(), revision = 0n)
{
	return {
		streamName: `computer-${computer.id}`,
		revision,
		computer,
		lease: null,
	};
}

/** Creates the narrow computer-history fake used to observe provision and reload behavior. */
function _Subject(overrides: { readonly provisionError?: Error; readonly current?: ReturnType<typeof _Current> | null } = {})
{
	const provision = vi.fn();
	if (overrides.provisionError !== undefined)
		provision.mockRejectedValue(overrides.provisionError);
	const load = vi.fn().mockResolvedValue(overrides.current ?? null);
	const authority = new _ConversationComputerProvisionRecovery({ provision, load } as never);
	return { authority, provision, load };
}

describe("_ConversationComputerProvisionRecovery", function _DescribeConversationComputerProvisionRecovery()
{
	it("provisions a frozen cold computer without reading history when the append acknowledges", async function _ProvisionsColdComputer()
	{
		const subject = _Subject();
		const computer = _ColdComputer();

		await expect(subject.authority.provision({ eventId: _EVENT_ID, computer })).resolves.toEqual({ outcome: _ConversationComputerProvisionRecoveryOutcomes.Provisioned });
		expect(subject.provision).toHaveBeenCalledWith({ eventId: _EVENT_ID, computer });
		expect(subject.load).not.toHaveBeenCalled();
	});

	it("recovers a duplicate or response-lost append only from the same cold revision-zero snapshot", async function _RecoversExactColdComputer()
	{
		const computer = _ColdComputer();
		const subject = _Subject({ provisionError: new Error("expected no stream"), current: _Current(computer) });

		await expect(subject.authority.provision({ eventId: _EVENT_ID, computer })).resolves.toEqual({ outcome: _ConversationComputerProvisionRecoveryOutcomes.Recovered });
		expect(subject.load).toHaveBeenCalledWith({ siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1" });
	});

	it("keeps a missing, foreign, changed, or later computer stream as the original provision failure", async function _RejectsNonExactRecovery()
	{
		const error = new Error("expected no stream");
		const computer = _ColdComputer();
		const missing = _Subject({ provisionError: error });
		const foreign = _Subject({ provisionError: error, current: _Current(_ColdComputer({ id: "computer-foreign" })) });
		const changed = _Subject({ provisionError: error, current: _Current(_ColdComputer({ createdAt: "2026-09-02T00:00:01.000Z", updatedAt: "2026-09-02T00:00:01.000Z" })) });
		const later = _Subject({ provisionError: error, current: _Current(computer, 1n) });

		await expect(missing.authority.provision({ eventId: _EVENT_ID, computer })).rejects.toThrow(error);
		await expect(foreign.authority.provision({ eventId: _EVENT_ID, computer })).rejects.toThrow(error);
		await expect(changed.authority.provision({ eventId: _EVENT_ID, computer })).rejects.toThrow(error);
		await expect(later.authority.provision({ eventId: _EVENT_ID, computer })).rejects.toThrow(error);
	});
});
