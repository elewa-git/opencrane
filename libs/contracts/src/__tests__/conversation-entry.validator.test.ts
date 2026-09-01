import { describe, expect, it } from "vitest";
import { ___ConversationComputerEntrySchema, ___ConversationEntrySchema } from "../index";
import { ConversationElicitationEntryKinds, ConversationElicitationEntryStates, ConversationEntryKinds } from "../index";
import type { A2UIRemoveEntry, ConversationEntry, ElicitationRequestEntry, ElicitationResolutionEntry, MessageEntry, ToolCallLogEntry } from "../index";

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

const _ELICITATION_BASE = {
	schemaVersion: 1 as const,
	conversationId: "conversation-1",
	position: "13",
	author: { kind: "system" as const, systemId: "opencrane" as const, name: "OpenCrane" as const },
	provenance: "service-attested" as const,
	visibility: { audience: "participant_subset" as const, participantIds: ["participant-1"] },
	causationId: "command-elicitation-1",
	correlationId: "request-elicitation-1",
	idempotencyKey: "source-elicitation-1",
	occurredAt: "2026-08-31T20:00:00.000Z",
	attestation: { serviceId: "opencrane", receiptId: "receipt-elicitation-1", domainStream: "authorization-1", domainRevision: "12", decisionEvidenceId: "decision-1" },
	elicitationId: "elicitation-1",
	computerId: "computer-1",
	computerExecutionId: "computer-execution-1",
	leaseGeneration: 2,
	elicitationKind: ConversationElicitationEntryKinds.RuntimeInput,
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

	it("accepts only a server-attested opaque elicitation request", function ()
	{
		const entry: ElicitationRequestEntry = {
			..._ELICITATION_BASE,
			id: "entry-elicitation-1",
			kind: ConversationEntryKinds.Elicitation,
			state: ConversationElicitationEntryStates.Requested,
			profileRevisionId: "profile-1",
		addressedParticipantId: "participant-1",
			requestPayloadRef: "payload://elicitation-request-1",
			requestPayloadDigest: `sha256:${"a".repeat(64)}`,
			expiresAt: "2026-08-31T20:05:00.000Z",
		};

		expect(___ConversationEntrySchema.safeParse(entry).success).toBe(true);
		expect(___ConversationComputerEntrySchema.safeParse(entry).success).toBe(false);
	});

	it("accepts opaque answers and rejects plaintext or incomplete response data", function ()
	{
		const answer: ElicitationResolutionEntry = {
			..._ELICITATION_BASE,
			id: "entry-elicitation-2",
			kind: ConversationEntryKinds.Elicitation,
			state: ConversationElicitationEntryStates.Answered,
			requestEntryId: "entry-elicitation-1",
			responsePayloadRef: "payload://elicitation-response-1",
			responsePayloadDigest: `sha256:${"b".repeat(64)}`,
		};
		const missingPayloadReference = { ...answer, responsePayloadRef: null };
		const missingPayloadDigest = { ...answer, responsePayloadDigest: null };
		const plaintext = { ...answer, responseText: "Approve payment" };
		const plaintextReference = { ...answer, responsePayloadRef: "Approve payment" };

		expect(___ConversationEntrySchema.safeParse(answer).success).toBe(true);
		expect(___ConversationEntrySchema.safeParse(missingPayloadReference).success).toBe(false);
		expect(___ConversationEntrySchema.safeParse(missingPayloadDigest).success).toBe(false);
		expect(___ConversationEntrySchema.safeParse(plaintext).success).toBe(false);
		expect(___ConversationEntrySchema.safeParse(plaintextReference).success).toBe(false);
	});

	it("keeps governed tool and memory decisions in the target elicitation vocabulary", function ()
	{
		const governedKinds = [ConversationElicitationEntryKinds.ToolApproval, ConversationElicitationEntryKinds.PersonalMemoryPermission] as const;

		for (const elicitationKind of governedKinds)
		{
			const entry: ElicitationResolutionEntry = {
				..._ELICITATION_BASE,
				id: `entry-${elicitationKind}`,
				kind: ConversationEntryKinds.Elicitation,
				elicitationKind,
				state: ConversationElicitationEntryStates.Declined,
				requestEntryId: `request-${elicitationKind}`,
				responsePayloadRef: null,
				responsePayloadDigest: null,
			};

			expect(___ConversationEntrySchema.safeParse(entry).success).toBe(true);
		}

		const unsupported = { ..._ELICITATION_BASE, id: "entry-unsupported-elicitation", kind: ConversationEntryKinds.Elicitation, elicitationKind: "recovery_required", state: ConversationElicitationEntryStates.Declined, requestEntryId: "request-unsupported-elicitation", responsePayloadRef: null, responsePayloadDigest: null };

		expect(___ConversationEntrySchema.safeParse(unsupported).success).toBe(false);
	});

	it("rejects every partial response coordinate on terminal non-answer outcomes", function ()
	{
		const terminalStates = [ConversationElicitationEntryStates.Declined, ConversationElicitationEntryStates.Expired, ConversationElicitationEntryStates.Cancelled] as const;

		for (const state of terminalStates)
		{
			const terminal: ElicitationResolutionEntry = {
				..._ELICITATION_BASE,
				id: `entry-${state}`,
				kind: ConversationEntryKinds.Elicitation,
				state,
				requestEntryId: `request-${state}`,
				responsePayloadRef: null,
				responsePayloadDigest: null,
			};

			expect(___ConversationEntrySchema.safeParse(terminal).success).toBe(true);
			expect(___ConversationEntrySchema.safeParse({ ...terminal, responsePayloadRef: "payload://stale" }).success).toBe(false);
			expect(___ConversationEntrySchema.safeParse({ ...terminal, responsePayloadDigest: `sha256:${"c".repeat(64)}` }).success).toBe(false);
		}
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
