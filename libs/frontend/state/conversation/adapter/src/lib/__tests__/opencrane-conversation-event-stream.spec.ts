import { Injector, runInInjectionContext } from "@angular/core";
import { describe, expect, it, vi } from "vitest";

import { ControlPlaneApiService } from "@opencrane/core";
import { ConversationEventStreamStatuses } from "@opencrane/state/conversation/stream";

import { OpenCraneConversationEventStream } from "../opencrane-conversation-event-stream";

/** Build one valid human-authored message entry for polling tests. */
function _Entry()
{
	return { schemaVersion: 1 as const, id: "57de859d-1fb6-4782-aa0b-2b3d4dfd2292", conversationId: "conversation-1", position: "1", author: { kind: "human" as const, principalId: "principal-1", participantId: "participant-1", name: "Jente", avatarArtifactRevisionId: null }, provenance: "human-authored" as const, visibility: { audience: "conversation" as const }, runId: null, causationId: "command-1", correlationId: "request-1", idempotencyKey: "57de859d-1fb6-4782-aa0b-2b3d4dfd2292", occurredAt: "2026-09-05T00:00:00.000Z", attestation: null, kind: "message" as const, state: "completed" as const, blocks: [{ id: "block-1", kind: "text" as const, payloadRef: "payload-1", ciphertextDigest: "sha256:digest" }], replyToEntryId: null, addressedAgentIdentityId: null, activation: "none" as const };
}

/** Construct the adapter with one generated-client test double. */
function _Stream(get: ReturnType<typeof vi.fn>): OpenCraneConversationEventStream
{
	const injector = Injector.create({ providers: [{ provide: ControlPlaneApiService, useValue: { client: { GET: get } } }] });
	return runInInjectionContext(injector, function _Create() { return new OpenCraneConversationEventStream(); });
}

describe("OpenCraneConversationEventStream", function _DescribeHistoryPolling()
{
	it("omits the exclusive cursor on the initial read and resolves private message text", async function _PollsHistory()
	{
		const get = vi.fn().mockResolvedValue({ data: { entries: [_Entry()], payloads: { "payload-1": "Hello" }, nextPosition: "1", computer: null } });
		const stream = _Stream(get);
		const controller = new AbortController();
		const updates: ConversationEventStreamStatuses[] = [];
		const result = await stream.stream({ conversationId: "conversation-1", signal: controller.signal, pollDelayMilliseconds: 0, onUpdate: function _Update(update)
		{
			updates.push(update.status);
			if (update.status === ConversationEventStreamStatuses.Live)
				controller.abort();
		} });
		expect(result.entries).toHaveLength(1);
		expect(result.payloads["payload-1"]).toBe("Hello");
		expect(get).toHaveBeenCalledWith("/me/conversations/{conversationId}/history", { params: { path: { conversationId: "conversation-1" } } });
		expect(updates).toEqual([ConversationEventStreamStatuses.Connecting, ConversationEventStreamStatuses.Live, ConversationEventStreamStatuses.Aborted]);
	});
});
