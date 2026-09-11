import { WrongExpectedVersionError } from "@kurrent/kurrentdb-client";
import { HistoryExpectedRevisions } from "@opencrane/backend/server/infra/history-store";
import { ConversationEntryKinds } from "@opencrane/contracts";
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

	it("rejects entries that attempt to replace the immutable genesis", async function ()
	{
		const append = vi.fn().mockResolvedValue({ streamName: "conversation-conversation-1", revision: 0n });
		const authority = new ConversationHistoryAuthority({ append });

		await expect(authority.append(_Command({ expectedRevision: HistoryExpectedRevisions.NoStream, entry: { ..._Command().entry, position: "0" } }))).rejects.toThrow("revision-zero genesis");
		expect(append).not.toHaveBeenCalled();
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

	it("atomically appends a participant message and checked computer activation", async function _AppendsActivation()
	{
		const appendAtomic = vi.fn().mockResolvedValue([{ streamName: "conversation-conversation-1", revision: 8n }, { streamName: "computer-activations-silo-1", revision: 3n }]);
		const authority = new ConversationHistoryAuthority({ append: vi.fn(), appendAtomic });
		const base = _Command();
		if (base.entry.kind !== ConversationEntryKinds.A2UI)
			throw new Error("test fixture requires an A2UI entry");
		const { surfaceId: _surface, a2uiSchemaVersion: _schema, operation: _operation, payloadRef: _payload, payloadDigest: _digest, ...common } = base.entry;
		const entry = { ...common, author: { kind: "human" as const, principalId: "principal-1", participantId: "subject-1", issuer: "https://issuer.test", authenticatedAt: "2026-09-01T00:00:00.000Z", name: "Jente", avatarArtifactRevisionId: null }, provenance: "human-authored" as const, runId: null, kind: "message" as const, state: "completed" as const, blocks: [{ id: "block-1", kind: "text" as const, payloadRef: "payload-1", ciphertextDigest: "sha256:payload" }], replyToEntryId: null, addressedAgentIdentityId: null, activation: "start" as const };
		const result = await authority.appendWithActivation({ ...base, entry, activation: { computerId: "computer-1", generation: 2, eventId: "9e60b5de-87a8-5c34-9cca-e6e4cb291369", queueExpectedRevision: 2n } });

		expect(result).toEqual({ outcome: ConversationHistoryAppendOutcomes.Appended, receipt: { streamName: "conversation-conversation-1", revision: 8n } });
		expect(appendAtomic).toHaveBeenCalledWith(expect.objectContaining({
			expectedHeads: [{ streamName: "conversation-conversation-1", revision: 7n }, { streamName: "computer-activations-silo-1", revision: 2n }],
			appends: expect.arrayContaining([expect.objectContaining({ streamName: "computer-activations-silo-1", events: [expect.objectContaining({ type: "opencrane.computer.activation-requested.v1", data: { action: "start", siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", generation: 2, causationPosition: "8" } })] })]),
		}));
	});

	it("derives stop from the validated human message and rejects non-message activation", async function _StopAction()
	{
		const appendAtomic = vi.fn().mockResolvedValue([{ streamName: "conversation-conversation-1", revision: 8n }, { streamName: "computer-activations-silo-1", revision: 0n }]);
		const authority = new ConversationHistoryAuthority({ append: vi.fn(), appendAtomic });
		const base = _Command();
		if (base.entry.kind !== ConversationEntryKinds.A2UI)
			throw new Error("test fixture requires an A2UI entry");
		const { surfaceId: _surface, a2uiSchemaVersion: _schema, operation: _operation, payloadRef: _payload, payloadDigest: _digest, ...common } = base.entry;
		const entry = { ...common, author: { kind: "human" as const, principalId: "principal-1", participantId: "subject-1", issuer: "https://issuer.test", authenticatedAt: "2026-09-01T00:00:00.000Z", name: "Jente", avatarArtifactRevisionId: null }, provenance: "human-authored" as const, runId: null, kind: "message" as const, state: "completed" as const, blocks: [{ id: "block-1", kind: "text" as const, payloadRef: "payload-1", ciphertextDigest: "sha256:payload" }], replyToEntryId: null, addressedAgentIdentityId: null, activation: "stop" as const };
		await authority.appendWithActivation({ ...base, entry, activation: { computerId: "computer-1", generation: 2, eventId: "9e60b5de-87a8-5c34-9cca-e6e4cb291369", queueExpectedRevision: HistoryExpectedRevisions.NoStream } });
		expect(appendAtomic).toHaveBeenCalledWith(expect.objectContaining({ appends: expect.arrayContaining([expect.objectContaining({ streamName: "computer-activations-silo-1", events: [expect.objectContaining({ data: expect.objectContaining({ action: "stop" }) })] })]) }));
		await expect(authority.appendWithActivation({ ...base, activation: { computerId: "computer-1", generation: 2, eventId: "9e60b5de-87a8-5c34-9cca-e6e4cb291369", queueExpectedRevision: HistoryExpectedRevisions.NoStream } })).rejects.toThrow("human start or stop message");
	});

	it("atomically appends a service receipt and its participant-visible transformation", async function _AppendsAttestation()
	{
		const receiptId = "9e60b5de-87a8-5c34-9cca-e6e4cb291369";
		const receiptStream = "conversation-approval-notification-approval-1";
		const appendAtomic = vi.fn().mockResolvedValue([{ streamName: receiptStream, revision: 0n }, { streamName: "conversation-conversation-1", revision: 8n }]);
		const authority = new ConversationHistoryAuthority({ append: vi.fn(), appendAtomic });
		const entry = { ..._Command().entry, author: { kind: "system" as const, systemId: "opencrane" as const, name: "OpenCrane" as const }, provenance: "service-attested" as const, attestation: { serviceId: "opencrane", receiptId, domainStream: receiptStream, domainRevision: "0", decisionEvidenceId: null } };
		const event = { id: receiptId, type: "opencrane.conversation-approval-notification.v1", data: { approvalId: "approval-1" }, metadata: {} };
		const result = await authority.appendWithAttestation({ ..._Command(), entry, attestation: { streamName: receiptStream, event } });

		expect(result).toEqual({ outcome: ConversationHistoryAppendOutcomes.Appended, receipt: { streamName: "conversation-conversation-1", revision: 8n } });
		expect(appendAtomic).toHaveBeenCalledWith(expect.objectContaining({ expectedHeads: [{ streamName: "conversation-conversation-1", revision: 7n }, { streamName: receiptStream, revision: HistoryExpectedRevisions.NoStream }], appends: expect.arrayContaining([expect.objectContaining({ streamName: receiptStream, expectedRevision: HistoryExpectedRevisions.NoStream, events: [event] })]) }));
	});
});
