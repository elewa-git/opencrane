import { WrongExpectedVersionError } from "@kurrent/kurrentdb-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ElicitationBodyKinds, ElicitationPurposes, ElicitationRequestStates } from "@opencrane/contracts";
import { ConversationHistoryAuthority, ConversationHistoryReader } from "@opencrane/backend/server/conversations/history";
import { type HistoryAtomicAppend, type HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";

import { ConversationApprovalNotificationOutcomes } from "../conversation-approval-notification.types";
import { KurrentConversationApprovalNotificationPublisher } from "../kurrent-conversation-approval-notification";

const _APPROVAL_ID = "61c1f1dc-0010-4f13-9c2f-d3841ffd6651";
const _COMMAND = { bootstrapId: "turn-1", siloId: "silo-1", conversationId: "conversation-1", runId: "run-1", attempt: 1, approvalId: _APPROVAL_ID };
const _REQUEST = { version: "opencrane.elicitation.v1", requestId: _APPROVAL_ID, conversationId: "conversation-1", runId: "run-1", attempt: 1, assignedParticipantId: "user-1", purpose: ElicitationPurposes.ToolApproval, state: ElicitationRequestStates.Requested, body: { kind: ElicitationBodyKinds.Approval, prompt: "Full reviewed prompt", action: "Invoke tool", target: "secret-tool-revision", dataUse: "Protected detail", consequence: "Protected consequence" }, requiresStepUp: true, requestedAt: "2026-09-10T10:00:00.000Z", expiresAt: "2026-09-10T10:05:00.000Z" } as const;

/** Keep an in-memory checked HistoryStore sufficient to prove atomic receipt recovery. */
function _History()
{
	const reads: { readonly streamName: string; readonly fromRevision?: bigint; readonly maxCount?: number }[] = [];
	const genesis = { schemaVersion: 1, conversationId: "conversation-1", siloId: "silo-1", mode: "direct", agentServiceId: null, createdByPrincipalId: "user-1", createdAt: "2026-09-10T09:00:00.000Z" };
	const streams = new Map<string, HistoryRecordedEvent[]>([["conversation-conversation-1", [{ streamName: "conversation-conversation-1", revision: 0n, recordedAt: new Date(), id: "71c1f1dc-0010-4f13-9c2f-d3841ffd6651", type: "opencrane.conversation-created.v1", data: { genesis }, metadata: { siloId: "silo-1", conversationId: "conversation-1", causationId: "71c1f1dc-0010-4f13-9c2f-d3841ffd6651", correlationId: "71c1f1dc-0010-4f13-9c2f-d3841ffd6651", idempotencyKey: "71c1f1dc-0010-4f13-9c2f-d3841ffd6651" } }]]]);
	const appendAtomic = vi.fn(async function _Append(command: HistoryAtomicAppend)
	{
		for (const expected of command.expectedHeads)
		{
			const events = streams.get(expected.streamName) ?? [];
			const revision = events.length === 0 ? null : BigInt(events.length - 1);
			const matches = expected.revision === "no_stream" ? revision === null : revision === expected.revision;
			if (!matches)
				throw new WrongExpectedVersionError({ streamName: expected.streamName, expectedVersion: expected.revision, actualVersion: revision ?? "no_stream" } as never);
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
		append: vi.fn(),
		appendAtomic,
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

describe("Kurrent conversation approval notification", function _Suite()
{
	beforeEach(function _Reset()
	{
		vi.restoreAllMocks();
	});

	it("atomically publishes requested metadata once and recovers the exact receipt", async function _PublishAndRecover()
	{
		const state = _History();
		const requests = { readCurrent: vi.fn().mockResolvedValue(_REQUEST) };
		const publisher = new KurrentConversationApprovalNotificationPublisher(requests, new ConversationHistoryAuthority(state.history as never), new ConversationHistoryReader(state.history as never), state.history as never, { now: function _Now() { return new Date("2026-09-10T10:01:00.000Z"); } });
		await expect(publisher.publishRequested(_COMMAND)).resolves.toBe(ConversationApprovalNotificationOutcomes.Published);
		await expect(publisher.publishRequested(_COMMAND)).resolves.toBe(ConversationApprovalNotificationOutcomes.Published);
		expect(state.appendAtomic).toHaveBeenCalledTimes(1);
		const entry = state.streams.get("conversation-conversation-1")![1]!.data["entry"];
		expect(entry).toMatchObject({ id: _APPROVAL_ID, logKind: "approval", phase: "requested", action: "Invoke tool", summary: "Approval requested", detailsRef: null, visibility: { audience: "participant_subset", participantIds: ["user-1"] } });
		expect(JSON.stringify(entry)).not.toContain("secret-tool-revision");
		expect(JSON.stringify(entry)).not.toContain("Protected detail");
		expect(state.reads).toContainEqual({ streamName: "conversation-conversation-1", fromRevision: 1n, maxCount: 1, signal: undefined });
	});

	it("suppresses a new append when current owned-read authority ended", async function _Revoked()
	{
		const state = _History();
		const publisher = new KurrentConversationApprovalNotificationPublisher({ readCurrent: vi.fn().mockResolvedValue(null) }, new ConversationHistoryAuthority(state.history as never), new ConversationHistoryReader(state.history as never), state.history as never);
		await expect(publisher.publishRequested(_COMMAND)).resolves.toBe(ConversationApprovalNotificationOutcomes.NoLongerVisible);
		expect(state.appendAtomic).not.toHaveBeenCalled();
	});
});
