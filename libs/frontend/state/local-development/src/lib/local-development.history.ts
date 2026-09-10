import { MessageContentBlockKinds, type MessageEntry } from "@opencrane/contracts";
import { type GroupChildOrigin, type GroupChildShareCommand } from "@opencrane/models/conversations";
import { type SubmitConversationMessageCommand } from "@opencrane/state/conversation/workspace";
import { __CreateConversationHistoryProjection, type ConversationHistoryProjection } from "@opencrane/state/conversation/stream";

import { __LOCAL_DEVELOPMENT_BOOTSTRAPS } from "./local-development.fixtures";
import type { _LocalDevelopmentState } from "./local-development.owner.types";
import { LocalDevelopmentScenarios } from "./local-development.types";

/** Stable timestamp that keeps local history tests and screenshots deterministic. */
const _NOW = "2026-09-10T09:00:00.000Z";

/** Stable personal-Agent conversation whose failed-run projection must contain no successful output. */
const _PERSONAL_AGENT_CONVERSATION_ID = "conversation-agent";

/** Creates one completed assistant entry for a deterministic successful workspace. */
function _AssistantEntry(state: Pick<_LocalDevelopmentState, "archetype">, conversationId: string, agent?: { readonly agentServiceId: string; readonly displayName: string }): MessageEntry
{
	const fixture = __LOCAL_DEVELOPMENT_BOOTSTRAPS[state.archetype];
	const author = agent ?? { agentServiceId: `local-agent-${state.archetype}`, displayName: fixture.displayName };
	return { schemaVersion: 1, id: `local-message-assistant-${conversationId}`, conversationId, position: "1", author: { kind: "agent", agentIdentityId: `local-identity-${state.archetype}`, agentServiceId: author.agentServiceId, name: author.displayName, avatarArtifactRevisionId: null }, provenance: "agent-authored", visibility: { audience: "conversation" }, runId: null, causationId: "local-seed", correlationId: conversationId, idempotencyKey: `local-seed-${conversationId}`, occurredAt: _NOW, attestation: null, kind: "message", state: "completed", blocks: [{ id: `local-block-assistant-${conversationId}`, kind: MessageContentBlockKinds.Text, payloadRef: `local-payload-assistant-${conversationId}`, ciphertextDigest: "sha256:local-development" }], replyToEntryId: null, addressedAgentIdentityId: null, activation: "none" };
}

/** Carries the verified lineage that distinguishes a reviewed child result from a plain message. */
interface _LocalDevelopmentMessageLineage
{
	readonly causationId: string;
	readonly correlationId: string;
	readonly replyToEntryId: string;
}

/** Builds one human-authored immutable entry from a current composer command. */
function _ParticipantEntry(command: SubmitConversationMessageCommand, position: string, lineage?: _LocalDevelopmentMessageLineage): MessageEntry
{
	const payloadRef = `local-payload-${command.idempotencyKey}`;
	const causationId = lineage?.causationId ?? command.idempotencyKey;
	const correlationId = lineage?.correlationId ?? command.conversationId;
	const replyToEntryId = lineage?.replyToEntryId ?? null;
	return { schemaVersion: 1, id: command.idempotencyKey, conversationId: command.conversationId, position, author: { kind: "human", principalId: "local-principal", participantId: "local-developer", issuer: "https://local-development.opencrane.invalid", authenticatedAt: _NOW, name: "Local developer", avatarArtifactRevisionId: null }, provenance: "human-authored", visibility: { audience: "conversation" }, runId: null, causationId, correlationId, idempotencyKey: command.idempotencyKey, occurredAt: _NOW, attestation: null, kind: "message", state: "completed", blocks: [{ id: `local-block-${command.idempotencyKey}`, kind: MessageContentBlockKinds.Text, payloadRef, ciphertextDigest: "sha256:local-development" }], replyToEntryId, addressedAgentIdentityId: null, activation: command.activation };
}

/** Reads the text payload reference created by the local participant helper. */
function _TextPayloadRef(entry: MessageEntry): string
{
	const block = entry.blocks.find(candidate => candidate.kind === MessageContentBlockKinds.Text);
	if (block === undefined)
	{
		throw new Error("The local message did not contain its required text block.");
	}

	return block.payloadRef;
}

/**
 * Creates the initial immutable-history projection for one local conversation.
 *
 * The failed-run personal session stays empty because that scenario exists to exercise terminal
 * failure without a fabricated successful assistant result. Other deterministic conversations keep
 * one reviewed assistant entry so their current workspace controls have a stable source message.
 *
 * Called by: the local owner reset and group-child creation boundary.
 */
export function _CreateLocalDevelopmentHistory(state: Pick<_LocalDevelopmentState, "archetype" | "scenario">, conversationId: string, agent?: { readonly agentServiceId: string; readonly displayName: string }): ConversationHistoryProjection
{
	if (state.scenario === LocalDevelopmentScenarios.FailedRun && conversationId === _PERSONAL_AGENT_CONVERSATION_ID)
	{
		return __CreateConversationHistoryProjection();
	}

	const payloadRef = `local-payload-assistant-${conversationId}`;
	const displayName = agent?.displayName ?? __LOCAL_DEVELOPMENT_BOOTSTRAPS[state.archetype].displayName;
	return { ...__CreateConversationHistoryProjection(), entries: [_AssistantEntry(state, conversationId, agent)], payloads: { [payloadRef]: `This is the disposable ${displayName} workspace.` }, nextPosition: "2", computer: null };
}

/**
 * Appends one signed-in-human entry to a local conversation history.
 *
 * Called by: the normal workspace send boundary and reviewed group-child result sharing.
 */
function _AppendParticipantMessage(state: _LocalDevelopmentState, command: SubmitConversationMessageCommand, lineage?: _LocalDevelopmentMessageLineage): void
{
	const history = state.histories.get(command.conversationId) ?? __CreateConversationHistoryProjection();
	const entry = _ParticipantEntry(command, history.nextPosition, lineage);
	const payloadRef = _TextPayloadRef(entry);
	state.histories.set(command.conversationId, { ...history, entries: [...history.entries, entry], payloads: { ...history.payloads, [payloadRef]: command.text }, nextPosition: String(Number(history.nextPosition) + 1) });
}

/** Appends one ordinary composer message without reviewed-child lineage. */
export function _AppendLocalDevelopmentParticipantMessage(state: _LocalDevelopmentState, command: SubmitConversationMessageCommand): void
{
	_AppendParticipantMessage(state, command);
}

/**
 * Appends reviewed child text with the same upward lineage exposed by the current server authority.
 *
 * Called by: the local group-child share boundary after it verifies the selected child source.
 */
export function _AppendLocalDevelopmentReviewedShare(state: _LocalDevelopmentState, origin: GroupChildOrigin, command: GroupChildShareCommand): void
{
	const message = { conversationId: origin.parentConversationId, idempotencyKey: command.idempotencyKey, text: command.text, activation: "none" } as const;
	_AppendParticipantMessage(state, message, { causationId: command.sourceEntryId, correlationId: origin.requestId, replyToEntryId: origin.parentMessageId });
}

/** Returns whether one exact immutable entry coordinate exists in the selected local history. */
export function _HasLocalDevelopmentHistoryEntry(state: _LocalDevelopmentState, conversationId: string, entryId: string, position: string): boolean
{
	return state.histories.get(conversationId)?.entries.some(function _Matches(entry) { return entry.id === entryId && entry.position === position; }) ?? false;
}
