import { AgentIdentityStates, type AgentIdentity, type ManagedAgentIdentity, type ManagedSubChatAgentIdentity, type ProxiedAgentIdentity } from "@opencrane/contracts";
import { HistoryExpectedRevisions, type HistoryRecordedEvent, type HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { describe, expect, it, vi } from "vitest";

import { AgentIdentityHistory } from "../agent-identity-history";
import type { AgentIdentityAppendCommand, AgentIdentityCurrentCommand } from "../agent-identity-history.types";

/** Reuses a valid UUID for the immutable history event idempotency key. */
const _EVENT_ID = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";

/** Builds one managed identity snapshot with coordinates that authorization can bind exactly. */
function _ManagedIdentity(overrides: Partial<ManagedAgentIdentity> = {}): ManagedAgentIdentity
{
	return {
		schemaVersion: 1,
		id: "identity-1",
		siloId: "silo-1",
		agentServiceId: "service-1",
		name: "Archive",
		avatarArtifactRevisionId: null,
		state: AgentIdentityStates.Active,
		createdByPrincipalId: "principal-owner-1",
		createdAt: "2026-09-01T00:00:00.000Z",
		kind: "managed",
		principalId: "principal-agent-1",
		...overrides,
	};
}

/** Builds a sub-chat identity whose dedicated principal must never resolve through its parent. */
function _SubChatIdentity(overrides: Partial<ManagedSubChatAgentIdentity> = {}): ManagedSubChatAgentIdentity
{
	return {
		..._ManagedIdentity(),
		kind: "managed_subchat",
		principalId: "principal-subchat-1",
		parentAgentIdentityId: "identity-parent-1",
		parentPrincipalId: "principal-agent-1",
		parentConversationId: "conversation-parent-1",
		conversationId: "conversation-subchat-1",
		requestedByPrincipalId: "principal-owner-1",
		...overrides,
	};
}

/** Builds a proxied identity so retired service sentinels are tested across every principal kind. */
function _ProxiedIdentity(overrides: Partial<ProxiedAgentIdentity> = {}): ProxiedAgentIdentity
{
	const { principalId: _ManagedPrincipalId, ...identity } = _ManagedIdentity();
	return {
		...identity,
		kind: "proxied",
		proxiedPrincipalId: "principal-proxied-1",
		delegationPolicyId: "policy-1",
		...overrides,
	};
}

/** Builds the trusted identity tuple accepted by the loader. */
function _CurrentCommand(overrides: Partial<AgentIdentityCurrentCommand> = {}): AgentIdentityCurrentCommand
{
	return { siloId: "silo-1", agentIdentityId: "identity-1", agentServiceId: "service-1", principalId: "principal-agent-1", ...overrides };
}

/** Builds a checked snapshot append command. */
function _AppendCommand(overrides: Partial<AgentIdentityAppendCommand> = {}): AgentIdentityAppendCommand
{
	return { expectedRevision: 2n, eventId: _EVENT_ID, identity: _ManagedIdentity(), ...overrides };
}

/** Builds a recorded history envelope that must agree with its typed identity snapshot. */
function _Event(revision: bigint, identity: AgentIdentity = _ManagedIdentity()): HistoryRecordedEvent
{
	const principalId = identity.kind === "proxied" ? identity.proxiedPrincipalId : identity.principalId;
	return {
		streamName: `agent-identity-${identity.id}`,
		id: _EVENT_ID,
		type: "opencrane.agent-identity.v1",
		data: { identity },
		metadata: { siloId: identity.siloId, agentIdentityId: identity.id, agentServiceId: identity.agentServiceId, principalId, kind: identity.kind },
		revision,
		recordedAt: new Date("2026-09-01T00:00:00.000Z"),
	};
}

/** Turns a finite test sequence into the HistoryStore stream read contract. */
async function *_Events(events: readonly HistoryRecordedEvent[]): AsyncIterable<HistoryRecordedEvent>
{
	for (const event of events)
		yield event;
}

/** Builds a narrow fake HistoryStore without introducing a direct KurrentDB client into this package. */
function _Store(overrides: Partial<Pick<HistoryStore, "append" | "appendAtomic" | "readHead" | "readStream">> = {}): Pick<HistoryStore, "append" | "appendAtomic" | "readHead" | "readStream">
{
	return {
		append: vi.fn(),
		appendAtomic: vi.fn(),
		readHead: vi.fn().mockResolvedValue({ streamName: "agent-identity-identity-1", revision: null }),
		readStream: vi.fn().mockReturnValue(_Events([])),
		...overrides,
	};
}

/** Builds a store whose streams each return fresh finite history and a matching deterministic head. */
function _StreamStore(streams: Readonly<Record<string, readonly HistoryRecordedEvent[]>>, overrides: Partial<Pick<HistoryStore, "append" | "appendAtomic">> = {}): Pick<HistoryStore, "append" | "appendAtomic" | "readHead" | "readStream">
{
	return _Store({
		readStream: vi.fn().mockImplementation(function _ReadIdentityStream(request) { return _Events(streams[request.streamName] ?? []); }),
		readHead: vi.fn().mockImplementation(async function _ReadIdentityHead(streamName) { const events = streams[streamName] ?? []; return { streamName, revision: events.length === 0 ? null : events[events.length - 1].revision }; }),
		...overrides,
	});
}

describe("AgentIdentityHistory", function ()
{
	it("appends only a validated snapshot to its deterministic identity stream at the checked head", async function ()
	{
		const append = vi.fn().mockResolvedValue({ streamName: "agent-identity-identity-1", revision: 3n });
		const history = new AgentIdentityHistory(_Store({ append }));

		await expect(history.append(_AppendCommand())).resolves.toEqual({ streamName: "agent-identity-identity-1", revision: 3n });
		expect(append).toHaveBeenCalledWith({
			streamName: "agent-identity-identity-1",
			expectedRevision: 2n,
			events: [{
				id: _EVENT_ID,
				type: "opencrane.agent-identity.v1",
				data: { identity: _ManagedIdentity() },
				metadata: { siloId: "silo-1", agentIdentityId: "identity-1", agentServiceId: "service-1", principalId: "principal-agent-1", kind: "managed" },
			}],
		});
	});

	it("accepts KurrentDB's exact no-stream condition for the first identity revision", async function ()
	{
		const append = vi.fn().mockResolvedValue({ streamName: "agent-identity-identity-1", revision: 0n });
		const history = new AgentIdentityHistory(_Store({ append }));

		await expect(history.append(_AppendCommand({ expectedRevision: HistoryExpectedRevisions.NoStream }))).resolves.toEqual({ streamName: "agent-identity-identity-1", revision: 0n });
		expect(append).toHaveBeenCalledWith(expect.objectContaining({ streamName: "agent-identity-identity-1", expectedRevision: HistoryExpectedRevisions.NoStream }));
	});

	it("atomically appends a managed sub-chat only with its live checked parent binding", async function ()
	{
		const subchat = _SubChatIdentity();
		const parent = _ManagedIdentity({ id: "identity-parent-1", agentServiceId: "service-parent-1", principalId: "principal-agent-1" });
		const appendAtomic = vi.fn().mockResolvedValue([{ streamName: "agent-identity-identity-1", revision: 0n }]);
		const history = new AgentIdentityHistory(_StreamStore({ "agent-identity-identity-parent-1": [_Event(0n, parent)] }, { appendAtomic }));

		await expect(history.append(_AppendCommand({ identity: subchat, expectedRevision: HistoryExpectedRevisions.NoStream }))).resolves.toEqual({ streamName: "agent-identity-identity-1", revision: 0n });
		expect(appendAtomic).toHaveBeenCalledWith(expect.objectContaining({ expectedHeads: [{ streamName: "agent-identity-identity-1", revision: HistoryExpectedRevisions.NoStream }, { streamName: "agent-identity-identity-parent-1", revision: 0n }] }));
	});

	it("rejects an unknown identity kind before append and preserves a stale checked-append failure", async function ()
	{
		const append = vi.fn().mockRejectedValueOnce(new Error("stale expected revision"));
		const history = new AgentIdentityHistory(_Store({ append }));
		const unknownKind = { ..._ManagedIdentity(), kind: "unrecognized" } as unknown as AgentIdentity;

		await expect(history.append(_AppendCommand({ identity: unknownKind }))).rejects.toThrow("unsupported identity kind");
		expect(append).not.toHaveBeenCalled();
		await expect(history.append(_AppendCommand({ expectedRevision: HistoryExpectedRevisions.NoStream }))).rejects.toThrow("stale expected revision");
		expect(append).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: HistoryExpectedRevisions.NoStream }));
	});

	it("returns current validated state with matching stream-head evidence", async function ()
	{
		const identity = _ManagedIdentity({ name: "Current archive" });
		const readStream = vi.fn().mockReturnValue(_Events([_Event(0n, identity)]));
		const readHead = vi.fn().mockResolvedValue({ streamName: "agent-identity-identity-1", revision: 0n });
		const history = new AgentIdentityHistory(_Store({ readStream, readHead }));

		await expect(history.load(_CurrentCommand())).resolves.toEqual(expect.objectContaining({ streamName: "agent-identity-identity-1", revision: 0n, headDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u), identity }));
		expect(readStream).toHaveBeenCalledWith({ streamName: "agent-identity-identity-1" });
	});

	it("fails closed for an unknown kind and wrong silo, service, or principal coordinates", async function ()
	{
		const unknownKind = _Event(0n, { ..._ManagedIdentity(), kind: "unrecognized" } as unknown as AgentIdentity);
		const wrongSilo = _Event(0n, _ManagedIdentity({ siloId: "silo-2" }));
		const wrongService = _Event(0n, _ManagedIdentity({ agentServiceId: "service-2" }));
		const wrongPrincipal = _Event(0n, _ManagedIdentity({ principalId: "principal-agent-2" }));

		await expect(new AgentIdentityHistory(_Store({ readStream: vi.fn().mockReturnValue(_Events([unknownKind])), readHead: vi.fn().mockResolvedValue({ streamName: "agent-identity-identity-1", revision: 0n }) })).load(_CurrentCommand())).rejects.toThrow("unsupported identity kind");
		await expect(new AgentIdentityHistory(_Store({ readStream: vi.fn().mockReturnValue(_Events([wrongSilo])), readHead: vi.fn().mockResolvedValue({ streamName: "agent-identity-identity-1", revision: 0n }) })).load(_CurrentCommand())).rejects.toThrow("different silo");
		await expect(new AgentIdentityHistory(_Store({ readStream: vi.fn().mockReturnValue(_Events([wrongService])), readHead: vi.fn().mockResolvedValue({ streamName: "agent-identity-identity-1", revision: 0n }) })).load(_CurrentCommand())).rejects.toThrow("different agent service");
		await expect(new AgentIdentityHistory(_Store({ readStream: vi.fn().mockReturnValue(_Events([wrongPrincipal])), readHead: vi.fn().mockResolvedValue({ streamName: "agent-identity-identity-1", revision: 0n }) })).load(_CurrentCommand())).rejects.toThrow("different principal");
	});

	it("denies revoked identities for fresh protected work while retaining their current history evidence", async function ()
	{
		const revoked = _ManagedIdentity({ state: AgentIdentityStates.Revoked });
		const history = new AgentIdentityHistory(_Store({ readStream: vi.fn().mockImplementation(function _ReadRevokedIdentity() { return _Events([_Event(0n, revoked)]); }), readHead: vi.fn().mockResolvedValue({ streamName: "agent-identity-identity-1", revision: 0n }) }));

		await expect(history.load(_CurrentCommand())).resolves.toEqual(expect.objectContaining({ identity: expect.objectContaining({ state: AgentIdentityStates.Revoked }) }));
		await expect(history.loadActive(_CurrentCommand())).rejects.toThrow("non-active identity");
	});

	it("does not inherit a parent identity's authority for a managed sub-chat", async function ()
	{
		const subchat = _SubChatIdentity();
		const parent = _ManagedIdentity({ id: "identity-parent-1", agentServiceId: "service-parent-1", principalId: "principal-agent-1" });
		const history = new AgentIdentityHistory(_StreamStore({ "agent-identity-identity-1": [_Event(0n, subchat)], "agent-identity-identity-parent-1": [_Event(0n, parent)] }));

		await expect(history.loadActive(_CurrentCommand({ principalId: "principal-agent-1" }))).rejects.toThrow("different principal");
		await expect(history.loadActive(_CurrentCommand({ principalId: "principal-subchat-1" }))).resolves.toEqual(expect.objectContaining({ identity: subchat }));
	});

	it("rejects a managed sub-chat that reuses its parent identity principal", async function ()
	{
		const inheritedPrincipal = _SubChatIdentity({ principalId: "principal-parent-1", parentPrincipalId: "principal-parent-1" });
		const history = new AgentIdentityHistory(_Store({ readStream: vi.fn().mockImplementation(function _ReadInheritedPrincipalIdentity() { return _Events([_Event(0n, inheritedPrincipal)]); }), readHead: vi.fn().mockResolvedValue({ streamName: "agent-identity-identity-1", revision: 0n }) }));

		await expect(history.load(_CurrentCommand({ principalId: "principal-parent-1" }))).rejects.toThrow("remain distinct from its parent");
	});

	it("rejects a forged unequal parent principal and a revoked parent stream", async function ()
	{
		const parent = _ManagedIdentity({ id: "identity-parent-1", agentServiceId: "service-parent-1", principalId: "principal-parent-1" });
		const forged = _SubChatIdentity({ parentPrincipalId: "principal-forged-1" });
		const revoked = _ManagedIdentity({ ...parent, state: AgentIdentityStates.Revoked });
		const appendAtomic = vi.fn();
		const forgedHistory = new AgentIdentityHistory(_StreamStore({ "agent-identity-identity-1": [_Event(0n, forged)], "agent-identity-identity-parent-1": [_Event(0n, parent)] }, { appendAtomic }));

		await expect(forgedHistory.load(_CurrentCommand({ principalId: "principal-subchat-1" }))).rejects.toThrow("parent with a different principal");
		await expect(forgedHistory.append(_AppendCommand({ identity: forged, expectedRevision: HistoryExpectedRevisions.NoStream }))).rejects.toThrow("parent with a different principal");
		expect(appendAtomic).not.toHaveBeenCalled();
		await expect(new AgentIdentityHistory(_StreamStore({ "agent-identity-identity-1": [_Event(0n, _SubChatIdentity({ parentPrincipalId: "principal-parent-1" }))], "agent-identity-identity-parent-1": [_Event(0n, revoked)] })).load(_CurrentCommand({ principalId: "principal-subchat-1" }))).rejects.toThrow("non-active parent identity");
	});

	it("rejects missing and cyclic managed sub-chat parent chains", async function ()
	{
		const child = _SubChatIdentity({ principalId: "principal-child-1", parentPrincipalId: "principal-parent-1" });
		const parent = _SubChatIdentity({ id: "identity-parent-1", principalId: "principal-parent-1", parentAgentIdentityId: "identity-1", parentPrincipalId: "principal-child-1", parentConversationId: "conversation-child-1", conversationId: "conversation-parent-1" });

		await expect(new AgentIdentityHistory(_StreamStore({ "agent-identity-identity-1": [_Event(0n, child)] })).load(_CurrentCommand({ principalId: "principal-child-1" }))).rejects.toThrow("missing parent identity");
		await expect(new AgentIdentityHistory(_StreamStore({ "agent-identity-identity-1": [_Event(0n, child)], "agent-identity-identity-parent-1": [_Event(0n, parent)] })).load(_CurrentCommand({ principalId: "principal-child-1" }))).rejects.toThrow("parent cycle");
	});

	it("rejects the retired agent-service sentinel for every principal-valued coordinate", async function ()
	{
		const history = new AgentIdentityHistory(_Store());
		const sentinel = "agent-service:retired";

		await expect(history.append(_AppendCommand({ identity: _ManagedIdentity({ principalId: sentinel }) }))).rejects.toThrow("managed identity principal");
		await expect(history.append(_AppendCommand({ identity: _ProxiedIdentity({ proxiedPrincipalId: sentinel }) }))).rejects.toThrow("proxied identity coordinates");
		await expect(history.append(_AppendCommand({ identity: _SubChatIdentity({ principalId: sentinel }) }))).rejects.toThrow("complete managed sub-chat coordinates");
		await expect(history.append(_AppendCommand({ identity: _SubChatIdentity({ parentPrincipalId: sentinel }) }))).rejects.toThrow("complete managed sub-chat coordinates");
		await expect(history.load(_CurrentCommand({ principalId: sentinel }))).rejects.toThrow("server-provided principal identifier");
	});
});
