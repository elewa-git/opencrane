import { Prisma, type PrismaClient } from "@prisma/client";

import { ConversationEntryKinds, type ConversationEntry } from "@opencrane/contracts";
import { __EncodeConversationProjectionCursor, ConversationProjectionReadStatuses, type ConversationProjectionEventRow, type ConversationProjectionReadResult, type ReadConversationProjectionCommand } from "@opencrane/backend/conversations/projection";

import { ConversationHistoryReader } from "../conversation-history-reader";
import type { ConversationPrivatePayloadStore } from "../conversation-private-payload-store.types";
import type { ConversationHistoryReplayAccess, ConversationReplayUnitOfWork } from "../replay-reader.types";
import { PrismaConversationHistoryReplayAuthorizationRepository } from "./prisma-conversation-history-replay-authorization-repository";

/** Names the human author class that maps to a participant-visible user message. */
const _HUMAN_AUTHOR_KIND = "human";
/** Names the agent author class that maps to a participant-visible assistant message. */
const _AGENT_AUTHOR_KIND = "agent";
/** Names the opaque text reference block that the protected payload store may redeem. */
const _TEXT_BLOCK_KIND = "text";

/** Replays authorized immutable conversation history after checking current PostgreSQL visibility twice. */
export class PrismaConversationHistoryReplayUnitOfWork implements ConversationReplayUnitOfWork
{
	/** Holds the services that make access, immutable history, and protected bodies explicit. */
	public constructor(private readonly prisma: PrismaClient, private readonly conversations: Pick<ConversationHistoryReader, "read">, private readonly payloads: Pick<ConversationPrivatePayloadStore, "readText">)
	{
	}

	/** Returns a bounded history page only when current access still agrees after the immutable read. */
	public async readAuthorized(command: ReadConversationProjectionCommand): Promise<ConversationProjectionReadResult>
	{
		const initial = await this._ReadAccess(command);
		if (initial === null)
			return _Revoked();
		const history = await this.conversations.read({ siloId: command.siloId, conversationId: command.conversationId });
		const final = await this._ReadAccess(command);
		if (final === null)
			return _Revoked();
		return { status: ConversationProjectionReadStatuses.Authorized, rows: await this._Rows(command, history.entries, initial, final) };
	}

	/** Reads one current membership and participant visibility decision without spanning HistoryStore I/O. */
	private async _ReadAccess(command: ReadConversationProjectionCommand): Promise<ConversationHistoryReplayAccess | null>
	{
		return this.prisma.$transaction(async function _Read(transaction): Promise<ConversationHistoryReplayAccess | null>
		{
			return new PrismaConversationHistoryReplayAuthorizationRepository(transaction).readAccess(command);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
	}

	/** Filters current history to the overlap of both authorization snapshots and projects each safe row. */
	private async _Rows(command: ReadConversationProjectionCommand, entries: readonly ConversationEntry[], initial: ConversationHistoryReplayAccess, final: ConversationHistoryReplayAccess): Promise<readonly ConversationProjectionEventRow[]>
	{
		const lowerBound = _Maximum(initial.visibleFromPosition, final.visibleFromPosition);
		const upperBound = _Minimum(initial.accessEndedPosition, final.accessEndedPosition);
		const cursorPosition = command.cursor === null ? lowerBound - 1n : _Position(command.cursor.position);
		if (cursorPosition < lowerBound - 1n || (upperBound !== null && cursorPosition > upperBound))
			return [];
		const visible = entries.filter(function _Visible(entry)
		{
			const position = _Position(entry.position);
			return position >= lowerBound && (upperBound === null || position <= upperBound);
		});
		const resumed = command.cursor?.subframe === undefined
			? []
			: visible.filter(function _Resumed(entry) { return _Position(entry.position) === cursorPosition; });
		const newer = visible.filter(function _Newer(entry) { return _Position(entry.position) > cursorPosition; }).slice(0, command.limit);
		const selected = command.cursor === null ? visible.slice(0, command.limit) : [...resumed, ...newer];
		const unit = this;
		return Promise.all(selected.map(function _Project(entry): Promise<ConversationProjectionEventRow>
		{
			return unit._Row(command, entry);
		}));
	}

	/** Decrypts only text blocks selected from an already-authorized immutable message entry. */
	private async _Row(command: ReadConversationProjectionCommand, entry: ConversationEntry): Promise<ConversationProjectionEventRow>
	{
		if (entry.kind !== ConversationEntryKinds.Message)
			return _UnknownRow(command.conversationId, entry);
		const text = await _Text(entry, command.siloId, this.payloads);
		return {
			cursor: __EncodeConversationProjectionCursor({ conversationId: command.conversationId, position: entry.position }),
			conversationId: command.conversationId,
			position: entry.position,
			runId: entry.runId,
			type: "conversation.message",
			payload: { messageId: entry.id, role: _Role(entry), state: entry.state, blocks: text === null ? [] : [{ id: "text", kind: "text", value: text }] },
			occurredAt: entry.occurredAt,
		};
	}
}

/** Returns a private revoked result without distinguishing a missing conversation from lost access. */
function _Revoked(): ConversationProjectionReadResult
{
	return { status: ConversationProjectionReadStatuses.RevokedOrMissing, rows: [] };
}

/** Converts a known history entry position to a nonnegative bigint before range comparison. */
function _Position(position: string): bigint
{
	if (!/^[1-9][0-9]*$/u.test(position))
		throw new Error("Conversation history replay requires positive stream positions");
	return BigInt(position);
}

/** Keeps the stricter lower visibility boundary observed before or after the immutable read. */
function _Maximum(left: bigint, right: bigint): bigint
{
	return left > right ? left : right;
}

/** Keeps the stricter access end observed before or after the immutable read. */
function _Minimum(left: bigint | null, right: bigint | null): bigint | null
{
	if (left === null)
		return right;
	if (right === null)
		return left;
	return left < right ? left : right;
}

/** Turns non-message history entries into opaque public events while preserving their cursor order. */
function _UnknownRow(conversationId: string, entry: ConversationEntry): ConversationProjectionEventRow
{
	return { cursor: __EncodeConversationProjectionCursor({ conversationId, position: entry.position }), conversationId, position: entry.position, runId: _RunId(entry), type: `conversation.${entry.kind}`, payload: {}, occurredAt: entry.occurredAt };
}

/** Selects a run coordinate only from entry kinds that retain one. */
function _RunId(entry: ConversationEntry): string | null
{
	return "runId" in entry && typeof entry.runId === "string" ? entry.runId : null;
}

/** Maps only server-stamped author classes onto the legacy public message vocabulary. */
function _Role(entry: Extract<ConversationEntry, { readonly kind: "message" }>): "assistant" | "user" | "system"
{
	if (entry.author.kind === _HUMAN_AUTHOR_KIND)
		return "user";
	if (entry.author.kind === _AGENT_AUTHOR_KIND)
		return "assistant";
	return "system";
}

/** Redeems one immutable text reference only after replay selected its exact entry. */
async function _Text(entry: Extract<ConversationEntry, { readonly kind: "message" }>, siloId: string, payloads: Pick<ConversationPrivatePayloadStore, "readText">): Promise<string | null>
{
	const block = entry.blocks.find(function _TextBlock(candidate) { return candidate.kind === _TEXT_BLOCK_KIND; });
	if (block === undefined || block.kind !== _TEXT_BLOCK_KIND)
		return null;
	if (!block.payloadRef.startsWith("payload://") || !/^sha256:[0-9a-f]{64}$/iu.test(block.ciphertextDigest))
		throw new Error("Conversation history replay requires a valid protected text reference");
	return payloads.readText({ siloId, conversationId: entry.conversationId, idempotencyKey: entry.id, payloadRef: block.payloadRef as `payload://${string}`, ciphertextDigest: block.ciphertextDigest as `sha256:${string}` });
}
