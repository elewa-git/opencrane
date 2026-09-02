import { ConversationLifecycleModes, type ConversationCreated } from "@opencrane/contracts";
import type { HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";
import { describe, expect, it, vi } from "vitest";

import { ConversationCreationAnchorVerifier } from "../conversation-creation-anchor-verifier";

const _EVENT_ID = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";

function _Created(): ConversationCreated
{
	return { schemaVersion: 1, conversationId: "conversation-1", mode: ConversationLifecycleModes.Agent, participants: [{ userId: "user-1", visibleFromPosition: "1", joinedAt: "2026-09-01T00:00:00.000Z" }], agentBinding: { agentServiceId: "service-1", agentRevisionId: "revision-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1", computerId: "computer-1" }, createdAt: "2026-09-01T00:00:00.000Z", provenance: { principalId: "principal-1", authorizationEvidenceId: "evidence-1", requestId: _EVENT_ID } };
}

function _Event(overrides: Record<string, unknown> = {}): HistoryRecordedEvent
{
	const created = _Created();
	return { streamName: "conversation-conversation-1", id: _EVENT_ID, type: "opencrane.conversation-created.v1", data: { created }, metadata: { siloId: "silo-1", conversationId: created.conversationId, idempotencyKey: _EVENT_ID }, revision: 0n, recordedAt: new Date("2026-09-01T00:00:00.000Z"), ...overrides } as HistoryRecordedEvent;
}

async function *_Events(events: readonly HistoryRecordedEvent[]): AsyncIterable<HistoryRecordedEvent>
{
	for (const event of events)
		yield event;
}

describe("ConversationCreationAnchorVerifier", function _Suite()
{
	it("confirms the exact reserved revision-zero creation envelope", async function _Confirms()
	{
		const readStream = vi.fn().mockReturnValue(_Events([_Event()]));
		await expect(new ConversationCreationAnchorVerifier({ readStream }).confirm({ siloId: "silo-1", created: _Created(), eventId: _EVENT_ID })).resolves.toEqual({ outcome: "confirmed", revision: 0n });
		expect(readStream).toHaveBeenCalledWith({ streamName: "conversation-conversation-1" });
	});

	it("reports an absent stream without inventing a successful recovery", async function _Absent()
	{
		await expect(new ConversationCreationAnchorVerifier({ readStream: vi.fn().mockReturnValue(_Events([])) }).confirm({ siloId: "silo-1", created: _Created(), eventId: _EVENT_ID })).resolves.toEqual({ outcome: "absent" });
	});

	it("fails closed when an existing first event has a different envelope or payload", async function _RejectsMismatch()
	{
		const foreignStream = _Event({ streamName: "conversation-foreign" });
		const nonzero = _Event({ revision: 1n });
		const wrongType = _Event({ type: "opencrane.conversation-entry.v1" });
		const foreignEnvelope = _Event({ id: "e97a2af7-81a2-4f48-96b8-cf2ea37f3d5f", metadata: { siloId: "silo-1", conversationId: "conversation-1", idempotencyKey: "e97a2af7-81a2-4f48-96b8-cf2ea37f3d5f" } });
		const foreignPayload = _Event({ data: { created: { ..._Created(), createdAt: "2026-09-02T00:00:00.000Z" } } });
		await expect(new ConversationCreationAnchorVerifier({ readStream: vi.fn().mockReturnValue(_Events([foreignStream])) }).confirm({ siloId: "silo-1", created: _Created(), eventId: _EVENT_ID })).rejects.toThrow("foreign or nonzero");
		await expect(new ConversationCreationAnchorVerifier({ readStream: vi.fn().mockReturnValue(_Events([nonzero])) }).confirm({ siloId: "silo-1", created: _Created(), eventId: _EVENT_ID })).rejects.toThrow("foreign or nonzero");
		await expect(new ConversationCreationAnchorVerifier({ readStream: vi.fn().mockReturnValue(_Events([wrongType])) }).confirm({ siloId: "silo-1", created: _Created(), eventId: _EVENT_ID })).rejects.toThrow("reserved envelope");
		await expect(new ConversationCreationAnchorVerifier({ readStream: vi.fn().mockReturnValue(_Events([foreignEnvelope])) }).confirm({ siloId: "silo-1", created: _Created(), eventId: _EVENT_ID })).rejects.toThrow("reserved envelope");
		await expect(new ConversationCreationAnchorVerifier({ readStream: vi.fn().mockReturnValue(_Events([foreignPayload])) }).confirm({ siloId: "silo-1", created: _Created(), eventId: _EVENT_ID })).rejects.toThrow("reserved payload");
	});
});
