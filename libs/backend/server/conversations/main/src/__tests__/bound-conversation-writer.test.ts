import { describe, expect, it, vi } from "vitest";

import { BoundConversationWriter } from "../bound-conversation-writer";
import type { BoundConversationWriterBinding } from "../bound-conversation-writer.types";

const _BINDING: BoundConversationWriterBinding = {
	siloId: "silo-1",
	conversationId: "conversation-1",
	computerId: "computer-1",
	leaseGeneration: 4,
	agentIdentityId: "identity-1",
	agentServiceId: "service-1",
	agentName: "Archive",
	agentAvatarArtifactRevisionId: null,
	runId: "run-1",
	expectedRevision: 7n,
	maximumEntryBytes: 10_000,
};

function _Writer(maximumEntryBytes = _BINDING.maximumEntryBytes)
{
	const append = vi.fn().mockResolvedValue({ streamName: "conversation-conversation-1", revision: 8n });
	const assertMayAppend = vi.fn().mockResolvedValue(undefined);
	const assertMayUseVisibility = vi.fn().mockResolvedValue(undefined);
	const assertLeaseMayAppend = vi.fn().mockResolvedValue(undefined);
	return { writer: new BoundConversationWriter({ append }, { ..._BINDING, maximumEntryBytes }, { now: function _Now(): Date { return new Date("2026-08-31T22:00:00.000Z"); } }, { assertMayAppend }, { assertMayUseVisibility }, { assertMayAppend: assertLeaseMayAppend }), append, assertMayAppend, assertMayUseVisibility, assertLeaseMayAppend };
}

describe("BoundConversationWriter", function ()
{
	it("stamps one agent entry onto only its bound conversation stream", async function ()
	{
		const { writer, append, assertMayAppend, assertMayUseVisibility } = _Writer();

		const entry = await writer.append({ sourceCommandId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", entry: { kind: "message", state: "completed", blocks: [{ id: "block-1", kind: "text", payloadRef: "payload-1", ciphertextDigest: "sha256:payload" }], replyToEntryId: null, addressedAgentIdentityId: null, activation: "none", visibility: { audience: "conversation" }, causationId: "source-1", correlationId: "request-1" } });

		expect(entry).toMatchObject({ conversationId: _BINDING.conversationId, position: "8", author: { kind: "agent", agentIdentityId: _BINDING.agentIdentityId }, provenance: "agent-authored", runId: _BINDING.runId, attestation: null });
		expect(assertMayAppend).toHaveBeenCalledWith(_BINDING);
		expect(assertMayUseVisibility).toHaveBeenCalledWith(_BINDING, { audience: "conversation" });
		expect(entry.idempotencyKey).toBe("31c1f1dc-0010-4f13-9c2f-d3841ffd6651");
		expect(append).toHaveBeenCalledWith(expect.objectContaining({ streamName: "conversation-conversation-1", expectedRevision: 7n, events: [expect.objectContaining({ id: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", type: "opencrane.conversation-entry.v1", metadata: expect.objectContaining({ computerId: "computer-1", leaseGeneration: 4 }) })] }));
	});

	it("stamps the first computer entry at position one after the immutable creation anchor", async function _StampsFirstEntryAfterCreation()
	{
		const append = vi.fn().mockResolvedValue({ streamName: "conversation-conversation-1", revision: 1n });
		const writer = new BoundConversationWriter({ append }, { ..._BINDING, expectedRevision: 0n }, { now: function _Now(): Date { return new Date("2026-09-02T00:00:00.000Z"); } }, { assertMayAppend: vi.fn().mockResolvedValue(undefined) }, { assertMayUseVisibility: vi.fn().mockResolvedValue(undefined) }, { assertMayAppend: vi.fn().mockResolvedValue(undefined) });

		await expect(writer.append({ sourceCommandId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", entry: { kind: "a2ui", surfaceId: "surface-1", a2uiSchemaVersion: "0.8", operation: "remove", payloadRef: null, payloadDigest: null, visibility: { audience: "conversation" }, causationId: "source-1", correlationId: "request-1" } })).resolves.toEqual(expect.objectContaining({ position: "1" }));
	});

	it("rejects an unanchored negative revision before it can append", async function _RejectsNegativeRevision()
	{
		const { append } = _Writer();
		const unanchored = new BoundConversationWriter({ append }, { ..._BINDING, expectedRevision: -1n }, { now: function _Now(): Date { return new Date("2026-09-02T00:00:00.000Z"); } }, { assertMayAppend: vi.fn() }, { assertMayUseVisibility: vi.fn() }, { assertMayAppend: vi.fn() });

		await expect(unanchored.append({ sourceCommandId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", entry: { kind: "a2ui", surfaceId: "surface-1", a2uiSchemaVersion: "0.8", operation: "remove", payloadRef: null, payloadDigest: null, visibility: { audience: "conversation" }, causationId: "source-1", correlationId: "request-1" } })).rejects.toThrow("creation-anchored");
		expect(append).not.toHaveBeenCalled();
	});

	it("refuses reuse and oversized entries before a second append", async function ()
	{
		const { writer, append } = _Writer();
		const command = { sourceCommandId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", entry: { kind: "a2ui" as const, surfaceId: "surface-1", a2uiSchemaVersion: "0.8", operation: "remove" as const, payloadRef: null, payloadDigest: null, visibility: { audience: "conversation" as const }, causationId: "source-1", correlationId: "request-1" } };
		await writer.append(command);

		await expect(writer.append(command)).rejects.toThrow("single-use");
		expect(append).toHaveBeenCalledTimes(1);
		const { writer: tooSmall, append: tooSmallAppend } = _Writer(1);
		await expect(tooSmall.append(command)).rejects.toThrow("maximum byte size");
		expect(tooSmallAppend).not.toHaveBeenCalled();
	});

	it("refuses an append after the bound lease has been replaced", async function ()
	{
		const { writer, append, assertLeaseMayAppend } = _Writer();
		assertLeaseMayAppend.mockRejectedValueOnce(new Error("Lease generation is stale"));
		const command = { sourceCommandId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", entry: { kind: "a2ui" as const, surfaceId: "surface-1", a2uiSchemaVersion: "0.8", operation: "remove" as const, payloadRef: null, payloadDigest: null, visibility: { audience: "conversation" as const }, causationId: "source-1", correlationId: "request-1" } };

		await expect(writer.append(command)).rejects.toThrow("Lease generation is stale");
		expect(append).not.toHaveBeenCalled();
	});

	it("permits only one in-flight append and reuses the exact stamped entry after a lost response", async function ()
	{
		let releaseRateLimit: (() => void) | undefined;
		const waitForRateLimit = new Promise<void>(function (resolve)
		{
			releaseRateLimit = resolve;
		});
		const append = vi.fn().mockRejectedValueOnce(new Error("Response lost")).mockResolvedValueOnce({ streamName: "conversation-conversation-1", revision: 8n });
		const assertMayAppend = vi.fn().mockReturnValueOnce(waitForRateLimit).mockResolvedValue(undefined);
		const assertMayUseVisibility = vi.fn().mockResolvedValue(undefined);
		const assertLeaseMayAppend = vi.fn().mockResolvedValue(undefined);
		const now = vi.fn().mockReturnValueOnce(new Date("2026-08-31T22:00:00.000Z")).mockReturnValueOnce(new Date("2026-08-31T22:01:00.000Z"));
		const writer = new BoundConversationWriter({ append }, _BINDING, { now }, { assertMayAppend }, { assertMayUseVisibility }, { assertMayAppend: assertLeaseMayAppend });
		const command = { sourceCommandId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", entry: { kind: "a2ui" as const, surfaceId: "surface-1", a2uiSchemaVersion: "0.8", operation: "remove" as const, payloadRef: null, payloadDigest: null, visibility: { audience: "conversation" as const }, causationId: "source-1", correlationId: "request-1" } };
		const firstAppend = writer.append(command);
		await Promise.resolve();

		await expect(writer.append(command)).rejects.toThrow("single-use");
		releaseRateLimit?.();
		await expect(firstAppend).rejects.toThrow("Response lost");
		const retryEntry = await writer.append({ ...command, entry: { ...command.entry, surfaceId: "ignored-on-retry" } });

		expect(assertMayAppend).toHaveBeenCalledTimes(1);
		expect(now).toHaveBeenCalledTimes(1);
		expect(append).toHaveBeenCalledTimes(2);
		expect(append.mock.calls[1]?.[0].events[0].data.entry).toEqual(append.mock.calls[0]?.[0].events[0].data.entry);
		expect(retryEntry.occurredAt).toBe("2026-08-31T22:00:00.000Z");
	});
});
