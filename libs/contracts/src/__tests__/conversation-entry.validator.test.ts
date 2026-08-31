import { describe, expect, it } from "vitest";
import { ___ConversationComputerEntrySchema, ___ConversationEntrySchema } from "../index";
import type { A2UIRemoveEntry, ConversationEntry, MessageEntry, ToolCallLogEntry } from "../index";

const _BASE = {
	schemaVersion: 1 as const,
	id: "entry-1",
	conversationId: "conversation-1",
	position: "12",
	author: { kind: "agent" as const, agentIdentityId: "identity-1", agentServiceId: "service-1", name: "Archive", avatarArtifactRevisionId: null },
	provenance: "agent-authored" as const,
	visibility: { audience: "conversation" as const },
	runId: "run-1",
	causationId: "command-1",
	correlationId: "request-1",
	idempotencyKey: "source-event-1",
	occurredAt: "2026-08-31T20:00:00.000Z",
	attestation: null,
};

describe("conversation entry validation", function ()
{
	it("keeps encrypted message payloads and display-safe artifact references distinct", function ()
	{
		const entry: MessageEntry = {
			..._BASE,
			kind: "message",
			state: "completed",
			blocks: [
				{ id: "text-1", kind: "text", payloadRef: "payload-1", ciphertextDigest: "sha256:payload" },
				{ id: "artifact-1", kind: "artifact", artifactId: "artifact-1", artifactRevisionId: "revision-1", name: "report.pdf", mediaType: "application/pdf" },
			],
			replyToEntryId: null,
			addressedAgentIdentityId: "identity-1",
			activation: "start",
		};

		expect(entry.blocks[0]).toMatchObject({ kind: "text", payloadRef: "payload-1" });
		expect(entry.blocks[1]).toMatchObject({ kind: "artifact", artifactRevisionId: "revision-1" });
	});

	it("requires each structured log to name one explicit subtype", function ()
	{
		const entry: ToolCallLogEntry = {
			..._BASE,
			id: "entry-2",
			kind: "log",
			logKind: "tool_call",
			summary: "Published the verified report.",
			detailsRef: "details-1",
			toolCallId: "tool-call-1",
			toolKind: "oci",
			toolName: "report-publisher",
			phase: "completed",
			resultArtifactRevisionId: "revision-1",
		};

		expect(entry.logKind).toBe("tool_call");
		expect(entry.phase).toBe("completed");
	});

	it("models A2UI removal without an obsolete payload", function ()
	{
		const entry: A2UIRemoveEntry = {
			..._BASE,
			id: "entry-3",
			kind: "a2ui",
			surfaceId: "approval-1",
			a2uiSchemaVersion: "0.8",
			operation: "remove",
			payloadRef: null,
			payloadDigest: null,
		};
		const entries: readonly ConversationEntry[] = [entry];

		expect(entries[0]).toMatchObject({ kind: "a2ui", operation: "remove", payloadRef: null });
	});

	it("rejects duplicate participant visibility and a fabricated A2UI removal payload", function ()
	{
		const invalid = {
			..._BASE,
			kind: "a2ui",
			visibility: { audience: "participant_subset", participantIds: ["participant-1", "participant-1"] },
			surfaceId: "approval-1",
			a2uiSchemaVersion: "0.8",
			operation: "remove",
			payloadRef: "payload-1",
			payloadDigest: "sha256:payload",
		};

		expect(___ConversationEntrySchema.safeParse(invalid).success).toBe(false);
	});

	it("requires an attestation for an entry that claims service authority", function ()
	{
		const invalid = {
			..._BASE,
			kind: "log",
			author: { kind: "service", serviceId: "artifact-service", name: "Artifact service" },
			provenance: "service-attested",
			summary: "Published an artifact.",
			detailsRef: null,
			logKind: "artifact",
			artifactId: "artifact-1",
			artifactRevisionId: "revision-1",
			phase: "published",
		};

		expect(___ConversationEntrySchema.safeParse(invalid).success).toBe(false);
	});

	it("refuses a computer attempt to fabricate a service receipt", function ()
	{
		const forged = {
			..._BASE,
			kind: "log",
			provenance: "agent-authored",
			attestation: { serviceId: "payments", receiptId: "forged", domainStream: "effects-1", domainRevision: "7", decisionEvidenceId: null },
			summary: "Payment completed.",
			detailsRef: null,
			logKind: "tool_call",
			toolCallId: "tool-call-1",
			toolKind: "oci",
			toolName: "payment-runner",
			phase: "completed",
			resultArtifactRevisionId: null,
		};

		expect(___ConversationEntrySchema.safeParse(forged).success).toBe(true);
		expect(___ConversationComputerEntrySchema.safeParse(forged).success).toBe(false);
	});

	it("requires the OpenCrane receipt behind a system author", function ()
	{
		const invalid = {
			..._BASE,
			kind: "log",
			author: { kind: "system", systemId: "opencrane", name: "OpenCrane" },
			provenance: "service-attested",
			summary: "The conversation was closed.",
			detailsRef: null,
			logKind: "run",
			phase: "completed",
		};

		expect(___ConversationEntrySchema.safeParse(invalid).success).toBe(false);
	});
});
