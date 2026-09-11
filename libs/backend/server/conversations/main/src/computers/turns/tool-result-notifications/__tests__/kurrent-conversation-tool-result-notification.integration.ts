import { randomUUID } from "node:crypto";

import { KurrentDBClient } from "@kurrent/kurrentdb-client";
import { ConversationHistoryAuthority, ConversationHistoryReader } from "@opencrane/backend/server/conversations/history";
import { _KurrentHistoryStore, type HistoryAtomicAppend, type HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ConversationToolResultNotificationOutcomes, type ConversationToolResultNotificationCommand, type ConversationToolResultNotificationEvidence } from "../conversation-tool-result-notification.types";
import { KurrentConversationToolResultNotificationPublisher } from "../kurrent-conversation-tool-result-notification";

/** Holds the explicit KurrentDB endpoint used only by the integration target. */
const _URL = process.env["KURRENTDB_INTEGRATION_URL"];

it.skipIf(_URL !== undefined)("skips live tool-result notification proofs because KURRENTDB_INTEGRATION_URL is unset", function ()
{
	expect(_URL).toBeUndefined();
});

describe.skipIf(_URL === undefined)("tool-result notifications against a live KurrentDB", function ()
{
	let client: KurrentDBClient;
	let store: _KurrentHistoryStore;

	beforeAll(function _Connect()
	{
		client = KurrentDBClient.connectionString(_URL ?? "");
		store = new _KurrentHistoryStore(client);
	});

	afterAll(async function _Disconnect()
	{
		await client.dispose();
	});

	it("recovers an atomically committed receipt after the append response is lost", async function _LostResponse()
	{
		const siloId = `proof-${randomUUID()}`;
		const conversationId = randomUUID();
		const toolInvocationId = randomUUID();
		const command: ConversationToolResultNotificationCommand = {
			bootstrapId: randomUUID(), siloId, conversationId, runId: randomUUID(), attempt: 1,
			toolInvocationId, expectedResultDigest: `sha256:${"a".repeat(64)}`,
		};
		const evidence: ConversationToolResultNotificationEvidence = {
			toolName: "records.read", toolKind: "mcp", outcome: "succeeded",
			resultDigest: command.expectedResultDigest, occurredAt: "2026-09-11T10:00:00.000Z",
		};
		const historyAuthority = new ConversationHistoryAuthority(store);
		await store.append(historyAuthority.genesisAppend({ schemaVersion: 1, conversationId, siloId, mode: "agent_session", agentServiceId: randomUUID(), createdByPrincipalId: randomUUID(), createdAt: "2026-09-11T09:00:00.000Z" }, randomUUID()));

		let loseFirstResponse = true;
		const uncertainStore = {
			append: store.append.bind(store),
			appendAtomic: async function _AppendThenLoseResponse(append: HistoryAtomicAppend)
			{
				const receipt = await store.appendAtomic(append);
				if (loseFirstResponse)
				{
					loseFirstResponse = false;
					throw new Error("simulated lost append response");
				}
				return receipt;
			},
			readHead: store.readHead.bind(store),
			readStream: store.readStream.bind(store),
		};
		const currentEvidence = { readCurrent: vi.fn().mockResolvedValue(evidence) };
		const publisher = new KurrentConversationToolResultNotificationPublisher(currentEvidence, new ConversationHistoryAuthority(uncertainStore), new ConversationHistoryReader(uncertainStore), uncertainStore);

		await expect(publisher.publishTerminal(command)).rejects.toThrow("simulated lost append response");
		await expect(publisher.publishTerminal(command)).resolves.toBe(ConversationToolResultNotificationOutcomes.Published);

		const conversationEvents: HistoryRecordedEvent[] = [];
		for await (const event of store.readStream({ streamName: `conversation-${conversationId}`, fromRevision: 0n }))
			conversationEvents.push(event);
		const receiptEvents: HistoryRecordedEvent[] = [];
		for await (const event of store.readStream({ streamName: `conversation-tool-result-notification-${toolInvocationId}`, fromRevision: 0n }))
			receiptEvents.push(event);

		expect(conversationEvents).toHaveLength(2);
		expect(conversationEvents[1]?.data["entry"]).toMatchObject({ logKind: "tool_call", toolCallId: toolInvocationId, phase: "completed", toolName: "records.read" });
		expect(receiptEvents).toHaveLength(1);
		expect(currentEvidence.readCurrent).toHaveBeenCalledTimes(1);
	});
});
