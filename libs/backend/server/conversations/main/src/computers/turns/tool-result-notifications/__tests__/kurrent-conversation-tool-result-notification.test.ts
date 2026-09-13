import { WrongExpectedVersionError } from "@kurrent/kurrentdb-client";
import { describe, expect, it, vi } from "vitest";

import { ConversationHistoryAuthority, ConversationHistoryReader } from "@opencrane/backend/server/conversations/history";
import { HistoryExpectedRevisions, type HistoryAtomicAppend, type HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";

import { ConversationToolResultNotificationOutcomes, type ConversationToolResultNotificationCommand, type ConversationToolResultNotificationEvidence } from "../conversation-tool-result-notification.types";
import { KurrentConversationToolResultNotificationPublisher } from "../kurrent-conversation-tool-result-notification";

const _INVOCATION_ID = "33333333-3333-4333-8333-333333333333";
const _DIGEST = `sha256:${"a".repeat(64)}`;
const _COMMAND: ConversationToolResultNotificationCommand = { bootstrapId: "55555555-5555-4555-8555-555555555555", siloId: "silo-1", conversationId: "conversation-1", runId: "run-1", attempt: 1, toolInvocationId: _INVOCATION_ID, expectedResultDigest: _DIGEST };
const _EVIDENCE: ConversationToolResultNotificationEvidence = { toolName: "records.read", toolKind: "mcp", outcome: "succeeded", resultDigest: _DIGEST, occurredAt: "2026-09-11T10:00:00.000Z" };

/** Keep an in-memory checked HistoryStore sufficient to prove atomic receipt recovery. */
function _History()
{
	const reads: unknown[] = [];
	const genesis = { schemaVersion: 1, siloId: "silo-1", conversationId: "conversation-1", mode: "agent_session", agentServiceId: "service-1", createdByPrincipalId: "principal-1", createdAt: "2026-09-11T09:00:00.000Z" };
	const streams = new Map<string, HistoryRecordedEvent[]>([["conversation-conversation-1", [{ streamName: "conversation-conversation-1", revision: 0n, recordedAt: new Date(), id: "11111111-1111-4111-8111-111111111111", type: "opencrane.conversation-created.v1", data: { genesis }, metadata: { siloId: "silo-1", conversationId: "conversation-1", causationId: "11111111-1111-4111-8111-111111111111", correlationId: "11111111-1111-4111-8111-111111111111", idempotencyKey: "11111111-1111-4111-8111-111111111111" } }]]]);
	const appendAtomic = vi.fn(async function _Append(command: HistoryAtomicAppend)
	{
		for (const expected of command.expectedHeads)
		{
			const events = streams.get(expected.streamName) ?? [];
			const revision = events.length === 0 ? null : BigInt(events.length - 1);
			const matches = expected.revision === HistoryExpectedRevisions.NoStream ? revision === null : revision === expected.revision;
			if (!matches)
				throw new WrongExpectedVersionError({ streamName: expected.streamName, expectedVersion: expected.revision, actualVersion: revision ?? HistoryExpectedRevisions.NoStream } as never);
		}
		for (const append of command.appends)
		{
			const events = streams.get(append.streamName) ?? [];
			for (const event of append.events)
				events.push({ ...event, streamName: append.streamName, revision: BigInt(events.length), recordedAt: new Date() });
			streams.set(append.streamName, events);
		}
		return command.appends.map(append => ({ streamName: append.streamName, revision: BigInt(streams.get(append.streamName)!.length - 1) }));
	});
	const history = {
		append: vi.fn(), appendAtomic,
		readHead: vi.fn(async function _ReadHead(streamName: string) { const events = streams.get(streamName) ?? []; return { streamName, revision: events.length === 0 ? null : BigInt(events.length - 1) }; }),
		readStream: async function* _ReadStream(request: { readonly streamName: string; readonly fromRevision?: bigint; readonly maxCount?: number })
		{
			reads.push(request);
			const from = Number(request.fromRevision ?? 0n);
			for (const event of (streams.get(request.streamName) ?? []).slice(from, request.maxCount === undefined ? undefined : from + request.maxCount))
				yield event;
		},
	};
	return { appendAtomic, history, reads, streams };
}

describe("Kurrent conversation tool-result notification", function _Suite()
{
	it.each([
		["succeeded", "completed", "Tool completed"],
		["failed", "failed", "Tool failed"],
	] as const)("atomically publishes and recovers one %s result without private content", async function _Publish(outcome, phase, summary)
	{
		const state = _History();
		const evidence = { readCurrent: vi.fn().mockResolvedValue({ ..._EVIDENCE, outcome }) };
		const publisher = new KurrentConversationToolResultNotificationPublisher(evidence, new ConversationHistoryAuthority(state.history as never), new ConversationHistoryReader(state.history as never), state.history as never);
		await expect(publisher.publishTerminal(_COMMAND)).resolves.toBe(ConversationToolResultNotificationOutcomes.Published);
		await expect(publisher.publishTerminal(_COMMAND)).resolves.toBe(ConversationToolResultNotificationOutcomes.Published);
		expect(state.appendAtomic).toHaveBeenCalledTimes(1);
		const entry = state.streams.get("conversation-conversation-1")![1]!.data["entry"];
		expect(entry).toMatchObject({ logKind: "tool_call", toolCallId: _INVOCATION_ID, toolKind: "mcp", toolName: "records.read", phase, summary, resultArtifactRevisionId: null, detailsRef: null, visibility: { audience: "conversation" }, occurredAt: _EVIDENCE.occurredAt });
		expect(JSON.stringify(entry)).not.toContain(_DIGEST);
		expect(JSON.stringify(entry)).not.toContain("private");
		expect(state.reads).toContainEqual({ streamName: "conversation-conversation-1", fromRevision: 1n, maxCount: 1, signal: undefined });
	});

	it("suppresses a new append after current evidence ends", async function _Revoked()
	{
		const state = _History();
		const publisher = new KurrentConversationToolResultNotificationPublisher({ readCurrent: vi.fn().mockResolvedValue(null) }, new ConversationHistoryAuthority(state.history as never), new ConversationHistoryReader(state.history as never), state.history as never);
		await expect(publisher.publishTerminal(_COMMAND)).resolves.toBe(ConversationToolResultNotificationOutcomes.NoLongerVisible);
		expect(state.appendAtomic).not.toHaveBeenCalled();
	});

	it("recovers the exact receipt after another writer wins an append conflict", async function _ConflictWinner()
	{
		const state = _History();
		const commit = state.appendAtomic.getMockImplementation()!;
		state.appendAtomic.mockImplementationOnce(async function _WinningWriter(command)
		{
			await commit(command);
			const conflict = Object.assign(Object.create(WrongExpectedVersionError.prototype), { streamName: `conversation-tool-result-notification-${_INVOCATION_ID}` });
			throw conflict;
		});
		const publisher = new KurrentConversationToolResultNotificationPublisher({ readCurrent: vi.fn().mockResolvedValue(_EVIDENCE) }, new ConversationHistoryAuthority(state.history as never), new ConversationHistoryReader(state.history as never), state.history as never);
		await expect(publisher.publishTerminal(_COMMAND)).resolves.toBe(ConversationToolResultNotificationOutcomes.Published);
		expect(state.appendAtomic).toHaveBeenCalledTimes(1);
	});

	it("rejects substituted safe evidence before appending", async function _WrongEvidence()
	{
		const state = _History();
		const evidence = { ..._EVIDENCE, resultDigest: `sha256:${"c".repeat(64)}` };
		const publisher = new KurrentConversationToolResultNotificationPublisher({ readCurrent: vi.fn().mockResolvedValue(evidence) }, new ConversationHistoryAuthority(state.history as never), new ConversationHistoryReader(state.history as never), state.history as never);
		await expect(publisher.publishTerminal(_COMMAND)).rejects.toThrow("evidence is invalid");
		expect(state.appendAtomic).not.toHaveBeenCalled();
	});

	it("rejects a changed digest when recovering an exact committed receipt", async function _ChangedDigest()
	{
		const state = _History();
		const publisher = new KurrentConversationToolResultNotificationPublisher({ readCurrent: vi.fn().mockResolvedValue(_EVIDENCE) }, new ConversationHistoryAuthority(state.history as never), new ConversationHistoryReader(state.history as never), state.history as never);
		await publisher.publishTerminal(_COMMAND);
		await expect(publisher.publishTerminal({ ..._COMMAND, expectedResultDigest: `sha256:${"b".repeat(64)}` })).rejects.toThrow("differs from its invocation");
	});
});
