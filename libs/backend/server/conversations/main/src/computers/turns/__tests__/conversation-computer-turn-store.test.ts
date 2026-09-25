import { ConversationModelToolModes } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { _ConversationModelRequestDigest } from "../conversation-computer-model-reservation";
import { _ConversationComputerTurnHistoryDigest, _InitialConversationComputerTurnProtocol } from "../conversation-computer-turn-protocol";
import { ConversationComputerTurnProtocolStates } from "../conversation-computer-turn-protocol.types";
import type { ConversationComputerTurnModelReservation, ConversationComputerTurnToolResult, ConversationComputerTurnToolSelection } from "../conversation-computer-turn-protocol.types";
import { KurrentConversationComputerTurnStore } from "../conversation-computer-turn-store";
import type { FrozenConversationComputerTurn } from "../conversation-computer-turn.types";

const _ID = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";
const _DIGEST_A = `sha256:${"a".repeat(64)}`;
const _DIGEST_B = `sha256:${"b".repeat(64)}`;
const _TURN: FrozenConversationComputerTurn = {
	bootstrapId: _ID,
	siloId: "testv5",
	computerId: "computer-1",
	lease: { leaseId: "lease-1", leaseGeneration: 1, sandboxClaimId: "computer-1-g1" },
	latestPendingEntryId: "entry-1",
	latestPendingEntryPosition: "1",
	modelAlias: "testv5-default",
	maximumBudgetUsd: 0.05,
	credentialLifetimeSeconds: 300,
	binding: { siloId: "testv5", conversationId: "conversation-1", computerId: "computer-1", leaseGeneration: 1, agentIdentityId: "identity-1", agentServiceId: "service-1", agentName: "Ada", agentAvatarArtifactRevisionId: null, runId: "run-1", expectedRevision: 1n, maximumEntryBytes: 65_536 },
	compile: { runId: "run-1", attempt: 1, promptCompilerVersion: "computer-v2", digest: _DIGEST_A },
	budget: { maxModelTurns: 3, maxCompletionTokens: 300, maxCostUsdMicros: null, maxToolInvocations: 2, maxLoopIterations: 2, wallClockDeadlineEpochMs: 2_000_000_000_000 },
	protocol: _InitialConversationComputerTurnProtocol(),
};

function _History()
{
	const streams = new Map<string, Array<Record<string, unknown>>>();
	const append = vi.fn(async function _Append(input: { streamName: string; events: readonly Record<string, unknown>[] })
	{
		const events = streams.get(input.streamName) ?? [];
		for (const event of input.events)
			events.push({ ...structuredClone(event), streamName: input.streamName, revision: BigInt(events.length), recordedAt: new Date() });
		streams.set(input.streamName, events);
	});
	return {
		streams,
		append,
		appendAtomic: vi.fn(),
		readStream: vi.fn(function _Read(input: { streamName: string })
		{
			return (async function* _Events()
			{
				for (const event of streams.get(input.streamName) ?? [])
					yield event;
			})();
		}),
	};
}

function _Reservation(turn: FrozenConversationComputerTurn): ConversationComputerTurnModelReservation
{
	const facts = { ordinal: 1, tools: ConversationModelToolModes.Select, compiledInputDigest: turn.compile.digest, historyDigest: _ConversationComputerTurnHistoryDigest(turn.protocol.steps), maxCompletionTokens: 100, authorityExpiresAtEpochMs: 1_900_000_000_000, dispatchDeadlineEpochMs: 1_800_000_000_000 } as const;
	return { invocationFence: "41c1f1dc-0010-4f13-9c2f-d3841ffd6651", ...facts, requestDigest: _ConversationModelRequestDigest(turn, facts) };
}

const _SELECTION: ConversationComputerTurnToolSelection = { ordinal: 1, modelInvocationFence: "41c1f1dc-0010-4f13-9c2f-d3841ffd6651", declaration: { payloadRef: "private-declaration-1", ciphertextDigest: _DIGEST_A }, proposalId: "proposal-1", toolInvocationId: "proposal-1", requestFingerprint: _DIGEST_B };
const _RESULT: ConversationComputerTurnToolResult = { ordinal: 1, proposalId: "proposal-1", toolInvocationId: "proposal-1", resultDigest: _DIGEST_A, exchange: { payloadRef: "private-exchange-1", ciphertextDigest: _DIGEST_B }, authorityExpiresAtEpochMs: 1_850_000_000_000 };

describe("KurrentConversationComputerTurnStore", function ()
{
	it("freezes only coordinates, complete budget and digest evidence", async function ()
	{
		const history = _History();
		const leaking = { ..._TURN, compiledInput: { instructions: "private instructions", messages: ["private message"] } } as FrozenConversationComputerTurn;
		await new KurrentConversationComputerTurnStore(history as never).createOrRead(leaking);
		const serialized = JSON.stringify(history.streams.get(`conversation-computer-turn-${_ID}`)?.[0]?.["data"]);
		expect(serialized).not.toContain("compiledInput");
		expect(serialized).not.toContain("private instructions");
		expect(serialized).toContain('"maxLoopIterations":2');
		expect(serialized).toContain(_DIGEST_A);
	});

	it("replays ordered reservation, selection and result events with aggregate accounting", async function ()
	{
		const history = _History();
		const store = new KurrentConversationComputerTurnStore(history as never);
		const frozen = await store.createOrRead(_TURN);
		expect(await store.reserveModel(_ID, _Reservation(frozen))).toBe(true);
		await store.selectTool(_ID, _SELECTION);
		await store.recordToolResult(_ID, _RESULT);
		const restored = await store.load(_ID);
		expect(restored?.protocol.state).toBe(ConversationComputerTurnProtocolStates.ResultReady);
		expect(restored?.protocol.steps).toHaveLength(1);
		expect(restored?.protocol.steps[0]?.result).toEqual(_RESULT);
		expect(restored?.protocol.accounting).toEqual({ reservedModelCalls: 1, reservedCompletionTokens: 100, reservedToolInvocations: 1, toolResultCyclesFed: 0 });
	});

	it("does not append again when the same selected step is recovered", async function ()
	{
		const history = _History();
		const store = new KurrentConversationComputerTurnStore(history as never);
		const frozen = await store.createOrRead(_TURN);
		await store.reserveModel(_ID, _Reservation(frozen));
		await store.selectTool(_ID, _SELECTION);
		const before = history.append.mock.calls.length;
		await store.selectTool(_ID, _SELECTION);
		expect(history.append).toHaveBeenCalledTimes(before);
	});

	it("rejects a frozen turn whose projection already contains mutable progress", async function ()
	{
		const history = _History();
		const turn = { ..._TURN, protocol: { ..._TURN.protocol, revision: 1n } };
		await expect(new KurrentConversationComputerTurnStore(history as never).createOrRead(turn)).rejects.toThrow("empty protocol");
		expect(history.append).not.toHaveBeenCalled();
	});
});
