import { createHash } from "node:crypto";
import type { AgentSessionCoordinates } from "./agent-session-creation.types";
import type { ConversationCaller } from "../authorization/conversation-caller.types";

/**
 * Gives each creation command its own conversation and computer while reusing the personal identity.
 * Called by: PrismaAgentSessionCreationUnitOfWork.resolve after validating the command UUID.
 * The same key with a changed agent target addresses the same history, whose genesis rejects it.
 * @see AgentSessionHistory.establish
 */
export function _AgentSessionCoordinates(caller: ConversationCaller, agentServiceId: string, idempotencyKey: string): AgentSessionCoordinates
{
	const conversationId = _DeterministicUuid("conversation", caller.siloId, caller.principalId, idempotencyKey.toLowerCase());
	return { conversationId, agentIdentityId: _DeterministicUuid("agent-identity", caller.siloId, caller.principalId, agentServiceId), computerId: `computer-${_DeterministicUuid("conversation-computer", conversationId)}` };
}

/** Derives an RFC 4122 version-five-shaped UUID from stable coordinates. */
export function _DeterministicUuid(namespace: string, ...coordinates: readonly string[]): string
{
	const bytes = Buffer.from(createHash("sha256").update([namespace, ...coordinates].join("\u0000"), "utf8").digest().subarray(0, 16));
	bytes[6] = (bytes[6]! & 0x0f) | 0x50;
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
