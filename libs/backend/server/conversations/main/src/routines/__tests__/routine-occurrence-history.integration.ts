import { randomUUID } from "node:crypto";

import { KurrentDBClient } from "@kurrent/kurrentdb-client";
import { ConversationAuthorKinds, ConversationComputerStates, ConversationEntryProvenance, ConversationMessageActivations } from "@opencrane/contracts";
import { HistoryExpectedRevisions, _KurrentHistoryStore, type HistoryAtomicAppend, type HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";
import { ConversationHistoryAuthority } from "@opencrane/backend/server/conversations/history";
import { RoutineFiringTrigger } from "@opencrane/models/agents";
import { ConversationGenesisOriginKinds } from "@opencrane/models/conversations";
import { afterAll, describe, expect, it } from "vitest";

import { RoutineOccurrenceHistory } from "../routine-occurrence-history";
import type { RoutineOccurrenceHistoryRecord } from "../routine-occurrence-history.types";

/** Names the explicit live KurrentDB opt-in used by this suite. */
const _URL = process.env["KURRENTDB_INTEGRATION_URL"];
/** Uses a valid content-addressed profile revision for the cold computer snapshot. */
const _PROFILE_REVISION = `sha256:${"b".repeat(64)}`;

/** Connects one isolated KurrentDB client and retains it for suite cleanup. */
function _Connections(): { readonly connect: () => _KurrentHistoryStore; readonly clients: KurrentDBClient[] }
{
	const clients: KurrentDBClient[] = [];
	return {
		clients,
		connect: function _Connect(): _KurrentHistoryStore
		{
			const client = KurrentDBClient.connectionString(_URL ?? "");
			clients.push(client);
			return new _KurrentHistoryStore(client);
		},
	};
}

/** Builds one fresh occurrence record with immutable coordinates that cannot collide across runs. */
function _Record(): RoutineOccurrenceHistoryRecord
{
	const suffix = randomUUID();
	const conversationId = `occurrence-conversation-${suffix}`;
	return {
		siloId: `silo-${suffix}`,
		conversationId,
		origin: { kind: ConversationGenesisOriginKinds.RoutineOccurrence, routineId: `routine-${suffix}`, routineRevision: 2, firingId: `firing-${suffix}`, destinationConversationId: `destination-${suffix}`, trigger: RoutineFiringTrigger.Automatic, scheduledSlot: "2026-09-25T10:00:00.000Z" },
		agentServiceId: `service-${suffix}`,
		requesterPrincipalId: `principal-${suffix}`,
		requesterIssuer: "https://issuer.example",
		requesterSubjectId: `subject-${suffix}`,
		requesterAuthenticatedAt: "2026-09-24T12:00:00.000Z",
		task: { taskId: `task-${suffix}`, taskName: "agents.routines.occurrence/v1", idempotencyKey: `occurrence-${suffix}` },
		audiencePrincipalIds: [`principal-${suffix}`, `audience-${suffix}`],
		computerId: `computer-${suffix}`,
		agentIdentityId: `agent-identity-${suffix}`,
		profileRevisionId: _PROFILE_REVISION,
		createdAt: "2026-09-25T10:00:01.000Z",
		payloadRef: `conversation-private://routine-instruction-${suffix}`,
		ciphertextDigest: `sha256:${"c".repeat(64)}`,
	};
}

/** Reads one complete stream through the public HistoryStore adapter. */
async function _Collect(store: _KurrentHistoryStore, streamName: string): Promise<HistoryRecordedEvent[]>
{
	const events: HistoryRecordedEvent[] = [];
	for await (const event of store.readStream({ streamName, fromRevision: 0n }))
		events.push(event);
	return events;
}

/** Builds a harmless existing event that occupies a stream before the atomic preparation attempt. */
function _ConflictEvent(): { readonly id: string; readonly type: string; readonly data: Record<string, unknown>; readonly metadata: Record<string, unknown> }
{
	return { id: randomUUID(), type: "opencrane.integration-conflict.v1", data: { conflict: true }, metadata: {} };
}

it.skipIf(_URL !== undefined)("skips routine occurrence KurrentDB proofs because KURRENTDB_INTEGRATION_URL is unset", function _Skipped()
{
	expect(_URL).toBeUndefined();
});

describe.skipIf(_URL === undefined)("routine occurrence history against a live KurrentDB", function _Suite()
{
	const connections = _Connections();

	afterAll(async function _Disconnect()
	{
		await Promise.all(connections.clients.map(function _Dispose(client) { return client.dispose(); }));
	});

	it("atomically appends the ordered conversation, cold computer, and receipt streams", async function _FreshAppend()
	{
		const record = _Record();
		const store = connections.connect();
		const history = new RoutineOccurrenceHistory(store, new ConversationHistoryAuthority(store));
		const receipt = await history.establish(record);
		const conversation = await _Collect(store, `conversation-${record.conversationId}`);
		const computer = await _Collect(store, `conversation-computer-${record.computerId}`);
		const instructionReceipt = await _Collect(store, `routine-occurrence-instruction-${record.conversationId}`);

		expect(receipt.historyReference).toBe(`routine-occurrence-instruction-${record.conversationId}`);
		expect(conversation.map(function _Coordinates(event) { return [event.revision, event.type]; })).toEqual([[0n, "opencrane.conversation-created.v1"], [1n, "opencrane.conversation-entry.v1"]]);
		expect(computer).toHaveLength(1);
		expect(computer[0]).toMatchObject({ revision: 0n, type: "opencrane.conversation-computer.v1", data: { computer: { state: ConversationComputerStates.Cold, profileRevisionId: _PROFILE_REVISION }, lease: null } });
		expect(instructionReceipt).toHaveLength(1);
		expect(instructionReceipt[0]).toMatchObject({ revision: 0n, type: "opencrane.routine-occurrence-instruction.v1", data: { record } });
		const entry = conversation[1]?.data["entry"] as Record<string, unknown>;
		expect(entry).toMatchObject({ provenance: ConversationEntryProvenance.ServiceAttested, activation: ConversationMessageActivations.None });
		expect(entry["author"]).toMatchObject({ kind: ConversationAuthorKinds.Service, serviceId: "opencrane" });
		expect(entry["author"]).not.toHaveProperty("principalId");
	});

	it("recovers a committed three-stream append after its response is lost without duplicates", async function _LostResponse()
	{
		const record = _Record();
		const store = connections.connect();
		let appendCount = 0;
		const uncertainStore = {
			append: store.append.bind(store),
			appendAtomic: async function _Append(command: HistoryAtomicAppend)
			{
				appendCount += 1;
				const receipts = await store.appendAtomic(command);
				if (appendCount === 1)
					throw new Error("simulated lost KurrentDB response");
				return receipts;
			},
			readHead: store.readHead.bind(store),
			readStream: store.readStream.bind(store),
		};
		const history = new RoutineOccurrenceHistory(uncertainStore, new ConversationHistoryAuthority(uncertainStore));

		await expect(history.establish(record)).rejects.toThrow("simulated lost KurrentDB response");
		await expect(history.establish(record)).resolves.toMatchObject({ historyReference: `routine-occurrence-instruction-${record.conversationId}` });
		expect(appendCount).toBe(1);
		expect(await _Collect(store, `conversation-${record.conversationId}`)).toHaveLength(2);
		expect(await _Collect(store, `conversation-computer-${record.computerId}`)).toHaveLength(1);
		expect(await _Collect(store, `routine-occurrence-instruction-${record.conversationId}`)).toHaveLength(1);
	});

	it("rolls back the conversation and receipt when the cold computer stream already exists", async function _AtomicConflict()
	{
		const record = _Record();
		const store = connections.connect();
		const computerStream = `conversation-computer-${record.computerId}`;
		await store.append({ streamName: computerStream, expectedRevision: HistoryExpectedRevisions.NoStream, events: [_ConflictEvent()] });
		const history = new RoutineOccurrenceHistory(store, new ConversationHistoryAuthority(store));

		await expect(history.establish(record)).rejects.toThrow("did not commit its complete preparation");
		expect(await _Collect(store, `conversation-${record.conversationId}`)).toHaveLength(0);
		expect(await _Collect(store, `routine-occurrence-instruction-${record.conversationId}`)).toHaveLength(0);
		expect(await _Collect(store, computerStream)).toHaveLength(1);
	});
});
