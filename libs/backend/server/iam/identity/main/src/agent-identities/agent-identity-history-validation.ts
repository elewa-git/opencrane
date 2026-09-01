import { AgentIdentityStates, type AgentIdentity } from "@opencrane/contracts";
import type { HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";

import type { AgentIdentityCurrentCommand } from "./agent-identity-history.types";

/** Names the one versioned event schema this history authority accepts. */
const _AGENT_IDENTITY_EVENT_TYPE = "opencrane.agent-identity.v1";
/** Recognizes the UUID event identifiers that HistoryStore uses for idempotent appends. */
const _UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Derives the one stream that may represent an identity without accepting a caller-selected stream. */
export function _AgentIdentityStreamName(identityId: string): string
{
	if (!_Identifier(identityId))
		throw new Error("Agent identity history requires a server-provided identity identifier");
	return `agent-identity-${identityId}`;
}

/** Validates the trusted request tuple before it can select a durable history stream. */
export function _ValidateCurrentAgentIdentityCommand(command: AgentIdentityCurrentCommand): void
{
	if (!_Identifier(command.siloId))
		throw new Error("Agent identity history load requires a server-provided silo identifier");
	if (!_Identifier(command.agentIdentityId))
		throw new Error("Agent identity history load requires a server-provided identity identifier");
	if (!_Identifier(command.agentServiceId))
		throw new Error("Agent identity history load requires a server-provided agent service identifier");
	if (!_PrincipalIdentifier(command.principalId))
		throw new Error("Agent identity history load requires a server-provided principal identifier");
}

/** Validates one envelope and snapshot before it can contribute to current identity state. */
export function _ValidatedAgentIdentityStreamEvent(event: HistoryRecordedEvent, streamName: string, expectedRevision: bigint): AgentIdentity
{
	if (event.streamName !== streamName)
		throw new Error("Agent identity history received an event from a different stream");
	if (event.revision !== expectedRevision)
		throw new Error("Agent identity history received a noncontiguous stream revision");
	if (event.type !== _AGENT_IDENTITY_EVENT_TYPE)
		throw new Error("Agent identity history received an unsupported event type");
	if (!_UUID_PATTERN.test(event.id))
		throw new Error("Agent identity history received an event with an invalid identifier");
	const identity = _ValidatedAgentIdentity(event.data.identity);
	if (event.metadata.siloId !== identity.siloId || event.metadata.agentIdentityId !== identity.id || event.metadata.agentServiceId !== identity.agentServiceId || event.metadata.principalId !== _AgentIdentityPrincipalId(identity) || event.metadata.kind !== identity.kind)
		throw new Error("Agent identity history received an event that does not match its envelope");
	if (_AgentIdentityStreamName(identity.id) !== streamName)
		throw new Error("Agent identity history received an identity for a different stream");
	return identity;
}

/** Checks the requested identity coordinates after a stream-derived snapshot has been fully validated. */
export function _AssertAgentIdentityCurrentCoordinates(identity: AgentIdentity, command: AgentIdentityCurrentCommand): void
{
	if (identity.siloId !== command.siloId)
		throw new Error("Agent identity history received an identity from a different silo");
	if (identity.id !== command.agentIdentityId)
		throw new Error("Agent identity history received a different identity");
	if (identity.agentServiceId !== command.agentServiceId)
		throw new Error("Agent identity history received an identity for a different agent service");
	if (_AgentIdentityPrincipalId(identity) !== command.principalId)
		throw new Error("Agent identity history received an identity for a different principal");
}

/** Parses the exact discriminated AgentIdentity shape without granting unknown future kinds authority. */
export function _ValidatedAgentIdentity(value: unknown): AgentIdentity
{
	if (!_Record(value))
		throw new Error("Agent identity history requires a valid discriminated identity");
	if (value.kind !== "proxied" && value.kind !== "managed" && value.kind !== "managed_subchat")
		throw new Error("Agent identity history received an unsupported identity kind");
	if (!_ExactKeys(value, _BaseKeys(value.kind)))
		throw new Error("Agent identity history requires a valid discriminated identity");
	if (value.schemaVersion !== 1 || !_Identifier(value.id) || !_Identifier(value.siloId) || !_Identifier(value.agentServiceId) || !_Identifier(value.name) || (value.avatarArtifactRevisionId !== null && !_Identifier(value.avatarArtifactRevisionId)) || !_IdentityState(value.state) || !_PrincipalIdentifier(value.createdByPrincipalId) || !_IsoTimestamp(value.createdAt))
		throw new Error("Agent identity history requires valid common identity coordinates");

	switch (value.kind)
	{
		case "proxied":
			if (!_PrincipalIdentifier(value.proxiedPrincipalId) || !_Identifier(value.delegationPolicyId))
				throw new Error("Agent identity history requires valid proxied identity coordinates");
			return value as unknown as AgentIdentity;
		case "managed":
			if (!_PrincipalIdentifier(value.principalId))
				throw new Error("Agent identity history requires a managed identity principal");
			return value as unknown as AgentIdentity;
		case "managed_subchat":
			if (!_PrincipalIdentifier(value.principalId) || !_Identifier(value.parentAgentIdentityId) || !_PrincipalIdentifier(value.parentPrincipalId) || !_Identifier(value.parentConversationId) || !_Identifier(value.conversationId) || !_PrincipalIdentifier(value.requestedByPrincipalId))
				throw new Error("Agent identity history requires complete managed sub-chat coordinates");
			if (value.parentAgentIdentityId === value.id || value.parentPrincipalId === value.principalId || value.parentConversationId === value.conversationId)
				throw new Error("Agent identity history requires a managed sub-chat to remain distinct from its parent");
			return value as unknown as AgentIdentity;
	}
}

/** Extracts the authority principal for every closed identity kind. */
export function _AgentIdentityPrincipalId(identity: AgentIdentity): string
{
	if (identity.kind === "proxied")
		return identity.proxiedPrincipalId;
	return identity.principalId;
}

/** Preserves the coordinates that one identity stream may never change between snapshots. */
export function _SameAgentIdentityCoordinates(first: AgentIdentity, current: AgentIdentity): boolean
{
	if (first.schemaVersion !== current.schemaVersion || first.id !== current.id || first.siloId !== current.siloId || first.agentServiceId !== current.agentServiceId || first.kind !== current.kind || first.createdByPrincipalId !== current.createdByPrincipalId || first.createdAt !== current.createdAt || _AgentIdentityPrincipalId(first) !== _AgentIdentityPrincipalId(current))
		return false;
	if (first.kind === "proxied" && current.kind === "proxied")
		return first.delegationPolicyId === current.delegationPolicyId;
	if (first.kind === "managed_subchat" && current.kind === "managed_subchat")
		return first.parentAgentIdentityId === current.parentAgentIdentityId && first.parentPrincipalId === current.parentPrincipalId && first.parentConversationId === current.parentConversationId && first.conversationId === current.conversationId && first.requestedByPrincipalId === current.requestedByPrincipalId;
	return true;
}

/** Builds the exact allowed key set for one closed identity kind. */
function _BaseKeys(kind: "proxied" | "managed" | "managed_subchat"): readonly string[]
{
	const common = ["schemaVersion", "id", "siloId", "agentServiceId", "name", "avatarArtifactRevisionId", "state", "createdByPrincipalId", "createdAt", "kind"];
	if (kind === "proxied")
		return [...common, "proxiedPrincipalId", "delegationPolicyId"];
	if (kind === "managed")
		return [...common, "principalId"];
	return [...common, "principalId", "parentAgentIdentityId", "parentPrincipalId", "parentConversationId", "conversationId", "requestedByPrincipalId"];
}

/** Checks a plain object has exactly the expected closed contract keys. */
function _ExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean
{
	const actual = Object.keys(value);
	return actual.length === keys.length && actual.every(key => keys.includes(key));
}

/** Checks a nonempty trusted identifier without normalizing the durable coordinate. */
function _Identifier(value: unknown): value is string
{
	return typeof value === "string" && value.trim().length > 0 && value === value.trim();
}

/** Rejects retired agent-service sentinels wherever a durable principal identity is required. */
function _PrincipalIdentifier(value: unknown): value is string
{
	return _Identifier(value) && !value.startsWith("agent-service:");
}

/** Checks the exact current AgentIdentity state set. */
function _IdentityState(value: unknown): value is AgentIdentityStates
{
	return value === AgentIdentityStates.Active || value === AgentIdentityStates.Suspended || value === AgentIdentityStates.Revoked;
}

/** Checks the ISO timestamp representation stored in the shared AgentIdentity contract. */
function _IsoTimestamp(value: unknown): value is string
{
	return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/** Narrows one unknown HistoryStore payload to a JSON-object candidate. */
function _Record(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
