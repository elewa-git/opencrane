import type { ConversationEntry } from "@opencrane/contracts";
import type { HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";
import { describe, expect, it, vi } from "vitest";

import { ConversationHistoryReader } from "../conversation-history-reader";
import type { ConversationHistoryReadCommand } from "../conversation-history-reader.types";

/** Reuses a valid UUID for the first immutable participant-visible entry. */
const _FIRST_ENTRY_ID = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";
/** Reuses a valid UUID for the second immutable participant-visible entry. */
const _SECOND_ENTRY_ID = "e97a2af7-81a2-4f48-96b8-cf2ea37f3d5f";

/** Builds trusted command coordinates so each test changes only the integrity condition under test. */
function _Command(overrides: Partial<ConversationHistoryReadCommand> = {}): ConversationHistoryReadCommand
{
	return { siloId: "silo-1", conversationId: "conversation-1", ...overrides };
}

/** Builds one valid stored envelope whose entry position matches its KurrentDB stream revision. */
function _Event(revision: bigint, entryId = _FIRST_ENTRY_ID): HistoryRecordedEvent
{
	const entry: ConversationEntry = {
		schemaVersion: 1,
		id: entryId,
		conversationId: "conversation-1",
		position: revision.toString(),
		author: { kind: "agent", agentIdentityId: "identity-1", agentServiceId: "service-1", name: "Archive", avatarArtifactRevisionId: null },
		provenance: "agent-authored",
		visibility: { audience: "conversation" },
		runId: "run-1",
		causationId: `source-${revision.toString()}`,
		correlationId: "request-1",
		idempotencyKey: entryId,
		occurredAt: "2026-09-01T00:00:00.000Z",
		attestation: null,
		kind: "a2ui",
		surfaceId: "surface-1",
		a2uiSchemaVersion: "0.8",
		operation: "remove",
		payloadRef: null,
		payloadDigest: null,
	};
	return { streamName: "conversation-conversation-1", id: entryId, type: "opencrane.conversation-entry.v1", data: { entry }, metadata: { siloId: "silo-1", conversationId: "conversation-1", causationId: entry.causationId, correlationId: entry.correlationId, idempotencyKey: entry.idempotencyKey }, revision, recordedAt: new Date("2026-09-01T00:00:00.000Z") };
}

/** Builds the mandatory revision-zero ownership event. */
function _Genesis(): HistoryRecordedEvent
{
	return { streamName: "conversation-conversation-1", id: "11c1f1dc-0010-4f13-9c2f-d3841ffd6651", type: "opencrane.conversation-created.v1", data: { genesis: { schemaVersion: 1, siloId: "silo-1", conversationId: "conversation-1", mode: "agent_session", agentServiceId: "service-1", createdByPrincipalId: "principal-1", createdAt: "2026-09-01T00:00:00.000Z" } }, metadata: { siloId: "silo-1", conversationId: "conversation-1" }, revision: 0n, recordedAt: new Date("2026-09-01T00:00:00.000Z") };
}

/** Retrieves the valid fixture entry before one test deliberately mutates its untyped stored payload. */
function _FixtureEntry(event: HistoryRecordedEvent): ConversationEntry
{
	return event.data.entry as ConversationEntry;
}

/** Turns a fixed finite event sequence into the HistoryStore async-iterable read contract. */
async function *_Events(events: readonly HistoryRecordedEvent[]): AsyncIterable<HistoryRecordedEvent>
{
	for (const event of events)
		yield event;
}

describe("ConversationHistoryReader", function ()
{
	it("requests only the derived conversation stream and returns entries from the first position in stream order", async function ()
	{
		const readStream = vi.fn().mockReturnValue(_Events([_Genesis(), _Event(1n), _Event(2n, _SECOND_ENTRY_ID)]));
		const reader = new ConversationHistoryReader({ readStream });

		const result = await reader.read(_Command());

		expect(readStream).toHaveBeenCalledWith({ streamName: "conversation-conversation-1" });
		expect(result.streamName).toBe("conversation-conversation-1");
		expect(result.entries.map(entry => entry.position)).toEqual(["1", "2"]);
	});

	it("requests an explicit inclusive revision and preserves its ordered entries", async function ()
	{
		const readStream = vi.fn().mockReturnValue(_Events([_Genesis(), _Event(1n), _Event(2n, _SECOND_ENTRY_ID)]));
		const reader = new ConversationHistoryReader({ readStream });

		const result = await reader.read(_Command({ fromRevision: 2n }));

		expect(readStream).toHaveBeenCalledWith({ streamName: "conversation-conversation-1" });
		expect(result.entries.map(entry => entry.position)).toEqual(["2"]);
	});

	it("fails closed when a store returns an event from a foreign stream, silo, or conversation", async function ()
	{
		const foreignStream = { ..._Event(1n), streamName: "conversation-foreign" };
		const foreignSilo = { ..._Event(1n), metadata: { ..._Event(1n).metadata, siloId: "silo-2" } };
		const foreignConversationEvent = _Event(1n);
		const foreignConversation = { ...foreignConversationEvent, data: { entry: { ..._FixtureEntry(foreignConversationEvent), conversationId: "conversation-2" } } };

		await expect(new ConversationHistoryReader({ readStream: vi.fn().mockReturnValue(_Events([_Genesis(), foreignStream])) }).read(_Command())).rejects.toThrow("different stream");
		await expect(new ConversationHistoryReader({ readStream: vi.fn().mockReturnValue(_Events([_Genesis(), foreignSilo])) }).read(_Command())).rejects.toThrow("different silo");
		await expect(new ConversationHistoryReader({ readStream: vi.fn().mockReturnValue(_Events([_Genesis(), foreignConversation])) }).read(_Command())).rejects.toThrow("different conversation");
	});

	it("fails closed when an event envelope or entry is malformed", async function ()
	{
		const mismatchedEnvelope = { ..._Event(1n), metadata: { ..._Event(1n).metadata, idempotencyKey: "other-command" } };
		const mismatchedIdempotencyEvent = _Event(1n);
		const mismatchedIdempotency = { ...mismatchedIdempotencyEvent, data: { entry: { ..._FixtureEntry(mismatchedIdempotencyEvent), idempotencyKey: "other-command" } }, metadata: { ...mismatchedIdempotencyEvent.metadata, idempotencyKey: "other-command" } };
		const malformedEntryEvent = _Event(1n);
		const malformedEntry = { ...malformedEntryEvent, data: { entry: { ..._FixtureEntry(malformedEntryEvent), occurredAt: "not-a-time" } } };

		await expect(new ConversationHistoryReader({ readStream: vi.fn().mockReturnValue(_Events([_Genesis(), mismatchedEnvelope])) }).read(_Command())).rejects.toThrow("does not match its envelope");
		await expect(new ConversationHistoryReader({ readStream: vi.fn().mockReturnValue(_Events([_Genesis(), mismatchedIdempotency])) }).read(_Command())).rejects.toThrow("invalid idempotency key");
		await expect(new ConversationHistoryReader({ readStream: vi.fn().mockReturnValue(_Events([_Genesis(), malformedEntry])) }).read(_Command())).rejects.toThrow("invalid participant-visible entry");
	});
});
