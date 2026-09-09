import { ConversationModelToolModes } from "@opencrane/contracts";
import { _ConversationModelRequestDigest } from "../conversation-computer-model-reservation";
import { _ModelReservationFixture, _ReserveConversationOutputFixture } from "./conversation-output-intent.fixture";
import { randomUUID } from "node:crypto";

import { KurrentDBClient } from "@kurrent/kurrentdb-client";
import { _KurrentHistoryStore, type HistoryAppend, type HistoryRecordedEvent, type HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { afterAll, describe, expect, it, vi } from "vitest";

import { BoundConversationWriter } from "@opencrane/backend/server/conversations/history";
import type { BoundConversationWriterIntent } from "@opencrane/backend/server/conversations/history";
import { ConversationHistoryAuthority } from "@opencrane/backend/server/conversations/history";
import { KurrentConversationComputerTurnStore } from "../conversation-computer-turn-store";
import type { FrozenConversationComputerTurn } from "../conversation-computer-turn.types";
import { _PrepareConversationOutputIntent } from "./conversation-output-intent.fixture";

/** Require an explicit server URL; ordinary local tests never start a database. */
const _URL = process.env["KURRENTDB_INTEGRATION_URL"];

it.skipIf(_URL !== undefined)("skips live saved-answer proofs because KURRENTDB_INTEGRATION_URL is unset", function ()
{
	expect(_URL).toBeUndefined();
});

describe.skipIf(_URL === undefined)("saved conversation answers against a live KurrentDB", function ()
{
	const clients: KurrentDBClient[] = [];

	/** Give each simulated restart a fresh client and adapter over the same server. */
	function _Connect()
	{
		const client = KurrentDBClient.connectionString(_URL ?? "");
		clients.push(client);
		return new _KurrentHistoryStore(client);
	}

	afterAll(async function _Disconnect()
	{
		await Promise.all(clients.map(client => client.dispose()));
	});

	/** Freeze isolated server-owned coordinates after creating their real conversation genesis. */
	async function _Freeze(history: _KurrentHistoryStore): Promise<FrozenConversationComputerTurn>
	{
		const siloId = `proof-${randomUUID()}`;
		const conversationId = randomUUID();
		const computerId = randomUUID();
		const runId = randomUUID();
		const genesis = new ConversationHistoryAuthority(history).genesisAppend({ schemaVersion: 1, conversationId, siloId, mode: "direct", agentServiceId: null, createdByPrincipalId: "proof-principal", createdAt: "2026-09-09T00:00:00.000Z" }, randomUUID());
		await history.append(genesis);
		const turn: FrozenConversationComputerTurn = {
			bootstrapId: randomUUID(), siloId, computerId,
			lease: { leaseId: randomUUID(), leaseGeneration: 1, sandboxClaimId: `${computerId}-g1` },
			latestPendingEntryId: randomUUID(), modelAlias: "proof-model", maximumBudgetUsd: 0.05,
			credentialLifetimeSeconds: 60, outputSourceCommandId: null, outputReceipt: null, toolSelection: null, continuationReservation: null, modelReservation: null,
			binding: { siloId, conversationId, computerId, leaseGeneration: 1, agentIdentityId: randomUUID(), agentServiceId: randomUUID(), agentName: "Ada", agentAvatarArtifactRevisionId: null, runId, expectedRevision: 0n, maximumEntryBytes: 65_536 },
			compile: { runId, attempt: 1, promptCompilerVersion: "proof-v1", digest: `sha256:${"a".repeat(64)}` },
		};
		return new KurrentConversationComputerTurnStore(history).createOrRead(turn);
	}

	/** Recover through the production writer with a clock that cannot stamp another answer. */
	function _Writer(history: Pick<HistoryStore, "append" | "readStream">, turn: FrozenConversationComputerTurn, fence = vi.fn().mockResolvedValue(undefined))
	{
		return new BoundConversationWriter(history, turn.binding, { now: function _NoRestamp() { throw new Error("recovery must not restamp"); } }, { assertMayAppend: async function _Rate() {} }, { assertMayUseVisibility: async function _Visibility() {} }, { assertMayAppend: fence });
	}

	/** Collect participant-visible output without conflating it with the turn decision stream. */
	async function _Outputs(history: _KurrentHistoryStore, intent: BoundConversationWriterIntent)
	{
		const events: HistoryRecordedEvent[] = [];
		for await (const event of history.readStream({ streamName: intent.streamName, fromRevision: 1n }))
			events.push(event);
		return events;
	}

	/** Hold two independent clients until both decision appends reach the same expected revision. */
	function _RacingStores(expectedRevision = 0n)
	{
		let arrivals = 0;
		let release!: () => void;
		const barrier = new Promise<void>(resolve => { release = resolve; });
		return [0, 1].map(function _Client()
		{
			const history = _Connect();
			return new KurrentConversationComputerTurnStore({
				readStream: history.readStream.bind(history),
				append: async function _AtSameRevision(command: HistoryAppend)
				{
					expect(command.expectedRevision).toBe(expectedRevision);
					arrivals += 1;
					if (arrivals === 2)
						release();
					await barrier;
					return history.append(command);
				},
			});
		});
	}

	it("elects one fresh model fence across independent clients without adopting it after restart", async function ()
	{
		const turn = await _Freeze(_Connect());
		const contenders = [_ModelReservationFixture(turn, randomUUID()), _ModelReservationFixture(turn, randomUUID())];
		const stores = _RacingStores();
		const results = await Promise.all(stores.map((store, index) => store.reserveModel(turn.bootstrapId, contenders[index]!)));
		expect(results.filter(Boolean)).toHaveLength(1);
		const restarted = new KurrentConversationComputerTurnStore(_Connect());
		const winner = contenders[results.indexOf(true)]!;
		expect((await restarted.load(turn.bootstrapId))?.modelReservation).toEqual(winner);
		await expect(restarted.reserveModel(turn.bootstrapId, winner)).resolves.toBe(false);
		await expect(restarted.reserveModel(turn.bootstrapId, _ModelReservationFixture(turn, randomUUID()))).resolves.toBe(false);
	});

	it("elects either a direct answer or saved tool declaration at the same live revision", async function ()
	{
		const history = _Connect();
		const turn = await _Freeze(history);
		const first = _ModelReservationFixture(turn, randomUUID(), ConversationModelToolModes.Select);
		await new KurrentConversationComputerTurnStore(history).reserveModel(turn.bootstrapId, first);
		const tool = { proposalId: randomUUID(), requestFingerprint: `sha256:${"b".repeat(64)}`, payloadRef: randomUUID(), ciphertextDigest: `sha256:${"c".repeat(64)}` };
		const answer = await _PrepareConversationOutputIntent(turn, first.invocationFence);
		const [answerStore, toolStore] = _RacingStores(1n);
		const results = await Promise.allSettled([answerStore!.markOutput(turn.bootstrapId, answer), toolStore!.selectTool(turn.bootstrapId, tool)]);
		expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
		const winner = (await new KurrentConversationComputerTurnStore(_Connect()).load(turn.bootstrapId))!;
		expect(winner.outputReceipt !== null).not.toBe(winner.toolSelection !== null);
	});

	it("reserves one post-tool request and recovers its final answer across independent clients", async function ()
	{
		const history = _Connect();
		const turn = await _Freeze(history);
		const store = new KurrentConversationComputerTurnStore(history);
		const first = _ModelReservationFixture(turn, randomUUID(), ConversationModelToolModes.Select);
		await store.reserveModel(turn.bootstrapId, first);
		const selection = { proposalId: randomUUID(), requestFingerprint: `sha256:${"b".repeat(64)}`, payloadRef: randomUUID(), ciphertextDigest: `sha256:${"c".repeat(64)}` };
		await store.selectTool(turn.bootstrapId, selection);
		const selected = (await store.load(turn.bootstrapId))!;
		const facts = { ordinal: 2 as const, tools: ConversationModelToolModes.None, compiledInputDigest: turn.compile.digest, maxCompletionTokens: 50, authorityExpiresAtEpochMs: first.authorityExpiresAtEpochMs, dispatchDeadlineEpochMs: first.dispatchDeadlineEpochMs, continuation: { payloadRef: randomUUID(), ciphertextDigest: `sha256:${"d".repeat(64)}` }, proposalId: selection.proposalId, resultDigest: `sha256:${"e".repeat(64)}` };
		const contenders = [0, 1].map(() => ({ ...facts, invocationFence: randomUUID(), requestDigest: _ConversationModelRequestDigest(selected, facts) }));
		const stores = _RacingStores(2n);
		const results = await Promise.all(stores.map((client, index) => client.reserveContinuation(turn.bootstrapId, contenders[index]!)));
		expect(results.filter(Boolean)).toHaveLength(1);
		const winner = contenders[results.indexOf(true)]!;
		const restarted = new KurrentConversationComputerTurnStore(_Connect());
		await expect(restarted.reserveContinuation(turn.bootstrapId, winner)).resolves.toBe(false);
		const intent = await _PrepareConversationOutputIntent(turn, winner.invocationFence);
		await restarted.markOutput(turn.bootstrapId, intent);
		const restored = (await new KurrentConversationComputerTurnStore(_Connect()).load(turn.bootstrapId))!;
		expect(restored.toolSelection).toEqual(selection);
		expect(restored.continuationReservation).toEqual(winner);
		expect(restored.outputReceipt).toEqual(intent);
		await _Writer(_Connect(), restored).append(restored.outputReceipt!);
		expect(await _Outputs(history, intent)).toHaveLength(1);
	});

	it("persists the complete prepared answer and recovers it across fresh clients before and after append", async function ()
	{
		const first = _Connect();
		const turn = await _Freeze(first);
		const prepared = await _PrepareConversationOutputIntent(turn, randomUUID());
		await _ReserveConversationOutputFixture(new KurrentConversationComputerTurnStore(first), turn.bootstrapId, prepared.event.id);
		await new KurrentConversationComputerTurnStore(first).markOutput(turn.bootstrapId, prepared);
		expect(await _Outputs(first, prepared)).toEqual([]);

		const restarted = _Connect();
		const loaded = await new KurrentConversationComputerTurnStore(restarted).load(turn.bootstrapId);
		expect(loaded?.outputReceipt).toEqual(prepared);
		const appendFence = vi.fn().mockResolvedValue(undefined);
		await expect(_Writer(restarted, loaded!, appendFence).append(loaded!.outputReceipt!)).resolves.toEqual(prepared.event.data.entry);
		expect(appendFence).toHaveBeenCalledOnce();

		const restartedAgain = _Connect();
		const accepted = await new KurrentConversationComputerTurnStore(restartedAgain).load(turn.bootstrapId);
		const noNewAppend = vi.fn().mockRejectedValue(new Error("the original input head has advanced"));
		await expect(_Writer(restartedAgain, accepted!, noNewAppend).append(accepted!.outputReceipt!)).resolves.toEqual(prepared.event.data.entry);
		expect(noNewAppend).not.toHaveBeenCalled();
		const outputs = await _Outputs(restartedAgain, prepared);
		expect(outputs).toHaveLength(1);
		expect(outputs[0]).toMatchObject({ ...prepared.event, streamName: prepared.streamName, revision: 1n });
		expect(outputs[0]!.data).toEqual(prepared.event.data);
		expect(outputs[0]!.metadata).toEqual(prepared.event.metadata);
		const restartedStore = new KurrentConversationComputerTurnStore(restartedAgain);
		await restartedStore.settle(accepted!);
		const next = { ...turn, bootstrapId: randomUUID(), latestPendingEntryId: randomUUID() };
		await restartedStore.createOrRead(next);
		await restartedStore.settle(accepted!);
		expect((await restartedStore.loadActive(next))?.bootstrapId).toBe(next.bootstrapId);
	});

	it.each([false, true])("rejects a competing append after the empty read, including an event-ID alias: %s", async function (sameId)
	{
		const history = _Connect();
		const turn = await _Freeze(history);
		const intent = await _PrepareConversationOutputIntent(turn, randomUUID());
		await _ReserveConversationOutputFixture(new KurrentConversationComputerTurnStore(history), turn.bootstrapId, intent.event.id);
		await new KurrentConversationComputerTurnStore(history).markOutput(turn.bootstrapId, intent);
		const competing = { ...structuredClone(intent.event), id: sameId ? intent.event.id : randomUUID(), data: { entry: { ...intent.event.data.entry, occurredAt: "2026-09-09T00:01:00.000Z" } } };
		let intercepted = false;
		const boundary = {
			readStream: history.readStream.bind(history),
			append: async function _Race(command: HistoryAppend)
			{
				expect(intercepted).toBe(false);
				intercepted = true;
				await history.append({ ...command, events: [competing] });
				return history.append(command);
			},
		};
		await expect(_Writer(boundary, turn).append(intent)).rejects.toThrow("different history");
		expect(intercepted).toBe(true);
		const outputs = await _Outputs(history, intent);
		expect(outputs).toHaveLength(1);
		expect(outputs[0]).toMatchObject({ ...competing, revision: 1n });
	});
});
