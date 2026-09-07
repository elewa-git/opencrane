import { describe, expect, it } from "vitest";

import type { MessageEntry } from "@opencrane/contracts";
import { ConversationLifecycles, ConversationModes } from "@opencrane/models/conversations";
import type { ConversationWorkspaceDetail } from "@opencrane/state/conversation/workspace";

import { _GroupRequestSource, _GroupShareSource } from "../conversation-group.mapper";

/** Represents metadata read for the selected group. */
const _GROUP: ConversationWorkspaceDetail = { id: "group", mode: ConversationModes.Group, lifecycle: ConversationLifecycles.Open, agentServiceId: null, participantRefs: ["membership-id"], parent: null, archivedAt: null, readThroughPosition: "0", updatedAt: "2026-09-07T00:00:00.000Z", visibleFromPosition: "1", accessEndedPosition: null };
/** Captures an own human message with a subject distinct from its membership row ID. */
const _ENTRY: MessageEntry = { schemaVersion: 1, id: "57de859d-1fb6-4782-aa0b-2b3d4dfd2292", conversationId: "group", position: "2", author: { kind: "human", principalId: "principal", participantId: "subject", issuer: "https://issuer.example", authenticatedAt: "2026-09-07T00:00:00.000Z", name: "Amina", avatarArtifactRevisionId: null }, provenance: "human-authored", visibility: { audience: "conversation" }, runId: null, causationId: "command", correlationId: "group", idempotencyKey: "57de859d-1fb6-4782-aa0b-2b3d4dfd2292", occurredAt: "2026-09-07T00:00:00.000Z", attestation: null, kind: "message", state: "completed", blocks: [{ id: "block", kind: "text", payloadRef: "text", ciphertextDigest: "sha256:story" }], replyToEntryId: null, addressedAgentIdentityId: null, activation: "none" };

describe("group message actions", function _Describe()
{
	it("offers an assistant request for the session subject's message, never by membership ID or display name", function _Own()
	{
		expect(_GroupRequestSource(_ENTRY, { text: "Request" }, _GROUP, "subject")).toEqual({ entryId: _ENTRY.id, position: "2", text: "Request" });
		for (const subject of [undefined, "membership-id", "Amina", "another-subject"])
			expect(_GroupRequestSource(_ENTRY, { text: "Request" }, _GROUP, subject)).toBeNull();
	});
	it("refuses private audiences, missing content, incomplete messages, and another conversation", function _Refuse()
	{
		const entries: MessageEntry[] = [{ ..._ENTRY, visibility: { audience: "participant_subset", participantIds: ["subject"] } }, { ..._ENTRY, state: "streaming" }, { ..._ENTRY, conversationId: "other" }];
		for (const entry of entries)
			expect(_GroupRequestSource(entry, { text: "Request" }, _GROUP, "subject")).toBeNull();
		expect(_GroupRequestSource(_ENTRY, {}, _GROUP, "subject")).toBeNull();
		expect(_GroupRequestSource(_ENTRY, { text: "Request" }, { ..._GROUP, lifecycle: ConversationLifecycles.Closed }, "subject")).toBeNull();
	});
	it("requires a completed assistant response and a real parent before offering human share review", function _Share()
	{
		const child = { ..._GROUP, id: "child", mode: ConversationModes.AgentSession, agentServiceId: "company", parent: { requestId: _ENTRY.id, parentConversationId: "group", parentMessageId: _ENTRY.id, parentMessagePosition: "2" } };
		const response: MessageEntry = { ..._ENTRY, conversationId: "child", provenance: "agent-authored", author: { kind: "agent", agentIdentityId: "identity", agentServiceId: "company", name: "Research", avatarArtifactRevisionId: null } };
		expect(_GroupShareSource(response, { text: "Conclusion" }, child)?.text).toBe("Conclusion");
		expect(_GroupShareSource({ ...response, state: "failed" }, { text: "Partial" }, child)).toBeNull();
		expect(_GroupShareSource({ ..._ENTRY, conversationId: "child" }, { text: "Human" }, child)).toBeNull();
		expect(_GroupShareSource(response, { text: "Conclusion" }, { ...child, parent: null })).toBeNull();
	});
});
