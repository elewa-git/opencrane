import { WrongExpectedVersionError } from "@kurrent/kurrentdb-client";
import { HistoryExpectedRevisions } from "@opencrane/backend/server/infra/history-store";
import { describe, expect, it, vi } from "vitest";

import { ConversationHistoryAuthority } from "../conversation-history-authority";
import { ConversationHistoryAppendOutcomes, type ConversationHistoryAppendCommand } from "../conversation-history-authority.types";

/** Reuses a valid UUID where an entry id must equal its idempotency key. */
const _EVENT_ID = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";

/** Builds a valid command so each test can isolate the coordinate it needs to reject or accept. */
function _Command(overrides: Partial<ConversationHistoryAppendCommand> = {}): ConversationHistoryAppendCommand
{
	return {
		siloId: "silo-1",
		conversationId: "conversation-1",
		expectedRevision: 7n,
		entry: {
			schemaVersion: 1,
			id: _EVENT_ID,
			conversationId: "conversation-1",
			position: "8",
			author: { kind: "agent", agentIdentityId: "identity-1", agentServiceId: "service-1", name: "Archive", avatarArtifactRevisionId: null },
			provenance: "agent-authored",
			visibility: { audience: "conversation" },
			runId: "run-1",
			causationId: "source-1",
			correlationId: "request-1",
			idempotencyKey: _EVENT_ID,
			occurredAt: "2026-09-01T00:00:00.000Z",
			attestation: null,
			kind: "a2ui",
			surfaceId: "surface-1",
			a2uiSchemaVersion: "0.8",
			operation: "remove",
			payloadRef: null,
			payloadDigest: null,
		},
		...overrides,
	};
}

describe("ConversationHistoryAuthority", function ()
{
	it("appends only the validated server-stamped entry to its exact conversation stream", async function ()
	{
		const append = vi.fn().mockResolvedValue({ streamName: "conversation-conversation-1", revision: 8n });
		const authority = new ConversationHistoryAuthority({ append });

		const result = await authority.append(_Command());

		expect(result).toEqual({ outcome: ConversationHistoryAppendOutcomes.Appended, receipt: { streamName: "conversation-conversation-1", revision: 8n } });
		expect(append).toHaveBeenCalledWith({ streamName: "conversation-conversation-1", expectedRevision: 7n, events: [{ id: _EVENT_ID, type: "opencrane.conversation-entry.v1", data: { entry: expect.objectContaining({ id: _EVENT_ID, conversationId: "conversation-1", position: "8" }) }, metadata: { siloId: "silo-1", conversationId: "conversation-1", causationId: "source-1", correlationId: "request-1", idempotencyKey: _EVENT_ID } }] });
	});

	it("rejects malformed, cross-stream, stale-position, and non-idempotent entry coordinates before append", async function ()
	{
		const append = vi.fn();
		const authority = new ConversationHistoryAuthority({ append });

		await expect(authority.append(_Command({ entry: { ..._Command().entry, conversationId: "conversation-2" } }))).rejects.toThrow("different conversation");
		await expect(authority.append(_Command({ entry: { ..._Command().entry, position: "7" } }))).rejects.toThrow("position does not match");
		await expect(authority.append(_Command({ entry: { ..._Command().entry, idempotencyKey: "different-key" } }))).rejects.toThrow("UUID to be its idempotency key");
		await expect(authority.append(_Command({ entry: { ..._Command().entry, occurredAt: "not-a-time" } }))).rejects.toThrow("valid participant-visible entry");
		expect(append).not.toHaveBeenCalled();
	});

	it("maps the no-stream condition to the first immutable conversation position", async function ()
	{
		const append = vi.fn().mockResolvedValue({ streamName: "conversation-conversation-1", revision: 0n });
		const authority = new ConversationHistoryAuthority({ append });

		await authority.append(_Command({ expectedRevision: HistoryExpectedRevisions.NoStream, entry: { ..._Command().entry, position: "0" } }));

		expect(append).toHaveBeenCalledWith(expect.objectContaining({ streamName: "conversation-conversation-1", expectedRevision: HistoryExpectedRevisions.NoStream }));
	});

	it("returns only the exact conversation stream's expected-head conflict as a retryable result", async function ()
	{
		const exactConflict = new WrongExpectedVersionError(undefined, { streamName: "conversation-conversation-1", expected: 7n, current: 8n });
		const foreignConflict = new WrongExpectedVersionError(undefined, { streamName: "conversation-other", expected: 7n, current: 8n });
		const append = vi.fn().mockRejectedValueOnce(exactConflict).mockRejectedValueOnce(foreignConflict).mockRejectedValueOnce(new Error("KurrentDB unavailable"));
		const authority = new ConversationHistoryAuthority({ append });

		await expect(authority.append(_Command())).resolves.toEqual({ outcome: ConversationHistoryAppendOutcomes.ExpectedHeadConflict });
		await expect(authority.append(_Command())).rejects.toThrow(foreignConflict);
		await expect(authority.append(_Command())).rejects.toThrow("KurrentDB unavailable");
	});
});
