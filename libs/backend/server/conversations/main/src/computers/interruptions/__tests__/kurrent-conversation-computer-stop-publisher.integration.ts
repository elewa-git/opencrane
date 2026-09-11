import { randomUUID } from "node:crypto";

import { KurrentDBClient } from "@kurrent/kurrentdb-client";
import { ConversationHistoryAuthority } from "@opencrane/backend/server/conversations/history";
import { _KurrentHistoryStore, type HistoryAppend, type HistoryAtomicAppend, type HistoryReadRequest } from "@opencrane/backend/server/infra/history-store";
import { afterAll, describe, expect, it } from "vitest";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { _ConversationComputerActiveTurnStreamName } from "../../lifecycle/conversation-computer-activity";
import { _ModelReservationFixture, _PrepareConversationOutputIntent, _ReserveConversationOutputFixture } from "../../turns/__tests__/conversation-output-intent.fixture";
import { KurrentConversationComputerTurnStore } from "../../turns/conversation-computer-turn-store";
import type { FrozenConversationComputerTurn } from "../../turns/conversation-computer-turn.types";
import { ConversationComputerStopAdmissionKinds, ConversationComputerStopDecisions, type ConversationComputerStopAdmission, type ConversationComputerStopCommand } from "../conversation-computer-stop.types";
import { KurrentConversationComputerStopPublisher } from "../kurrent-conversation-computer-stop-publisher";

const _URL = process.env["KURRENTDB_INTEGRATION_URL"];
const _DIGEST = `sha256:${"a".repeat(64)}` as const;

it.skipIf(_URL !== undefined)("skips live Stop arbitration proofs because KURRENTDB_INTEGRATION_URL is unset", function _Skipped()
{
	expect(_URL).toBeUndefined();
});

describe.skipIf(_URL === undefined)("conversation Stop arbitration against a live KurrentDB", function _Suite()
{
	const clients: KurrentDBClient[] = [];

	function _Connect(): _KurrentHistoryStore
	{
		const client = KurrentDBClient.connectionString(_URL ?? "");
		clients.push(client);
		return new _KurrentHistoryStore(client);
	}

	afterAll(async function _Disconnect() { await Promise.all(clients.map(client => client.dispose())); });

	async function _Fixture(history: _KurrentHistoryStore, selectTarget = true)
	{
		const siloId = `stop-${randomUUID()}`;
		const conversationId = randomUUID();
		const computerId = randomUUID();
		const bootstrapId = randomUUID();
		const runId = randomUUID();
		const leaseId = randomUUID();
		const messageId = randomUUID();
		const stopId = randomUUID();
		const authority = new ConversationHistoryAuthority(history);
		await history.append(authority.genesisAppend({ schemaVersion: 1, conversationId, siloId, mode: "direct", agentServiceId: null, createdByPrincipalId: "proof-principal", createdAt: "2026-09-11T08:00:00.000Z" }, randomUUID()));
		for (const [position, id, activation] of [["1", messageId, "none"], ["2", stopId, "stop"]] as const)
		{
			await authority.append({ siloId, conversationId, expectedRevision: BigInt(position) - 1n, entry: { schemaVersion: 1, id, conversationId, position, author: { kind: "human", principalId: "principal-1", participantId: "subject-1", issuer: "https://issuer.test", authenticatedAt: "2026-09-11T08:00:00.000Z", name: "Jente", avatarArtifactRevisionId: null }, provenance: "human-authored", visibility: { audience: "conversation" }, runId: null, causationId: id, correlationId: conversationId, idempotencyKey: id, occurredAt: "2026-09-11T08:00:00.000Z", attestation: null, kind: "message", state: "completed", blocks: [{ id: randomUUID(), kind: "text", payloadRef: randomUUID(), ciphertextDigest: _DIGEST }], replyToEntryId: null, addressedAgentIdentityId: null, activation } });
		}
		const turn: FrozenConversationComputerTurn = { bootstrapId, siloId, computerId, lease: { leaseId, leaseGeneration: 1, sandboxClaimId: `${computerId}-g1` }, latestPendingEntryId: messageId, latestPendingEntryPosition: "1", modelAlias: "proof-model", maximumBudgetUsd: 0.05, credentialLifetimeSeconds: 60, outputSourceCommandId: null, outputReceipt: null, cancellationReceipt: null, toolSelection: null, continuationReservation: null, modelReservation: null, binding: { siloId, conversationId, computerId, leaseGeneration: 1, agentIdentityId: randomUUID(), agentServiceId: randomUUID(), agentName: "Ada", agentAvatarArtifactRevisionId: null, runId, expectedRevision: 2n, maximumEntryBytes: 65_536 }, compile: { runId, attempt: 1, promptCompilerVersion: "proof-v1", digest: _DIGEST } };
		await new KurrentConversationComputerTurnStore(history).createOrRead(turn);
		const command: ConversationComputerStopCommand = { commandId: randomUUID(), siloId, conversationId, computerId, generation: 1, causationId: stopId, causationPosition: "2", requester: { principalId: "principal-1", subjectId: "subject-1", issuer: "https://issuer.test", authenticatedAt: "2026-09-11T08:00:00.000Z" } };
		const target = { bootstrapId, runId, attempt: 1, leaseId, leaseGeneration: 1 };
		const originalTurnTask = { taskId: randomUUID(), taskName: "conversation-computer-turn", idempotencyKey: bootstrapId };
		const admission: ConversationComputerStopAdmission = { kind: ConversationComputerStopAdmissionKinds.Target, command, commandDigest: ___DigestCanonicalJson({ command, target, originalTurnTask } as unknown as JsonValue), target, originalTurnTask, cancellationTask: { taskId: randomUUID(), taskName: "conversation-computer-stop", idempotencyKey: command.commandId }, requestedAt: "2026-09-11T08:00:00.000Z", authorizationDecisionDigest: _DIGEST };
		const activeTurnStreamName = _ConversationComputerActiveTurnStreamName({ siloId, computerId, lease: turn.lease });
		const selection = { kind: ConversationComputerStopAdmissionKinds.Target, command, commandDigest: admission.commandDigest, target, originalTurnTask, activeTurnStreamName, activeTurnExpectedRevision: "0", authorizationDecisionDigest: _DIGEST } as const;
		if (selectTarget)
			await new KurrentConversationComputerStopPublisher(history).select(command, selection);
		return { turn, command, admission, selection };
	}

	it("elects one terminal winner when final output and Stop reach the same turn revision", async function _Race()
	{
		const seed = _Connect();
		const fixture = await _Fixture(seed);
		const intent = await _PrepareConversationOutputIntent(fixture.turn, randomUUID());
		await _ReserveConversationOutputFixture(new KurrentConversationComputerTurnStore(seed), fixture.turn.bootstrapId, intent.event.id);
		let arrivals = 0;
		let release!: () => void;
		const barrier = new Promise<void>(resolve => { release = resolve; });
		function _RacingHistory()
		{
			const history = _Connect();
			return { ...history, append: history.append.bind(history), readHead: history.readHead.bind(history), readStream: history.readStream.bind(history), appendAtomic: async function _Append(command: HistoryAtomicAppend)
			{
				if (command.appends[0]?.streamName === `conversation-computer-turn-${fixture.turn.bootstrapId}` && command.appends[0].expectedRevision === 1n)
				{
					arrivals += 1;
					if (arrivals === 2)
						release();
					await barrier;
				}
				return history.appendAtomic(command);
			} };
		}
		const outputHistory = _RacingHistory();
		const stopHistory = _RacingHistory();
		const [outputResult, stopResult] = await Promise.allSettled([new KurrentConversationComputerTurnStore(outputHistory).markOutput(fixture.turn.bootstrapId, intent), new KurrentConversationComputerStopPublisher(stopHistory).publish(fixture.admission)]);
		expect(stopResult.status).toBe("fulfilled");
		if (stopResult.status !== "fulfilled")
			throw stopResult.reason;
		expect(stopResult.value.decision === ConversationComputerStopDecisions.CancellationWon || stopResult.value.decision === ConversationComputerStopDecisions.OutputWon).toBe(true);
		expect(outputResult.status === "fulfilled").toBe(stopResult.value.decision === ConversationComputerStopDecisions.OutputWon);
		const saved = await new KurrentConversationComputerTurnStore(_Connect()).load(fixture.turn.bootstrapId);
		expect(saved?.cancellationReceipt !== null).not.toBe(saved?.outputReceipt !== null);
	});

	it("recovers a lost cancellation acknowledgement without appending another receipt or log", async function _LostAck()
	{
		const history = _Connect();
		const fixture = await _Fixture(history);
		let loseResponse = true;
		const uncertain = { append: history.append.bind(history), readHead: history.readHead.bind(history), readStream: history.readStream.bind(history), appendAtomic: async function _Append(command: HistoryAtomicAppend)
		{
			const receipts = await history.appendAtomic(command);
			if (loseResponse)
			{
				loseResponse = false;
				throw new Error("simulated lost KurrentDB response");
			}
			return receipts;
		} };
		await expect(new KurrentConversationComputerStopPublisher(uncertain).publish(fixture.admission)).rejects.toThrow("simulated lost KurrentDB response");
		const recovered = await new KurrentConversationComputerStopPublisher(_Connect()).publish(fixture.admission);
		expect(recovered).toEqual({ decision: ConversationComputerStopDecisions.CancellationWon, published: false, outputReceiptDigest: null });
		const entries = [];
		for await (const event of _Connect().readStream({ streamName: `conversation-${fixture.command.conversationId}` }))
			entries.push(event);
		expect(entries.filter(event => event.type === "opencrane.conversation-entry.v1")).toHaveLength(3);
	});

	it("keeps the admitted target when intermediate turn and conversation appends win first", async function _IntermediateAppends()
	{
		const history = _Connect();
		const fixture = await _Fixture(history);
		let injected = false;
		const contended = { append: history.append.bind(history), readHead: history.readHead.bind(history), readStream: history.readStream.bind(history), appendAtomic: async function _Append(command: HistoryAtomicAppend)
		{
			if (!injected && command.appends[0]?.streamName === `conversation-computer-turn-${fixture.turn.bootstrapId}`)
			{
				injected = true;
				await new KurrentConversationComputerTurnStore(history).reserveModel(fixture.turn.bootstrapId, _ModelReservationFixture(fixture.turn, randomUUID()));
				const id = randomUUID();
				await new ConversationHistoryAuthority(history).append({ siloId: fixture.command.siloId, conversationId: fixture.command.conversationId, expectedRevision: 2n, entry: { schemaVersion: 1, id, conversationId: fixture.command.conversationId, position: "3", author: { kind: "human", principalId: "principal-1", participantId: "subject-1", issuer: "https://issuer.test", authenticatedAt: "2026-09-11T08:00:00.000Z", name: "Jente", avatarArtifactRevisionId: null }, provenance: "human-authored", visibility: { audience: "conversation" }, runId: null, causationId: id, correlationId: fixture.command.conversationId, idempotencyKey: id, occurredAt: "2026-09-11T08:00:01.000Z", attestation: null, kind: "message", state: "completed", blocks: [{ id: randomUUID(), kind: "text", payloadRef: randomUUID(), ciphertextDigest: _DIGEST }], replyToEntryId: null, addressedAgentIdentityId: null, activation: "none" } });
			}
			return history.appendAtomic(command);
		} };

		await expect(new KurrentConversationComputerStopPublisher(contended).publish(fixture.admission)).resolves.toEqual({ decision: ConversationComputerStopDecisions.CancellationWon, published: true, outputReceiptDigest: null });
		expect((await new KurrentConversationComputerTurnStore(_Connect()).load(fixture.turn.bootstrapId))?.cancellationReceipt?.commandId).toBe(fixture.command.commandId);
	});

	it("records and replays no-target only while its checked active pointer remains current", async function _NoTarget()
	{
		const history = _Connect();
		const fixture = await _Fixture(history);
		const turns = new KurrentConversationComputerTurnStore(history);
		await turns.settle(fixture.turn);
		const activeTurnStreamName = _ConversationComputerActiveTurnStreamName({ siloId: fixture.turn.siloId, computerId: fixture.turn.computerId, lease: fixture.turn.lease });
		const command = { ...fixture.command, commandId: randomUUID() };
		const commandDigest = ___DigestCanonicalJson({ command, activeTurnStreamName, activeTurnExpectedRevision: "1" } as unknown as JsonValue);
		const admission: ConversationComputerStopAdmission = { kind: ConversationComputerStopAdmissionKinds.NoTarget, command, commandDigest, authorizationDecisionDigest: _DIGEST, activeTurnStreamName, activeTurnExpectedRevision: "1" };
		const publisher = new KurrentConversationComputerStopPublisher(history);
		expect(await publisher.select(command, { kind: ConversationComputerStopAdmissionKinds.NoTarget, commandDigest, authorizationDecisionDigest: _DIGEST, activeTurnStreamName, activeTurnExpectedRevision: "1" })).toEqual(admission);
		expect(await new KurrentConversationComputerStopPublisher(_Connect()).publish(admission)).toEqual({ decision: ConversationComputerStopDecisions.NoTarget, published: false, outputReceiptDigest: null });
		const stale = { ...admission, command: { ...command, commandId: randomUUID() }, activeTurnExpectedRevision: "0" };
		expect(await publisher.select(stale.command, { kind: ConversationComputerStopAdmissionKinds.NoTarget, commandDigest: stale.commandDigest, authorizationDecisionDigest: stale.authorizationDecisionDigest, activeTurnStreamName, activeTurnExpectedRevision: "0" })).toBeNull();
	});

	it.each(["target-first", "settlement-first"] as const)("keeps one command selection when Target races active-pointer settlement: %s", async function _OverlappingSelections(order)
	{
		const history = _Connect();
		const fixture = await _Fixture(history, false);
		const receiptStreamName = `conversation-computer-stop-${fixture.command.commandId}`;
		const noTarget = { kind: ConversationComputerStopAdmissionKinds.NoTarget, commandDigest: ___DigestCanonicalJson({ command: fixture.command, activeTurnStreamName: fixture.selection.activeTurnStreamName, activeTurnExpectedRevision: "1" } as unknown as JsonValue), authorizationDecisionDigest: _DIGEST, activeTurnStreamName: fixture.selection.activeTurnStreamName, activeTurnExpectedRevision: "1" } as const;
		const targetArrived = _Deferred();
		const settlementArrived = _Deferred();
		const targetCommitted = _Deferred();
		const settlementCommitted = _Deferred();
		const noTargetCommitted = _Deferred();
		const targetClient = _Connect();
		const targetHistory =
		{
			...targetClient,
			append: targetClient.append.bind(targetClient),
			readHead: targetClient.readHead.bind(targetClient),
			readStream: async function* _Read(request: HistoryReadRequest)
			{
				if (request.streamName === receiptStreamName && order === "settlement-first")
					await noTargetCommitted.promise;
				for await (const event of targetClient.readStream(request))
					yield event;
			},
			appendAtomic: async function _Append(command: HistoryAtomicAppend)
			{
				targetArrived.resolve();
				await settlementArrived.promise;
				if (order === "settlement-first")
					await settlementCommitted.promise;
				try { return await targetClient.appendAtomic(command); }
				finally { targetCommitted.resolve(); }
			}
		};
		const settlementClient = _Connect();
		const settlementHistory =
		{
			...settlementClient,
			appendAtomic: settlementClient.appendAtomic.bind(settlementClient),
			readHead: settlementClient.readHead.bind(settlementClient),
			readStream: settlementClient.readStream.bind(settlementClient),
			append: async function _Append(command: HistoryAppend)
			{
				settlementArrived.resolve();
				await targetArrived.promise;
				if (order === "target-first")
					await targetCommitted.promise;
				const result = await settlementClient.append(command);
				settlementCommitted.resolve();
				return result;
			}
		};
		const targetSelection = new KurrentConversationComputerStopPublisher(targetHistory).select(fixture.command, fixture.selection);
		await new KurrentConversationComputerTurnStore(settlementHistory).settle(fixture.turn);
		let noTargetSelection;
		try { noTargetSelection = await new KurrentConversationComputerStopPublisher(_Connect()).select(fixture.command, noTarget); }
		finally { noTargetCommitted.resolve(); }
		const selectedTarget = await targetSelection;
		expect(selectedTarget).toEqual(noTargetSelection);
		const expectedKind = order === "target-first" ? ConversationComputerStopAdmissionKinds.Target : ConversationComputerStopAdmissionKinds.NoTarget;
		expect(noTargetSelection?.kind).toBe(expectedKind);
		const recoveredPublisher = new KurrentConversationComputerStopPublisher(_Connect());
		expect(await recoveredPublisher.recoverSelection(fixture.command)).toEqual(noTargetSelection);
		const events = [];
		for await (const event of _Connect().readStream({ streamName: receiptStreamName }))
			events.push(event);
		expect(events).toHaveLength(1);
		const outcome = await recoveredPublisher.recover(fixture.command);
		if (order === "target-first")
			expect(outcome).toBeNull();
		else
			expect(outcome?.decision).toBe(ConversationComputerStopDecisions.NoTarget);
	});
});

function _Deferred()
{
	let resolve!: () => void;
	const promise = new Promise<void>(done => { resolve = done; });
	return { promise, resolve };
}
