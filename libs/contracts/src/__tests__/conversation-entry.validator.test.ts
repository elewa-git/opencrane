import { describe, expect, it } from "vitest";
import { ___ConversationComputerEntrySchema, ___ConversationEntrySchema, ConversationAuthorKinds, ConversationEntryKinds, ConversationMessageContentBlockKinds, MessageStates } from "../index";
import type { A2UIRemoveEntry, ConversationEntry, MessageEntry, ToolCallLogEntry } from "../index";

const _BASE = {
	schemaVersion: 1 as const,
	id: "entry-1",
	conversationId: "conversation-1",
	position: "12",
	author: {
		kind: ConversationAuthorKinds.Agent,
		agentIdentityId: "identity-1",
		agentServiceId: "service-1",
		name: "Archive",
		avatarArtifactRevisionId: null,
	},
	provenance: "agent-authored" as const,
	visibility: { audience: "conversation" as const },
	runId: "run-1",
	causationId: "command-1",
	correlationId: "request-1",
	idempotencyKey: "source-event-1",
	occurredAt: "2026-08-31T20:00:00.000Z",
	attestation: null,
} as const;

describe("conversation entry validation", function ()
{
	it("requires verified requester evidence on human-authored entries", function ()
	{
		const human = {
			..._BASE,
			author: {
				kind: ConversationAuthorKinds.Human,
				principalId: "principal-1",
				participantId: "participant-1",
				issuer: "https://issuer.test",
				authenticatedAt: "2026-09-05T00:00:00.000Z",
				name: "Jente",
				avatarArtifactRevisionId: null,
			},
			provenance: "human-authored",
			runId: null,
			kind: ConversationEntryKinds.Message,
			state: MessageStates.Completed,
			blocks: [{
				id: "text-1",
				kind: ConversationMessageContentBlockKinds.Text,
				payloadRef: "payload-1",
				ciphertextDigest: "sha256:payload",
			}],
			replyToEntryId: null,
			addressedAgentIdentityId: null,
			activation: "start",
		};
		expect(___ConversationEntrySchema.safeParse(human).success).toBe(true);
		expect(___ConversationEntrySchema.safeParse({ ...human, author: { ...human.author, authenticatedAt: undefined } }).success).toBe(false);
	});

	it("keeps encrypted message payloads and display-safe artifact references distinct", function ()
	{
		const entry: MessageEntry = {
			..._BASE,
			kind: ConversationEntryKinds.Message,
			state: MessageStates.Completed,
			blocks: [
				{
					id: "text-1",
					kind: ConversationMessageContentBlockKinds.Text,
					payloadRef: "payload-1",
					ciphertextDigest: "sha256:payload",
				},
				{
					id: "artifact-1",
					kind: ConversationMessageContentBlockKinds.Artifact,
					artifactId: "artifact-1",
					artifactRevisionId: "revision-1",
					name: "report.pdf",
					mediaType: "application/pdf",
				},
			],
			replyToEntryId: null,
			addressedAgentIdentityId: "identity-1",
			activation: "start",
		};

		expect(entry.blocks[0]).toMatchObject({ kind: ConversationMessageContentBlockKinds.Text, payloadRef: "payload-1" });
		expect(entry.blocks[1]).toMatchObject({ kind: ConversationMessageContentBlockKinds.Artifact, artifactRevisionId: "revision-1" });
	});

	it("keeps participant-visible content block wire values distinct from transcript tool blocks", function ()
	{
		expect(ConversationMessageContentBlockKinds).toEqual({
			Text: "text",
			Artifact: "artifact",
			Mention: "mention",
		});
		const mention = {
			..._BASE,
			kind: ConversationEntryKinds.Message,
			state: MessageStates.Completed,
			blocks: [{
				id: "mention-1",
				kind: ConversationMessageContentBlockKinds.Mention,
				targetKind: "agent",
				targetId: "identity-1",
				name: "Archive",
			}],
			replyToEntryId: null,
			addressedAgentIdentityId: "identity-1",
			activation: "none",
		};

		expect(___ConversationEntrySchema.safeParse(mention).success).toBe(true);
		expect(___ConversationEntrySchema.safeParse({ ...mention, blocks: [{ id: "tool-1", kind: "tool_call", value: "hidden" }] }).success).toBe(false);
	});

	it("requires each structured log to name one explicit subtype", function ()
	{
		const entry: ToolCallLogEntry = {
			..._BASE,
			id: "entry-2",
			kind: ConversationEntryKinds.Log,
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
			kind: ConversationEntryKinds.A2UI,
			surfaceId: "approval-1",
			a2uiSchemaVersion: "0.8",
			operation: "remove",
			payloadRef: null,
			payloadDigest: null,
		};
		const entries: readonly ConversationEntry[] = [entry];

		expect(entries[0]).toMatchObject({
			kind: ConversationEntryKinds.A2UI,
			operation: "remove",
			payloadRef: null,
		});
	});

	it("rejects duplicate participant visibility and a fabricated A2UI removal payload", function ()
	{
		const invalid = {
			..._BASE,
			kind: ConversationEntryKinds.A2UI,
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
			kind: ConversationEntryKinds.Log,
			author: {
				kind: ConversationAuthorKinds.Service,
				serviceId: "artifact-service",
				name: "Artifact service",
			},
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
			kind: ConversationEntryKinds.Log,
			provenance: "agent-authored",
			attestation: {
				serviceId: "payments",
				receiptId: "forged",
				domainStream: "effects-1",
				domainRevision: "7",
				decisionEvidenceId: null,
			},
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
			kind: ConversationEntryKinds.Log,
			author: {
				kind: ConversationAuthorKinds.System,
				systemId: "opencrane",
				name: "OpenCrane",
			},
			provenance: "service-attested",
			summary: "The conversation was closed.",
			detailsRef: null,
			logKind: "run",
			phase: "completed",
		};

		expect(___ConversationEntrySchema.safeParse(invalid).success).toBe(false);
	});
});
