import { randomUUID } from "node:crypto";

import { KurrentDBClient } from "@kurrent/kurrentdb-client";
import { ConversationHistoryAuthority, ConversationHistoryReader } from "@opencrane/backend/server/conversations/history";
import { _KurrentHistoryStore, type HistoryAtomicAppend, type HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { KurrentConversationToolResultNotificationPublisher } from "../../tool-result-notifications/kurrent-conversation-tool-result-notification";
import { KurrentConversationToolRequestedNotificationPublisher, KurrentConversationToolRunningNotificationPublisher } from "../kurrent-conversation-tool-progress-notification";
import { ConversationToolProgressNotificationOutcomes, type ConversationToolProgressNotificationEvidence, type ConversationToolRequestedNotificationCommand, type ConversationToolRunningNotificationCommand } from "../conversation-tool-progress-notification.types";

vi.mock("@opencrane/backend/server/iam/authorization", function _ToolOutcomes()
{
	return { ToolResultDeliveryOutcomes: { Succeeded: "succeeded", Failed: "failed" } };
});

/** Holds the explicit KurrentDB endpoint used only by the integration target. */
const _URL = process.env["KURRENTDB_INTEGRATION_URL"];

it.skipIf(_URL !== undefined)("skips live tool-progress proofs because KURRENTDB_INTEGRATION_URL is unset", function ()
{
	expect(_URL).toBeUndefined();
});

describe.skipIf(_URL === undefined)("tool progress against a live KurrentDB", function ()
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

	it("recovers a requested receipt after the atomic append response is lost", async function _LostResponse()
	{
		const fixture = await _Fixture(store);
		let loseFirstResponse = true;
		const uncertain = {
			append: store.append.bind(store), readHead: store.readHead.bind(store), readStream: store.readStream.bind(store),
			appendAtomic: async function _AppendThenLoseResponse(append: HistoryAtomicAppend)
			{
				const receipt = await store.appendAtomic(append);
				if (loseFirstResponse)
				{
					loseFirstResponse = false;
					throw new Error("simulated lost progress append response");
				}
				return receipt;
			},
		};
		const publisher = new KurrentConversationToolRequestedNotificationPublisher({ readCurrent: vi.fn().mockResolvedValue(fixture.evidence) }, new ConversationHistoryAuthority(uncertain), new ConversationHistoryReader(uncertain), uncertain);
		await expect(publisher.publishRequested(fixture.requested)).resolves.toBe(ConversationToolProgressNotificationOutcomes.Published);
		await expect(_Events(store, `conversation-${fixture.requested.conversationId}`)).resolves.toHaveLength(2);
		await expect(_Events(store, `conversation-tool-progress-requested-${fixture.requested.toolInvocationId}`)).resolves.toHaveLength(1);
	});

	it("orders competing requested and running writers before the terminal result", async function _OrderedWriters()
	{
		const fixture = await _Fixture(store);
		const authority = new ConversationHistoryAuthority(store);
		const reader = new ConversationHistoryReader(store);
		const requested = new KurrentConversationToolRequestedNotificationPublisher({ readCurrent: vi.fn().mockResolvedValue(fixture.evidence) }, authority, reader, store);
		const running = new KurrentConversationToolRunningNotificationPublisher({ readCurrent: vi.fn().mockResolvedValue(fixture.evidence) }, authority, reader, store);
		await expect(Promise.all([requested.publishRequested(fixture.requested), running.publishRunning(fixture.running)])).resolves.toEqual([ConversationToolProgressNotificationOutcomes.Published, ConversationToolProgressNotificationOutcomes.Published]);
		const terminal = new KurrentConversationToolResultNotificationPublisher({ readCurrent: vi.fn().mockResolvedValue({ toolName: fixture.evidence.toolName, toolKind: "mcp", outcome: "succeeded", resultDigest: `sha256:${"b".repeat(64)}`, occurredAt: "2026-09-11T10:01:00.000Z" }) }, authority, reader, store);
		await terminal.publishTerminal({ ...fixture.requested, expectedResultDigest: `sha256:${"b".repeat(64)}` });
		const events = await _Events(store, `conversation-${fixture.requested.conversationId}`);
		expect(events.slice(1).map(event => (event.data["entry"] as { readonly phase: string }).phase)).toEqual(["requested", "running", "completed"]);
		for (const phase of ["requested", "running"])
			await expect(_Events(store, `conversation-tool-progress-${phase}-${fixture.requested.toolInvocationId}`)).resolves.toHaveLength(1);
	});
});

/** Create unique real-store coordinates and immutable evidence for one integration case. */
async function _Fixture(store: _KurrentHistoryStore)
{
	const siloId = `proof-${randomUUID()}`;
	const conversationId = randomUUID();
	const toolInvocationId = randomUUID();
	const requested: ConversationToolRequestedNotificationCommand = { bootstrapId: randomUUID(), siloId, conversationId, runId: randomUUID(), attempt: 1, toolInvocationId };
	const evidence: ConversationToolProgressNotificationEvidence = { ...requested, toolName: "records.read", toolKind: "mcp", occurredAt: "2026-09-11T10:00:00.000Z" };
	const running: ConversationToolRunningNotificationCommand = { executionId: randomUUID(), companionClaimFence: randomUUID(), invocationId: randomUUID(), siloId, conversationId, runId: requested.runId, attempt: 1, toolInvocationId, requestIdentity: { runtimeInstanceId: randomUUID(), commandId: requested.bootstrapId, candidateId: toolInvocationId }, toolClaim: { invocationId: "unused", kind: "dispatch" as ConversationToolRunningNotificationCommand["toolClaim"]["kind"], fence: 1, revision: 1 }, workload: { audience: "mcp-executor", namespace: "mcp-executor", serviceAccountName: "mcp-executor", workloadKind: "job", workloadUid: randomUUID(), podUid: randomUUID() } };
	const exactRunning = { ...running, toolClaim: { ...running.toolClaim, invocationId: running.invocationId } };
	const authority = new ConversationHistoryAuthority(store);
	await store.append(authority.genesisAppend({ schemaVersion: 1, conversationId, siloId, mode: "agent_session", agentServiceId: randomUUID(), createdByPrincipalId: randomUUID(), createdAt: "2026-09-11T09:00:00.000Z" }, randomUUID()));
	return { requested, running: exactRunning, evidence };
}

/** Read one complete stream for exact receipt and participant-entry counts. */
async function _Events(store: _KurrentHistoryStore, streamName: string): Promise<HistoryRecordedEvent[]>
{
	const events: HistoryRecordedEvent[] = [];
	for await (const event of store.readStream({ streamName, fromRevision: 0n }))
		events.push(event);
	return events;
}
