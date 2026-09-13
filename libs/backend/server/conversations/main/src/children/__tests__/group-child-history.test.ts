import { WrongExpectedVersionError } from "@kurrent/kurrentdb-client";
import type { ConversationChildRequest } from "@prisma/client";
import type { HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";
import { HistoryExpectedRevisions } from "@opencrane/backend/server/infra/history-store";
import type { MessageEntry } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";
import { ConversationHistoryAuthority } from "@opencrane/backend/server/conversations/history";
import { GroupChildHistory } from "../group-child-history";
import { GroupChildConflictError } from "../group-child.errors";

const _ID = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";
const _MESSAGE = "41c1f1dc-0010-4f13-9c2f-d3841ffd6651";
const _REQUEST = { id: _ID, siloId: "silo", childConversationId: "child", parentConversationId: "parent", parentMessageId: _MESSAGE, parentMessagePosition: 3n, computerId: "computer", agentServiceId: "company", agentIdentityId: "managed-company", requestedByPrincipalId: "principal", requesterSubjectId: "subject", profileRevisionId: `sha256:${"a".repeat(64)}`, createdAt: new Date("2026-09-07T00:00:00Z") } as ConversationChildRequest;
const _SOURCE: MessageEntry = { schemaVersion: 1, id: _MESSAGE, conversationId: "parent", position: "3", author: { kind: "human", principalId: "principal", participantId: "subject", issuer: "https://issuer.test", authenticatedAt: "2026-09-07T00:00:00.000Z", name: "Human", avatarArtifactRevisionId: null }, provenance: "human-authored", visibility: { audience: "conversation" }, runId: null, causationId: _MESSAGE, correlationId: _MESSAGE, idempotencyKey: _MESSAGE, occurredAt: "2026-09-07T00:00:00.000Z", attestation: null, kind: "message", state: "completed", blocks: [{ id: "source-block", kind: "text", payloadRef: "original", ciphertextDigest: `sha256:${"b".repeat(64)}` }], replyToEntryId: null, addressedAgentIdentityId: null, activation: "none" };
const _PAYLOAD = { coordinates: { siloId: "silo", conversationId: "child", payloadRef: "copied", authorSubject: "subject" }, idempotencyKey: _ID, keyId: "key", nonce: new Uint8Array(12), authTag: new Uint8Array(16), ciphertext: new Uint8Array([1]), ciphertextDigest: `sha256:${"c".repeat(64)}` };

/** Applies each checked batch atomically and preserves exact revisions for the real history validators. */
function _Fixture()
{
	const streams = new Map<string, HistoryRecordedEvent[]>();
	const control = { loseResponse: false };
	const appendAtomic = vi.fn(async (command: any) =>
	{
		for (const expected of command.expectedHeads)
		{
			const current = streams.has(expected.streamName) ? BigInt(streams.get(expected.streamName)!.length - 1) : HistoryExpectedRevisions.NoStream;
			if (expected.revision !== current)
				throw new WrongExpectedVersionError(undefined, { streamName: expected.streamName, expected: expected.revision, current: current as never });
		}
		const receipts = command.appends.map((append: any) =>
		{
			const events = streams.get(append.streamName) ?? [];
			for (const event of append.events)
				events.push({ ...event, streamName: append.streamName, revision: BigInt(events.length), recordedAt: new Date("2026-09-07T00:00:00Z") });
			streams.set(append.streamName, events);
			return { streamName: append.streamName, revision: BigInt(events.length - 1) };
		});
		if (control.loseResponse)
		{
			control.loseResponse = false;
			throw new Error("committed response lost");
		}
		return receipts;
	});
	const store = { append: vi.fn(), appendAtomic, readHead: vi.fn(async (streamName: string) => ({ streamName, revision: streams.has(streamName) ? BigInt(streams.get(streamName)!.length - 1) : null })), readStream: vi.fn(async function* (command: any)
	{
		const from = Number(command.fromRevision ?? 0n);
		for (const event of (streams.get(command.streamName) ?? []).slice(from, command.maxCount === undefined ? undefined : from + command.maxCount))
			yield event;
	}) };
	return { history: new GroupChildHistory(store as never, new ConversationHistoryAuthority(store as never)), streams, appendAtomic, control };
}

describe("group child immutable history", () =>
{
	it("recovers cold genesis after a committed response loss and never creates a warm lease", async () =>
	{
		const f = _Fixture(); f.control.loseResponse = true;
		await expect(f.history.establish(_REQUEST)).rejects.toThrow("response lost");
		await f.history.establish(_REQUEST);
		expect(f.streams.get("conversation-child")).toHaveLength(1);
		expect(f.streams.get("conversation-computer-computer")?.[0]?.data).toMatchObject({ computer: { state: "cold", leaseGeneration: 1 }, lease: null });
		expect(f.streams.get("conversation-child")?.[0]?.data).toMatchObject({ genesis: { origin: { requestId: _ID, parentConversationId: "parent", parentMessageId: _MESSAGE, parentMessagePosition: "3" } } });
	});
	it("commits the encrypted child message and activation atomically and recovers without reactivating", async () =>
	{
		const f = _Fixture(); await f.history.establish(_REQUEST); f.control.loseResponse = true;
		await expect(f.history.activate(_REQUEST, _SOURCE, _PAYLOAD)).rejects.toThrow("response lost");
		await f.history.activate(_REQUEST, _SOURCE, _PAYLOAD);
		expect(f.streams.get("conversation-child")).toHaveLength(2);
		expect(f.streams.get("computer-activations-silo")).toHaveLength(1);
		const batch = f.appendAtomic.mock.calls[1]![0];
		expect(batch.appends.map((append: any) => append.streamName)).toEqual(["conversation-child", "computer-activations-silo"]);
		expect(f.streams.get("conversation-child")?.[1]?.data).toMatchObject({ entry: { causationId: _MESSAGE, correlationId: _ID, addressedAgentIdentityId: "managed-company", activation: "start", blocks: [{ payloadRef: "copied" }] } });
	});
	it("rejects a changed origin or a foreign author under the same request", async () =>
	{
		const f = _Fixture(); await f.history.establish(_REQUEST);
		await expect(f.history.establish({ ..._REQUEST, parentMessagePosition: 4n })).rejects.toBeInstanceOf(GroupChildConflictError);
		await expect(f.history.activate(_REQUEST, { ..._SOURCE, author: { ..._SOURCE.author, principalId: "foreign" } } as MessageEntry, _PAYLOAD)).rejects.toBeInstanceOf(GroupChildConflictError);
		expect(f.streams.get("computer-activations-silo")).toBeUndefined();
	});
});
