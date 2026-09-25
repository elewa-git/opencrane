import { WrongExpectedVersionError } from "@kurrent/kurrentdb-client";
import { describe, expect, it, vi } from "vitest";

import { ConversationHistoryAuthority, ConversationHistoryReader } from "@opencrane/backend/server/conversations/history";
import { HistoryExpectedRevisions, type HistoryAtomicAppend, type HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";
import { ExternalActionClaimKinds } from "@opencrane/backend/server/iam/authorization";

import { KurrentConversationToolRequestedNotificationPublisher, KurrentConversationToolRunningNotificationPublisher } from "../kurrent-conversation-tool-progress-notification";
import { ConversationToolProgressNotificationOutcomes, type ConversationToolProgressNotificationEvidence, type ConversationToolRequestedNotificationCommand, type ConversationToolRunningNotificationCommand } from "../conversation-tool-progress-notification.types";
import { KurrentConversationToolResultNotificationPublisher } from "../../tool-result-notifications/kurrent-conversation-tool-result-notification";

const _TOOL_CALL_ID = "33333333-3333-4333-8333-333333333333";
const _REQUESTED: ConversationToolRequestedNotificationCommand = { bootstrapId: "55555555-5555-4555-8555-555555555555", siloId: "silo-1", conversationId: "conversation-1", runId: "run-1", attempt: 1, toolInvocationId: _TOOL_CALL_ID };
const _EVIDENCE: ConversationToolProgressNotificationEvidence = { ..._REQUESTED, toolName: "records.read", toolKind: "mcp", occurredAt: "2026-09-11T10:00:00.000Z" };
const _RUNNING: ConversationToolRunningNotificationCommand = {
	executionId: "execution-1", companionClaimFence: "companion-fence-1", invocationId: "invocation-row-1",
	siloId: _REQUESTED.siloId, conversationId: _REQUESTED.conversationId, runId: _REQUESTED.runId, attempt: 1,
	toolInvocationId: _TOOL_CALL_ID, requestIdentity: { runtimeInstanceId: "computer-1", commandId: _REQUESTED.bootstrapId, candidateId: _TOOL_CALL_ID },
	toolClaim: { invocationId: "invocation-row-1", kind: ExternalActionClaimKinds.Dispatch, fence: 2, revision: 5 },
	workload: { audience: "mcp-executor", namespace: "mcp-executor", serviceAccountName: "mcp-executor", workloadKind: "job", workloadUid: "job-1", podUid: "pod-1" },
};

/** Keep an in-memory checked store that records ordering and supports uncertain-response recovery. */
function _History()
{
	const operations: string[] = [];
	const genesis = { schemaVersion: 1, siloId: "silo-1", conversationId: "conversation-1", mode: "agent_session", agentServiceId: "service-1", createdByPrincipalId: "principal-1", createdAt: "2026-09-11T09:00:00.000Z" };
	const streams = new Map<string, HistoryRecordedEvent[]>([["conversation-conversation-1", [{ streamName: "conversation-conversation-1", revision: 0n, recordedAt: new Date(), id: "11111111-1111-4111-8111-111111111111", type: "opencrane.conversation-created.v1", data: { genesis }, metadata: { siloId: "silo-1", conversationId: "conversation-1", causationId: "11111111-1111-4111-8111-111111111111", correlationId: "11111111-1111-4111-8111-111111111111", idempotencyKey: "11111111-1111-4111-8111-111111111111" } }]]]);
	const appendAtomic = vi.fn(async function _Append(command: HistoryAtomicAppend)
	{
		operations.push("append");
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
		readHead: vi.fn(async function _Head(streamName: string) { operations.push("head"); const events = streams.get(streamName) ?? []; return { streamName, revision: events.length === 0 ? null : BigInt(events.length - 1) }; }),
		readStream: async function* _Read(request: { readonly streamName: string; readonly fromRevision?: bigint; readonly maxCount?: number })
		{
			operations.push(`read:${request.streamName}`);
			const from = Number(request.fromRevision ?? 0n);
			for (const event of (streams.get(request.streamName) ?? []).slice(from, request.maxCount === undefined ? undefined : from + request.maxCount))
				yield event;
		},
	};
	return { appendAtomic, history, operations, streams };
}

function _HistoryOwners(state: ReturnType<typeof _History>)
{
	return { authority: new ConversationHistoryAuthority(state.history as never), reader: new ConversationHistoryReader(state.history as never) };
}

describe("Kurrent conversation tool progress notification", function _Suite()
{
	it("publishes and recovers stable requested then running entries in order", async function _Phases()
	{
		const state = _History();
		const owners = _HistoryOwners(state);
		const requestedEvidence = { readCurrent: vi.fn(async function _Read() { state.operations.push("requested-evidence"); return _EVIDENCE; }) };
		const requested = new KurrentConversationToolRequestedNotificationPublisher(requestedEvidence, owners.authority, owners.reader, state.history as never);
		await expect(requested.publishRequested(_REQUESTED)).resolves.toBe(ConversationToolProgressNotificationOutcomes.Published);
		await expect(requested.publishRequested(_REQUESTED)).resolves.toBe(ConversationToolProgressNotificationOutcomes.Published);
		const runningEvidence = { readCurrent: vi.fn().mockResolvedValue(_EVIDENCE) };
		const running = new KurrentConversationToolRunningNotificationPublisher(runningEvidence, owners.authority, owners.reader, state.history as never);
		await expect(running.publishRunning(_RUNNING)).resolves.toBe(ConversationToolProgressNotificationOutcomes.Published);
		await expect(running.publishRunning(_RUNNING)).resolves.toBe(ConversationToolProgressNotificationOutcomes.Published);
		const entries = state.streams.get("conversation-conversation-1")!.slice(1).map(event => event.data["entry"]);
		expect(entries).toMatchObject([{ toolCallId: _TOOL_CALL_ID, phase: "requested", summary: "Tool requested" }, { toolCallId: _TOOL_CALL_ID, phase: "running", summary: "Tool running" }]);
		expect(state.appendAtomic).toHaveBeenCalledTimes(2);
		expect(state.operations.indexOf("head")).toBeLessThan(state.operations.indexOf("requested-evidence"));
		expect(runningEvidence.readCurrent).toHaveBeenCalledTimes(3);
	});

	it("recovers an uncertain committed requested append without duplicating history", async function _Recovery()
	{
		const state = _History();
		const commit = state.appendAtomic.getMockImplementation()!;
		state.appendAtomic.mockImplementationOnce(async function _Uncertain(command)
		{
			await commit(command);
			throw new Error("connection ended after commit");
		});
		const owners = _HistoryOwners(state);
		const publisher = new KurrentConversationToolRequestedNotificationPublisher({ readCurrent: vi.fn().mockResolvedValue(_EVIDENCE) }, owners.authority, owners.reader, state.history as never);
		await expect(publisher.publishRequested(_REQUESTED)).resolves.toBe(ConversationToolProgressNotificationOutcomes.Published);
		expect(state.streams.get("conversation-tool-progress-requested-33333333-3333-4333-8333-333333333333")).toHaveLength(1);
		expect(state.streams.get("conversation-conversation-1")).toHaveLength(2);
	});

	it("recovers an uncertain committed running append before its final current-authority check", async function _RunningRecovery()
	{
		const state = _History();
		const commit = state.appendAtomic.getMockImplementation()!;
		state.appendAtomic.mockImplementationOnce(commit).mockImplementationOnce(async function _Uncertain(command)
		{
			await commit(command);
			throw new Error("connection ended after running commit");
		});
		const owners = _HistoryOwners(state);
		const evidence = { readCurrent: vi.fn().mockResolvedValue(_EVIDENCE) };
		const publisher = new KurrentConversationToolRunningNotificationPublisher(evidence, owners.authority, owners.reader, state.history as never);
		await expect(publisher.publishRunning(_RUNNING)).resolves.toBe(ConversationToolProgressNotificationOutcomes.Published);
		expect(evidence.readCurrent).toHaveBeenCalledTimes(3);
		expect(state.streams.get("conversation-conversation-1")!.slice(1).map(event => (event.data["entry"] as { readonly phase: string }).phase)).toEqual(["requested", "running"]);
	});

	it("refuses release when authority is lost after recovering an uncertain running append", async function _RecoveredFinalFence()
	{
		const state = _History();
		const commit = state.appendAtomic.getMockImplementation()!;
		state.appendAtomic.mockImplementationOnce(commit).mockImplementationOnce(async function _Uncertain(command)
		{
			await commit(command);
			throw new Error("connection ended after running commit");
		});
		const owners = _HistoryOwners(state);
		const evidence = { readCurrent: vi.fn().mockResolvedValueOnce(_EVIDENCE).mockResolvedValueOnce(_EVIDENCE).mockResolvedValueOnce(null) };
		const publisher = new KurrentConversationToolRunningNotificationPublisher(evidence, owners.authority, owners.reader, state.history as never);
		await expect(publisher.publishRunning(_RUNNING)).resolves.toBe(ConversationToolProgressNotificationOutcomes.NoLongerVisible);
		expect(evidence.readCurrent).toHaveBeenCalledTimes(3);
	});

	it("propagates a genuine append failure when no exact receipt was committed", async function _GenuineFailure()
	{
		const state = _History();
		state.appendAtomic.mockRejectedValueOnce(new Error("history unavailable before commit"));
		const owners = _HistoryOwners(state);
		const publisher = new KurrentConversationToolRequestedNotificationPublisher({ readCurrent: vi.fn().mockResolvedValue(_EVIDENCE) }, owners.authority, owners.reader, state.history as never);
		await expect(publisher.publishRequested(_REQUESTED)).rejects.toThrow("history unavailable before commit");
		expect(state.streams.get("conversation-conversation-1")).toHaveLength(1);
	});

	it("keeps durable running history but refuses release when the final claim recheck fails", async function _FinalFence()
	{
		const state = _History();
		const owners = _HistoryOwners(state);
		const evidence = { readCurrent: vi.fn().mockResolvedValueOnce(_EVIDENCE).mockResolvedValueOnce(_EVIDENCE).mockResolvedValueOnce(null) };
		const publisher = new KurrentConversationToolRunningNotificationPublisher(evidence, owners.authority, owners.reader, state.history as never);
		await expect(publisher.publishRunning(_RUNNING)).resolves.toBe(ConversationToolProgressNotificationOutcomes.NoLongerVisible);
		expect(state.streams.get("conversation-conversation-1")!.slice(1).map(event => (event.data["entry"] as { readonly phase: string }).phase)).toEqual(["requested", "running"]);
	});

	it("does not append an earlier phase behind a terminal receipt", async function _TerminalWins()
	{
		const state = _History();
		const owners = _HistoryOwners(state);
		const terminal = new KurrentConversationToolResultNotificationPublisher({ readCurrent: vi.fn().mockResolvedValue({ toolName: "records.read", toolKind: "mcp", outcome: "succeeded", resultDigest: `sha256:${"a".repeat(64)}`, occurredAt: "2026-09-11T10:01:00.000Z" }) }, owners.authority, owners.reader, state.history as never);
		await terminal.publishTerminal({ ..._REQUESTED, expectedResultDigest: `sha256:${"a".repeat(64)}` });
		const evidence = { readCurrent: vi.fn().mockResolvedValue(_EVIDENCE) };
		const publisher = new KurrentConversationToolRunningNotificationPublisher(evidence, owners.authority, owners.reader, state.history as never);
		await expect(publisher.publishRunning(_RUNNING)).resolves.toBe(ConversationToolProgressNotificationOutcomes.NoLongerVisible);
		expect(evidence.readCurrent).not.toHaveBeenCalled();
		expect(state.streams.get("conversation-conversation-1")!.slice(1).map(event => (event.data["entry"] as { readonly phase: string }).phase)).toEqual(["completed"]);
	});
});
