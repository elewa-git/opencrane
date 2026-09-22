import { ConversationEntryKinds, ConversationModelToolModes } from "@opencrane/contracts";
import { _ConversationComputerTurnHistoryDigest, _InitialConversationComputerTurnProtocol } from "../conversation-computer-turn-protocol";
import { _ConversationModelRequestDigest } from "../conversation-computer-model-reservation";
import { _ModelReservationFixture, _PrepareConversationOutputIntent, _PreparePairedConversationOutputIntent, _ReserveConversationOutputFixture } from "./conversation-output-intent.fixture";
import { randomUUID } from "node:crypto";

import { KurrentDBClient } from "@kurrent/kurrentdb-client";
import { _KurrentHistoryStore, type HistoryAppend, type HistoryAtomicAppend, type HistoryRecordedEvent, type HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { afterAll, describe, expect, it, vi } from "vitest";

import { BoundConversationWriter } from "@opencrane/backend/server/conversations/history";
import type { BoundConversationWriterIntent } from "@opencrane/backend/server/conversations/history";
import { ConversationHistoryAuthority } from "@opencrane/backend/server/conversations/history";
import { ConversationComputerOutputPositionConflictError, KurrentConversationComputerTurnStore } from "../conversation-computer-turn-store";
import type { FrozenConversationComputerTurn } from "../conversation-computer-turn.types";
import { ConversationComputerTurnProtocolStates, type ConversationComputerTurnOutputReceipt } from "../conversation-computer-turn-protocol.types";
import { _ConversationComputerOutputIntents } from "../output/conversation-computer-output-receipt";

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
			latestPendingEntryPosition: "1",
			credentialLifetimeSeconds: 60, budget: { maxModelTurns: 3, maxCompletionTokens: 300, maxCostUsdMicros: null, maxToolInvocations: 2, maxLoopIterations: 2, wallClockDeadlineEpochMs: Date.parse("2099-01-01T00:00:00Z") }, protocol: _InitialConversationComputerTurnProtocol(),
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

	/** Read both saved entries through separate real writers whose recovery clocks cannot run. */
	async function _confirmPair(history: _KurrentHistoryStore, turn: FrozenConversationComputerTurn, receipt: ConversationComputerTurnOutputReceipt)
	{
		const intents = _ConversationComputerOutputIntents(receipt);
		expect(intents).toHaveLength(2);
		for (const intent of intents)
		{
			const binding = { ...turn.binding, expectedRevision: BigInt(intent.expectedRevision) };
			await expect(_Writer(history, { ...turn, binding }).confirm(intent)).resolves.toEqual(intent.event.data.entry);
		}
		const outputs = await _Outputs(history, receipt);
		expect(outputs).toHaveLength(2);
		expect(outputs.map(event => event.revision)).toEqual([1n, 2n]);
		expect(outputs.map(event => event.data["entry"])).toEqual(intents.map(intent => intent.event.data.entry));
		expect(intents.map(intent => intent.event.data.entry.kind)).toEqual([ConversationEntryKinds.Message, ConversationEntryKinds.A2UI]);
		for (const [index, intent] of intents.entries())
			expect(outputs[index]).toMatchObject({ ...intent.event, streamName: intent.streamName });
		return outputs;
	}

	/** Hold two independent clients until both decision appends reach the same expected revision. */
	function _RacingStores(expectedRevision = 0n)
	{
		let arrivals = 0;
		let release!: () => void;
		const barrier = new Promise<void>(resolve => { release = resolve; });
		async function _Race<T>(revision: HistoryAppend["expectedRevision"], write: () => Promise<T>): Promise<T>
		{
			expect(revision).toBe(expectedRevision);
			arrivals += 1;
			if (arrivals === 2)
				release();
			await barrier;
			return write();
		}
		return [0, 1].map(function _Client()
		{
			const history = _Connect();
			return new KurrentConversationComputerTurnStore({
				readStream: history.readStream.bind(history),
				appendAtomic: async function _AtSameAtomicRevision(command: HistoryAtomicAppend)
				{
					return _Race(command.appends[0]!.expectedRevision, async function _AtomicWrite() { return history.appendAtomic(command); });
				},
				append: async function _AtSameRevision(command: HistoryAppend)
				{
					return _Race(command.expectedRevision, async function _Write() { return history.append(command); });
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
		expect((await restarted.load(turn.bootstrapId))?.protocol.steps[0]?.reservation).toEqual(winner);
		await expect(restarted.reserveModel(turn.bootstrapId, winner)).resolves.toBe(false);
		await expect(restarted.reserveModel(turn.bootstrapId, _ModelReservationFixture(turn, randomUUID()))).resolves.toBe(false);
	});

	it("elects either a direct answer or saved tool declaration at the same live revision", async function ()
	{
		const history = _Connect();
		const turn = await _Freeze(history);
		const first = _ModelReservationFixture(turn, randomUUID(), ConversationModelToolModes.Select);
		await new KurrentConversationComputerTurnStore(history).reserveModel(turn.bootstrapId, first);
		const proposalId = randomUUID();
		const tool = { ordinal: first.ordinal, modelInvocationFence: first.invocationFence, proposalId, toolInvocationId: proposalId, requestFingerprint: `sha256:${"b".repeat(64)}`, declaration: { payloadRef: randomUUID(), ciphertextDigest: `sha256:${"c".repeat(64)}` } };
		const answer = await _PrepareConversationOutputIntent(turn, first.invocationFence);
		const [answerStore, toolStore] = _RacingStores(1n);
		const results = await Promise.allSettled([answerStore!.markOutput(turn.bootstrapId, answer), toolStore!.selectTool(turn.bootstrapId, tool)]);
		expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
		const winner = (await new KurrentConversationComputerTurnStore(_Connect()).load(turn.bootstrapId))!;
		expect(winner.protocol.output !== null).not.toBe(winner.protocol.steps[0]?.selection !== null);
	});

	it("reserves one post-tool request and recovers its final answer across independent clients", async function ()
	{
		const history = _Connect();
		const turn = await _Freeze(history);
		const store = new KurrentConversationComputerTurnStore(history);
		const first = _ModelReservationFixture(turn, randomUUID(), ConversationModelToolModes.Select);
		await store.reserveModel(turn.bootstrapId, first);
		const proposalId = randomUUID();
		const selection = { ordinal: first.ordinal, modelInvocationFence: first.invocationFence, proposalId, toolInvocationId: proposalId, requestFingerprint: `sha256:${"b".repeat(64)}`, declaration: { payloadRef: randomUUID(), ciphertextDigest: `sha256:${"c".repeat(64)}` } };
		await store.selectTool(turn.bootstrapId, selection);
		await store.recordToolResult(turn.bootstrapId, { ordinal: first.ordinal, proposalId, toolInvocationId: proposalId, resultDigest: `sha256:${"e".repeat(64)}`, exchange: { payloadRef: randomUUID(), ciphertextDigest: `sha256:${"d".repeat(64)}` }, authorityExpiresAtEpochMs: first.authorityExpiresAtEpochMs });
		const selected = (await store.load(turn.bootstrapId))!;
		const facts = { ordinal: 2, tools: ConversationModelToolModes.None, compiledInputDigest: turn.compile.digest, historyDigest: _ConversationComputerTurnHistoryDigest(selected.protocol.steps), maxCompletionTokens: 50, authorityExpiresAtEpochMs: first.authorityExpiresAtEpochMs, dispatchDeadlineEpochMs: first.dispatchDeadlineEpochMs };
		const contenders = [0, 1].map(() => ({ ...facts, invocationFence: randomUUID(), requestDigest: _ConversationModelRequestDigest(selected, facts) }));
		const stores = _RacingStores(3n);
		const results = await Promise.all(stores.map((client, index) => client.reserveModel(turn.bootstrapId, contenders[index]!)));
		expect(results.filter(Boolean)).toHaveLength(1);
		const winner = contenders[results.indexOf(true)]!;
		const restarted = new KurrentConversationComputerTurnStore(_Connect());
		await expect(restarted.reserveModel(turn.bootstrapId, winner)).resolves.toBe(false);
		const intent = await _PrepareConversationOutputIntent(turn, winner.invocationFence);
		await restarted.markOutput(turn.bootstrapId, intent);
		const restored = (await new KurrentConversationComputerTurnStore(_Connect()).load(turn.bootstrapId))!;
		expect(restored.protocol.steps[0]?.selection).toEqual(selection);
		expect(restored.protocol.steps[1]?.reservation).toEqual(winner);
		expect(restored.protocol.output?.receipt).toEqual(intent);
		const restoredIntents = _ConversationComputerOutputIntents(restored.protocol.output!.receipt);
		expect(restoredIntents).toHaveLength(1);
		await _Writer(_Connect(), restored).confirm(restoredIntents[0]!);
		expect(await _Outputs(history, intent)).toHaveLength(1);
	});

	it("persists the complete answer atomically and recovers it across fresh clients", async function ()
	{
		const first = _Connect();
		const turn = await _Freeze(first);
		const prepared = await _PrepareConversationOutputIntent(turn, randomUUID());
		await _ReserveConversationOutputFixture(new KurrentConversationComputerTurnStore(first), turn.bootstrapId, prepared.event.id);
		await new KurrentConversationComputerTurnStore(first).markOutput(turn.bootstrapId, prepared);
		expect(await _Outputs(first, prepared)).toHaveLength(1);

		const restarted = _Connect();
		const loaded = await new KurrentConversationComputerTurnStore(restarted).load(turn.bootstrapId);
		expect(loaded?.protocol.output?.receipt).toEqual(prepared);
		const appendFence = vi.fn().mockResolvedValue(undefined);
		const loadedIntents = _ConversationComputerOutputIntents(loaded!.protocol.output!.receipt);
		expect(loadedIntents).toHaveLength(1);
		await expect(_Writer(restarted, loaded!, appendFence).confirm(loadedIntents[0]!)).resolves.toEqual(prepared.event.data.entry);
		expect(appendFence).not.toHaveBeenCalled();

		const restartedAgain = _Connect();
		const accepted = await new KurrentConversationComputerTurnStore(restartedAgain).load(turn.bootstrapId);
		const noNewAppend = vi.fn().mockRejectedValue(new Error("the original input head has advanced"));
		const acceptedIntents = _ConversationComputerOutputIntents(accepted!.protocol.output!.receipt);
		expect(acceptedIntents).toHaveLength(1);
		await expect(_Writer(restartedAgain, accepted!, noNewAppend).confirm(acceptedIntents[0]!)).resolves.toEqual(prepared.event.data.entry);
		expect(noNewAppend).not.toHaveBeenCalled();
		const outputs = await _Outputs(restartedAgain, prepared);
		expect(outputs).toHaveLength(1);
		expect(outputs[0]).toMatchObject({ ...prepared.event, streamName: prepared.streamName, revision: 1n });
		expect(outputs[0]!.data).toEqual(prepared.event.data);
		expect(outputs[0]!.metadata).toEqual(prepared.event.metadata);
		const restartedStore = new KurrentConversationComputerTurnStore(restartedAgain);
		await restartedStore.settle(accepted!);
		const next = { ...turn, bootstrapId: randomUUID(), latestPendingEntryId: randomUUID(), latestPendingEntryPosition: "2" };
		await restartedStore.createOrRead(next);
		await restartedStore.settle(accepted!);
		expect((await restartedStore.loadActive(next))?.bootstrapId).toBe(next.bootstrapId);
	});

	it("rejects a stale output position without saving a turn receipt", async function _StaleOutputPosition()
	{
		const history = _Connect();
		const turn = await _Freeze(history);
		const intent = await _PrepareConversationOutputIntent(turn, randomUUID());
		await _ReserveConversationOutputFixture(new KurrentConversationComputerTurnStore(history), turn.bootstrapId, intent.event.id);
		await history.append({ streamName: intent.streamName, expectedRevision: turn.binding.expectedRevision, events: [{ ...intent.event, id: randomUUID() }] });
		await expect(new KurrentConversationComputerTurnStore(history).markOutput(turn.bootstrapId, intent)).rejects.toBeInstanceOf(ConversationComputerOutputPositionConflictError);
		expect((await new KurrentConversationComputerTurnStore(_Connect()).load(turn.bootstrapId))?.protocol.output).toBeNull();
	});

	it("commits adjacent answer and display entries with one decision and retries without restamping", async function _pairedOutputRestart()
	{
		const history = _Connect();
		const turn = await _Freeze(history);
		const receipt = await _PreparePairedConversationOutputIntent(turn, randomUUID());
		const store = new KurrentConversationComputerTurnStore(history);
		await _ReserveConversationOutputFixture(store, turn.bootstrapId, receipt.event.id);
		await expect(store.markOutput(turn.bootstrapId, receipt)).resolves.toEqual({ outcome: "accepted", receipt });
		const saved = await _confirmPair(history, turn, receipt);

		const restarted = _Connect();
		const restartedStore = new KurrentConversationComputerTurnStore(restarted);
		const loaded = (await restartedStore.load(turn.bootstrapId))!;
		expect(loaded.protocol).toMatchObject({ state: ConversationComputerTurnProtocolStates.OutputRecorded, revision: 2n, output: { sourceCommandId: receipt.event.id, receipt } });
		await expect(restartedStore.markOutput(turn.bootstrapId, receipt)).resolves.toEqual({ outcome: "idempotent", receipt });
		expect(await _confirmPair(restarted, loaded, loaded.protocol.output!.receipt)).toEqual(saved);
		expect(await new KurrentConversationComputerTurnStore(_Connect()).load(turn.bootstrapId)).toEqual(loaded);
	});

	it("recovers the complete pair after the real atomic append commits but its acknowledgement is lost", async function _pairedLostAcknowledgement()
	{
		const history = _Connect();
		const turn = await _Freeze(history);
		const receipt = await _PreparePairedConversationOutputIntent(turn, randomUUID());
		await _ReserveConversationOutputFixture(new KurrentConversationComputerTurnStore(history), turn.bootstrapId, receipt.event.id);
		let committed = 0;
		const interruptedStore = new KurrentConversationComputerTurnStore({
			readStream: history.readStream.bind(history), append: history.append.bind(history),
			appendAtomic: async function _loseAfterCommit(command)
			{
				expect(command.appends.map(append => append.events.length)).toEqual([1, 2]);
				await history.appendAtomic(command);
				committed += 1;
				throw new Error("paired output acknowledgement lost after server commit");
			},
		});
		await expect(interruptedStore.markOutput(turn.bootstrapId, receipt)).rejects.toThrow("paired output acknowledgement lost after server commit");
		expect(committed).toBe(1);

		const restarted = _Connect();
		const store = new KurrentConversationComputerTurnStore(restarted);
		const loaded = (await store.load(turn.bootstrapId))!;
		expect(loaded.protocol).toMatchObject({ state: ConversationComputerTurnProtocolStates.OutputRecorded, revision: 2n, output: { sourceCommandId: receipt.event.id, receipt } });
		const saved = await _confirmPair(restarted, loaded, loaded.protocol.output!.receipt);
		await expect(store.markOutput(turn.bootstrapId, receipt)).resolves.toEqual({ outcome: "idempotent", receipt });
		expect(await _confirmPair(_Connect(), loaded, receipt)).toEqual(saved);
		expect(await new KurrentConversationComputerTurnStore(_Connect()).load(turn.bootstrapId)).toEqual(loaded);
	});

	it("saves neither half of a stale pair nor its output decision", async function _stalePairedOutput()
	{
		const history = _Connect();
		const turn = await _Freeze(history);
		const receipt = await _PreparePairedConversationOutputIntent(turn, randomUUID());
		const store = new KurrentConversationComputerTurnStore(history);
		const reserved = await _ReserveConversationOutputFixture(store, turn.bootstrapId, receipt.event.id);
		const interloper = await _PrepareConversationOutputIntent(turn, randomUUID(), "other-answer-payload");
		await history.append({ streamName: interloper.streamName, expectedRevision: turn.binding.expectedRevision, events: [interloper.event] });
		const before = await _Outputs(history, receipt);
		expect(before).toHaveLength(1);
		await expect(store.markOutput(turn.bootstrapId, receipt)).rejects.toBeInstanceOf(ConversationComputerOutputPositionConflictError);
		const restarted = _Connect();
		expect(await _Outputs(restarted, receipt)).toEqual(before);
		expect(await new KurrentConversationComputerTurnStore(restarted).load(turn.bootstrapId)).toEqual(reserved);
		expect(reserved.protocol.output).toBeNull();
	});

	it.each(["changed payload", "removed display"])("rejects a companion retry with %s while preserving the committed pair", async function _changedPairedOutput(change)
	{
		const history = _Connect();
		const turn = await _Freeze(history);
		const receipt = await _PreparePairedConversationOutputIntent(turn, randomUUID());
		const store = new KurrentConversationComputerTurnStore(history);
		await _ReserveConversationOutputFixture(store, turn.bootstrapId, receipt.event.id);
		await store.markOutput(turn.bootstrapId, receipt);
		const saved = await _confirmPair(history, turn, receipt);
		const loaded = (await store.load(turn.bootstrapId))!;
		const changed = change === "removed display" ? { ...receipt, display: null } : await _PreparePairedConversationOutputIntent(turn, receipt.event.id, "changed-display-payload");
		const restarted = _Connect();
		const restartedStore = new KurrentConversationComputerTurnStore(restarted);
		await expect(restartedStore.markOutput(turn.bootstrapId, changed)).rejects.toThrow("already has a different output");
		expect(await _confirmPair(restarted, loaded, receipt)).toEqual(saved);
		expect(await restartedStore.load(turn.bootstrapId)).toEqual(loaded);
		await expect(restartedStore.markOutput(turn.bootstrapId, receipt)).resolves.toEqual({ outcome: "idempotent", receipt });
		expect(await _Outputs(_Connect(), receipt)).toEqual(saved);
	});
});
