import { ConversationMode, Prisma, type PrismaClient } from "@prisma/client";
import { type HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { type ConversationEntry } from "@opencrane/contracts";

import { ConversationHistoryAuthority, ConversationHistoryReader } from "@opencrane/backend/server/conversations/history";
import type { ConversationCaller } from "../authorization/conversation-caller.types";
import type { ConversationMessageAttachmentAdmissionFactory } from "./conversation-message-admission.types";
import { PrismaConversationMessageAdmissionUnitOfWork } from "./prisma-conversation-message-admission-unit-of-work";
import { PrismaConversationHistoryRepository } from "./db/prisma-conversation-history-repository";
import type { AuthorizedConversationProjection, StoredConversationPrivatePayload } from "./db/prisma-conversation-history-repository.types";
import type { ConversationMessageAdmissionResult, ConversationMessageCommand, PrismaSelfConversationHistoryDependencies, SelfConversationHistoryAuthority, SelfConversationHistoryReadOptions, SelfConversationHistoryResult } from "./self-conversation-history.types";

const _CONVERSATION_AUDIENCE = "conversation";
const _MESSAGE_ENTRY_KIND = "message";
const _A2UI_ENTRY_KIND = "a2ui";
const _TEXT_BLOCK_KIND = "text";

/** Participant authority joining PostgreSQL policy and encrypted payloads to KurrentDB history. */
export class PrismaSelfConversationHistoryUnitOfWork implements SelfConversationHistoryAuthority
{
	/** KurrentDB read boundary that validates every immutable event envelope. */
	private readonly historyReader: ConversationHistoryReader;
	/** Cohesive write owner for SQL admission, attachment binding and KurrentDB append. */
	private readonly messageAdmission: PrismaConversationMessageAdmissionUnitOfWork;

	/** Connects the authority to its transaction owner, HistoryStore, payload cipher, and computer reader. */
	public constructor(private readonly prisma: PrismaClient, historyStore: Pick<HistoryStore, "append" | "appendAtomic" | "readHead" | "readStream">, private readonly dependencies: PrismaSelfConversationHistoryDependencies, historyAuthority: ConversationHistoryAuthority, createAttachmentAdmission: ConversationMessageAttachmentAdmissionFactory)
	{
		this.historyReader = new ConversationHistoryReader(historyStore);
		this.messageAdmission = new PrismaConversationMessageAdmissionUnitOfWork(prisma, historyStore, dependencies, historyAuthority, createAttachmentAdmission);
	}

	/** Rechecks participant access around one KurrentDB read and decrypts only referenced visible payloads. */
	public async read(caller: ConversationCaller, conversationId: string, afterPosition?: bigint, options?: SelfConversationHistoryReadOptions): Promise<SelfConversationHistoryResult | null>
	{
		options?.signal.throwIfAborted();
		// 1. Check current membership and participant authority before accessing immutable history.
		const projection = await this._transaction(function _Authorize(repository) { return repository.authorizeRead(caller, conversationId); });
		if (projection === null)
			return null;
		options?.signal.throwIfAborted();
		// 2. Read from the position after the exclusive browser cursor and filter subset visibility.
		const requestedRevision = afterPosition === undefined ? 0n : afterPosition + 1n;
		const fromRevision = requestedRevision < projection.visibleFromPosition ? projection.visibleFromPosition : requestedRevision;
		const history = await this.historyReader.read({ siloId: caller.siloId, conversationId, fromRevision, ...options });
		const visible = history.entries.filter(function _Visible(entry) { return BigInt(entry.position) >= projection.visibleFromPosition && _MaySee(entry, caller.subjectId); });
		// 3. Recheck access while loading ciphertext so revocation cannot turn an old authorization into plaintext access.
		const stored = await this._transaction(async function _ReadPayloads(repository)
		{
			const current = await repository.authorizeRead(caller, conversationId);
			if (current === null)
				return null;
			const entries = visible.filter(function _CurrentBoundary(entry) { return BigInt(entry.position) >= current.visibleFromPosition; });
			const payloadRefs = _PayloadRefs(entries);
			return { entries, payloadRefs, ciphertext: await repository.readPayloads(caller, conversationId, payloadRefs) };
		});
		if (stored === null)
			return null;
		options?.signal.throwIfAborted();
		const entries = stored.entries;
		const payloads = this._decrypt(stored.payloadRefs, stored.ciphertext);
		const computer = options === undefined ? await this._computer(caller, conversationId, projection) : null;
		const nextPosition = (options === undefined ? entries : history.entries).at(-1)?.position ?? afterPosition?.toString() ?? "0";
		const result = { entries, payloads, nextPosition, computer };
		if (options !== undefined && Buffer.byteLength(JSON.stringify(result), "utf8") > options.maximumBytes)
			throw new Error("Conversation history page exceeds its byte limit");
		return result;
	}

	/** Delegates message writes to the SQL and KurrentDB admission owner. */
	public postMessage(caller: ConversationCaller, conversationId: string, command: ConversationMessageCommand): Promise<ConversationMessageAdmissionResult | null>
	{
		return this.messageAdmission.post(caller, conversationId, command);
	}

	/** Loads an agent conversation's current checked computer or returns null outside agent mode. */
	private async _computer(caller: ConversationCaller, conversationId: string, projection: AuthorizedConversationProjection)
	{
		if (projection.mode !== ConversationMode.AgentSession)
			return null;
		const current = await this.dependencies.computerReader.load({ computer: { siloId: caller.siloId, conversationId, computerId: projection.computerId!, agentIdentityId: projection.computerAgentIdentityId! }, profileRevisionId: projection.computerProfileRevisionId! });
		if (current === null)
			throw new Error("Agent conversation computer history is unavailable");
		return current.computer;
	}

	/** Decrypts every referenced payload exactly once and fails on missing or surplus ciphertext. */
	private _decrypt(payloadRefs: readonly string[], stored: readonly StoredConversationPrivatePayload[]): Readonly<Record<string, string>>
	{
		const expected = new Set(payloadRefs);
		const payloads: Record<string, string> = {};
		for (const payload of stored)
		{
			if (!expected.delete(payload.coordinates.payloadRef))
				throw new Error("Conversation history loaded an unreferenced private payload");
			payloads[payload.coordinates.payloadRef] = this.dependencies.cipher.decrypt(payload, payload.coordinates);
		}
		if (expected.size > 0)
			throw new Error("Conversation history references a missing private payload");
		return payloads;
	}

	/** Runs one read repository operation at repeatable-read isolation. */
	private _transaction<Result>(work: (repository: PrismaConversationHistoryRepository) => Promise<Result>): Promise<Result>
	{
		return this.prisma.$transaction(async function _Transaction(transaction) { return work(new PrismaConversationHistoryRepository(transaction)); }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
	}
}

/** Returns whether an entry's immutable visibility includes this participant. */
function _MaySee(entry: ConversationEntry, subjectId: string): boolean
{
	return entry.visibility.audience === _CONVERSATION_AUDIENCE || entry.visibility.participantIds.includes(subjectId);
}

/** Collects private text and A2UI payload references without altering the immutable entries. */
function _PayloadRefs(entries: readonly ConversationEntry[]): readonly string[]
{
	const references = entries.flatMap(function _EntryReferences(entry)
	{
		if (entry.kind === _MESSAGE_ENTRY_KIND)
			return entry.blocks.flatMap(block => block.kind === _TEXT_BLOCK_KIND ? [block.payloadRef] : []);
		if (entry.kind === _A2UI_ENTRY_KIND && entry.payloadRef !== null)
			return [entry.payloadRef];
		return [];
	});
	return [...new Set(references)];
}
