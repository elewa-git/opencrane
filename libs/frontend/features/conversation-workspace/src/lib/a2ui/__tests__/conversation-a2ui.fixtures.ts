import type { A2UIEntry, A2UIWriteEntry, ConversationA2uiComponent } from "@opencrane/contracts";
import type { ConversationA2uiMessage } from "../conversation-a2ui-message.types";

/** Makes saved history fixtures, not an agent producer or authorization bypass. */
export function _DisplayEntry(position = 1, overrides: Partial<A2UIWriteEntry> = {}): A2UIWriteEntry
{
	return { schemaVersion: 1, id: `display-${position}`, conversationId: "conversation-1", position: String(position), author: { kind: "agent", agentIdentityId: "agent-1", agentServiceId: "service-1", name: "Nova", avatarArtifactRevisionId: null }, provenance: "agent-authored", visibility: { audience: "conversation" }, runId: "run-private", causationId: "cause-private", correlationId: "correlation-private", idempotencyKey: `display-${position}`, occurredAt: "2026-09-22T10:00:00.000Z", attestation: null, kind: "a2ui", surfaceId: "inventory", a2uiSchemaVersion: "0.8", operation: "replace", payloadRef: `payload-${position}`, payloadDigest: "sha256:fixture", ...overrides };
}

/** Removal explicitly carries no payload reference. */
export function _RemoveEntry(position = 2): A2UIEntry
{
	return { ..._DisplayEntry(position), operation: "remove", payloadRef: null, payloadDigest: null };
}

/** Builds a literal Text definition with ids intentionally colliding with common text. */
export function _TextComponent(id = "body", text = "body"): ConversationA2uiComponent
{
	return { id, component: { Text: { text: { literalString: text }, usageHint: "body" } } };
}

/** Uses the official v0.8 messages in the display adapter's JSON-array framing. */
export function _DisplayMessages(components: ConversationA2uiComponent[] = [_TextComponent()], root = "body"): ConversationA2uiMessage[]
{
	return [{ surfaceUpdate: { surfaceId: "inventory", components } }, { beginRendering: { surfaceId: "inventory", root } }];
}
